<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Globe, type LayerName } from '../lib/globe/Globe';
  import { SatelliteLayer } from '../lib/globe/satellites';
  import { PropagationEngine } from '../lib/orbits/PropagationEngine';
  import { SatelliteCatalog } from '../lib/orbits/SatelliteCatalog';
  import { fetchOrbitManifest, loadOrbitSnapshot } from '../lib/orbits/loadOrbitSnapshot';
  import { clock } from '../lib/state/clock.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { status } from '../lib/state/status.svelte';
  import { catalog } from '../lib/state/catalog.svelte';
  import { observer } from '../lib/state/observer.svelte';
  import { GROUPS, GROUP_BY_ID } from '../lib/orbits/constellations';
  import { passWatchlist } from '../lib/orbits/passWatchlist';

  /** How often an open page asks whether the pipeline has published a newer snapshot. */
  const SNAPSHOT_POLL_MS = 10 * 60_000;
  /** Hover picking runs at most this often; it walks every visible object on the CPU. */
  const HOVER_INTERVAL_MS = 40;
  /** A press that travels further than this is a drag, not a click. */
  const CLICK_SLOP_PX = 5;
  /** Pass predictions cover this long from the window start… */
  const PASS_WINDOW_MS = 24 * 3_600_000;
  /** …and the window rolls forward once the simulation has moved this far into it (or before its start). */
  const PASS_WINDOW_SLACK_MS = 2 * 3_600_000;
  const PASS_WINDOW_CHECK_MS = 10_000;

  let canvas: HTMLCanvasElement;
  let globe = $state.raw<Globe | undefined>(undefined);
  let layer = $state.raw<SatelliteLayer | undefined>(undefined);

  // ---------------------------------------------------------------- satellites: load + refresh

  async function loadSatellites(g: Globe): Promise<void> {
    const t0 = performance.now();
    try {
      catalog.error = null;
      const { snapshot, timings } = await loadOrbitSnapshot((p) => {
        catalog.phase = p.phase;
        catalog.loadedBytes = p.loadedBytes;
        catalog.totalBytes = p.totalBytes;
      });
      const cat = new SatelliteCatalog(snapshot);

      catalog.phase = 'init';
      const engine = new PropagationEngine(cat.count, cat.ommColumns());
      const { initMs, initErrors } = await engine.ready;
      const tReady = performance.now();

      // Swap the layer in. Selection survives a refresh by catalogue number.
      const previous = layer;
      const prevNorad = catalog.catalog && catalog.selected >= 0 ? catalog.catalog.data.NORAD_CAT_ID[catalog.selected] : -1;
      const next = new SatelliteLayer(cat, engine, 1);
      g.setSatellites(next);
      previous?.dispose();
      layer = next;
      catalog.catalog = cat;
      catalog.hovered = -1;
      catalog.selected = prevNorad >= 0 ? cat.indexOfNorad(prevNorad) : -1;
      catalog.phase = 'ready';
      if (!previous) applyUrlState(cat);

      // The first positions arrive a frame or two after attachment; time them.
      const tFirst = await new Promise<number>((resolve) => {
        const check = () => (next.status(0).hasFrame ? resolve(performance.now()) : requestAnimationFrame(check));
        check();
      });
      catalog.timings = {
        ...timings,
        workerInitMs: initMs,
        firstFrameMs: tFirst - tReady,
        totalMs: tFirst - t0,
      };
      if (import.meta.env.DEV) {
        console.info(
          `[satellites] ${cat.count.toLocaleString()} objects, snapshot ${cat.version} — manifest ${timings.manifestMs.toFixed(0)} ms, ` +
            `download ${(timings.bytes / 1_048_576).toFixed(2)} MB in ${timings.downloadMs.toFixed(0)} ms, parse ${timings.parseMs.toFixed(0)} ms, ` +
            `worker init ${initMs.toFixed(0)} ms (${initErrors} init errors), first frame +${(tFirst - tReady).toFixed(0)} ms, total ${(tFirst - t0).toFixed(0)} ms`,
        );
      }
    } catch (err) {
      console.error(err);
      catalog.phase = 'error';
      catalog.error = err instanceof Error ? err.message : String(err);
    }
  }

  // ---------------------------------------------------------------- shareable URLs: ?sat=25544&group=starlink&obs=55.86,-4.25

  let urlApplied = false;

  function applyUrlState(cat: SatelliteCatalog): void {
    if (urlApplied) return;
    urlApplied = true;
    const params = new URLSearchParams(location.search);
    const sat = Number(params.get('sat'));
    if (Number.isFinite(sat) && sat > 0) {
      const i = cat.indexOfNorad(sat);
      if (i >= 0) catalog.select(i, true);
    }
    const group = params.get('group');
    if (group && GROUP_BY_ID.has(group)) settings.pick.group = GROUP_BY_ID.get(group)!;
    const obs = params.get('obs');
    if (obs) {
      const [lat, lon] = obs.split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        observer.setAt(lat, lon, 'url');
        observer.open = true;
      }
    }
  }

  function writeUrlState(): void {
    const cat = catalog.catalog;
    if (!cat) return;
    const params = new URLSearchParams();
    if (catalog.selected >= 0) params.set('sat', String(cat.data.NORAD_CAT_ID[catalog.selected]));
    if (settings.pick.group >= 0) params.set('group', GROUPS[settings.pick.group].id);
    // A geolocated position is the visitor's own; it never goes into a link they might share.
    const loc = observer.location;
    if (loc && loc.source !== 'geolocation') params.set('obs', `${loc.latDeg.toFixed(2)},${loc.lonDeg.toFixed(2)}`);
    const qs = params.toString().replace(/%2C/g, ','); // keep obs=lat,lon readable
    const next = `${location.pathname}${qs ? `?${qs}` : ''}`;
    if (next !== `${location.pathname}${location.search}`) history.replaceState(null, '', next);
  }

  // ---------------------------------------------------------------- observer: location, sky scan, passes

  const watchlist = $derived.by(() => {
    const cat = catalog.catalog;
    if (!cat) return null;
    return passWatchlist(cat, catalog.selected, { group: settings.pick.group, owner: settings.pick.owner });
  });

  /** Keep the prediction window just ahead of the simulation clock. */
  function rollPassWindow(): void {
    if (!observer.location) return;
    // Racing through time: a 24 h window would roll every couple of seconds, each roll a worker
    // pause of ~80 ms that the propagation ticks would feel. Wait until the clock slows down.
    if (untrack(() => !clock.live && Math.abs(clock.rate) > 60)) return;
    const sim = untrack(() => clock.simTime);
    const start = observer.windowStartMs;
    if (sim < start - 60_000 || sim > start + PASS_WINDOW_SLACK_MS) observer.windowStartMs = Math.floor(sim / 60_000) * 60_000;
  }

  let passRequestSeq = 0;
  let passRequestKey = '';

  $effect(() => {
    const l = layer;
    const loc = observer.location;
    const list = watchlist;
    const startMs = observer.windowStartMs;
    const minEl = observer.minElevationDeg;
    if (!l || !loc || !list || !startMs) {
      if (!loc) observer.passes = null;
      passRequestKey = '';
      return;
    }
    // The same question again (a relabelled location, a re-derived but identical list) is not re-asked.
    const key = `${l.catalog.version}|${loc.latDeg},${loc.lonDeg},${loc.heightKm}|${startMs}|${minEl}|${list.indices.join(',')}`;
    if (key === passRequestKey) return;
    passRequestKey = key;
    const seq = ++passRequestSeq;
    observer.passesBusy = true;
    void l.engine
      .requestPasses(list.indices, loc, startMs, startMs + PASS_WINDOW_MS, minEl)
      .then((r) => {
        if (seq !== passRequestSeq) return; // superseded
        observer.passes = { location: loc, startMs, endMs: startMs + PASS_WINDOW_MS, minElevationDeg: minEl, indices: list.indices, passes: r.passes, computeMs: r.computeMs, evaluations: r.evaluations };
        observer.passesBusy = false;
        if (import.meta.env.DEV) console.info(`[passes] ${list.indices.length} objects, ${r.passes.length} passes ≥${minEl}° in ${r.computeMs.toFixed(0)} ms (${r.evaluations.toLocaleString()} SGP4 evaluations)`);
      });
  });

  async function checkForNewSnapshot(g: Globe): Promise<void> {
    if (catalog.phase !== 'ready' || !catalog.catalog) return;
    try {
      const m = await fetchOrbitManifest();
      if (m.version !== catalog.catalog.version) await loadSatellites(g);
    } catch (err) {
      console.warn('[satellites] manifest check failed', err);
    }
  }

  // ---------------------------------------------------------------- mount

  onMount(() => {
    const g = new Globe(canvas, {
      timeSource: () => clock.tick(),
      rateSource: () => (clock.live ? 1 : clock.rate),
      onProgress: (label) => (status.loadMessage = label),
      onReady: () => (status.ready = true),
      onError: (err) => {
        console.error(err);
        status.error = err instanceof Error ? err.message : String(err);
      },
      onStatus: (s) => {
        status.fps = s.fps;
        status.gmstRad = s.gmstRad;
        status.subsolarLatDeg = s.sun.subsolarLatDeg;
        status.subsolarLonDeg = s.sun.subsolarLonDeg;
        status.sunDeclinationDeg = s.sun.declinationDeg;
        status.cameraAltitudeKm = s.cameraAltitudeKm;
        status.cameraLatDeg = s.cameraLatDeg;
        status.cameraLonDeg = s.cameraLonDeg;
        status.starCount = s.starCount;
        status.textureTier = s.textureTier === 'high' ? '8k' : '2k';
        catalog.propagation = s.satellites;
        catalog.selectedReadout = s.selected;
        observer.scan = s.observer?.scan ?? null;
        observer.sunElevationDeg = s.observer?.sunElevationDeg ?? 0;
      },
    });
    globe = g;
    g.start();
    void loadSatellites(g);

    // Dev-only handle for poking at the scene from the console.
    if (import.meta.env.DEV) {
      Object.assign(window as unknown as Record<string, unknown>, { __globe: g, __state: { catalog, settings, clock, status } });
    }

    const ro = new ResizeObserver(() => g.resize());
    ro.observe(canvas.parentElement!);

    const poll = setInterval(() => void checkForNewSnapshot(g), SNAPSHOT_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkForNewSnapshot(g);
    };
    document.addEventListener('visibilitychange', onVisible);
    const passClock = setInterval(rollPassWindow, PASS_WINDOW_CHECK_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && observer.picking) observer.picking = false;
    };
    window.addEventListener('keydown', onKey);

    return () => {
      clearInterval(poll);
      clearInterval(passClock);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      ro.disconnect();
      g.dispose();
      globe = undefined;
      layer = undefined;
    };
  });

  // ---------------------------------------------------------------- pointer: hover + select

  let lastHoverAt = 0;
  let pressX = 0;
  let pressY = 0;
  let pressed = false;

  function onPointerMove(e: PointerEvent) {
    const g = globe;
    if (!g || !layer) return;
    const rect = canvas.getBoundingClientRect();
    catalog.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const now = performance.now();
    if (pressed || now - lastHoverAt < HOVER_INTERVAL_MS) return;
    lastHoverAt = now;
    const hit = g.pickSatellite(e.clientX, e.clientY);
    if (hit !== catalog.hovered) catalog.hovered = hit;
  }

  function onPointerDown(e: PointerEvent) {
    pressed = true;
    pressX = e.clientX;
    pressY = e.clientY;
  }

  function onPointerUp(e: PointerEvent) {
    if (!pressed) return;
    pressed = false;
    const g = globe;
    if (!g || e.button !== 0) return;
    if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > CLICK_SLOP_PX) return;
    if (observer.picking) {
      // Placing the observer: the ground under the pointer becomes their location.
      const ground = g.pickGround(e.clientX, e.clientY);
      if (ground) observer.setAt(Math.round(ground.latDeg * 100) / 100, Math.round(ground.lonDeg * 100) / 100, 'globe');
      return;
    }
    if (!layer) return;
    const hit = g.pickSatellite(e.clientX, e.clientY, 12);
    if (hit >= 0) catalog.select(hit);
    else catalog.clearSelection();
  }

  function onPointerLeave() {
    pressed = false;
    if (catalog.hovered !== -1) catalog.hovered = -1;
  }

  // ---------------------------------------------------------------- push UI state into the renderer

  $effect(() => {
    globe?.setFrame(settings.frame);
  });

  $effect(() => {
    const g = globe;
    if (!g) return;
    for (const name of Object.keys(settings.layers) as LayerName[]) {
      g.setLayer(name, settings.layers[name]);
    }
  });

  $effect(() => {
    globe?.setStarBrightness(settings.starBrightness);
  });

  $effect(() => {
    const l = layer;
    if (!l) return;
    const { on, active, debrisClouds, types } = settings.satellites;
    l.setVisible(on);
    const mask = l.catalog.visibilityMask({ active, debrisClouds, types: [...types] });
    // A picked-out group either dims the rest (emphasis) or removes it (visibility).
    const members = l.catalog.membershipMask({ group: settings.pick.group, owner: settings.pick.owner });
    if (members && settings.pick.mode === 'hide') {
      for (let i = 0; i < mask.length; i++) mask[i] &= members[i];
      l.setEmphasisMask(null);
    } else {
      l.setEmphasisMask(members);
    }
    l.setVisibleMask(mask);
    globe?.invalidateObserverScan();
    // A filter that hides the selected or hovered object also clears it in the UI.
    untrack(() => {
      if (catalog.selected >= 0 && !mask[catalog.selected]) catalog.clearSelection();
      if (catalog.hovered >= 0 && !mask[catalog.hovered]) catalog.hovered = -1;
    });
  });

  $effect(() => {
    const loc = observer.location;
    globe?.setObserver(loc);
    if (loc) untrack(rollPassWindow);
  });

  $effect(() => {
    globe?.setObserverMinElevation(observer.minElevationDeg);
  });

  $effect(() => {
    if (observer.flyRequest > 0) globe?.flyToObserver();
  });

  $effect(() => {
    globe?.setObserverHighlight(observer.highlight && observer.open);
  });

  $effect(() => {
    // A new layer (snapshot hot-swap) needs the observer re-applied so the scan restarts.
    void layer;
    untrack(() => globe?.setObserver(observer.location));
  });

  $effect(() => {
    layer?.setColorMode(settings.satellites.colorBy);
  });

  $effect(() => {
    layer?.setSizeScale(settings.satellites.sizeScale);
  });

  $effect(() => {
    layer?.setEarthShadow(settings.satellites.earthShadow);
  });

  $effect(() => {
    layer?.setOrbitPathVisible(settings.satellites.orbitPath);
  });

  $effect(() => {
    layer?.setSelected(catalog.selected);
  });

  $effect(() => {
    layer?.setHovered(catalog.hovered);
  });

  // A selection made from search or a link also swings the camera round.
  $effect(() => {
    const i = catalog.flyRequest;
    if (i < 0 || !globe || !layer) return;
    globe.flyToSatellite(i);
    catalog.flyRequest = -1;
  });

  $effect(() => {
    void catalog.selected;
    void settings.pick.group;
    void observer.location;
    if (catalog.ready) writeUrlState();
  });

  const cursor = $derived(observer.picking ? 'crosshair' : catalog.hovered >= 0 ? 'pointer' : 'grab');
</script>

<div class="stage">
  <canvas
    bind:this={canvas}
    style:cursor
    onpointermove={onPointerMove}
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
    onpointerleave={onPointerLeave}
  ></canvas>

  {#if !status.ready}
    <div class="loading" role="status" aria-live="polite">
      {#if status.error}
        <span class="eyebrow err">Renderer error</span>
        <span class="mono">{status.error}</span>
      {:else}
        <span class="eyebrow">Atmospheric Perspective</span>
        <span class="msg">{status.loadMessage}…</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    background: var(--bg);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }

  canvas:active {
    cursor: grabbing;
  }

  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    background: var(--bg);
    color: var(--muted);
  }

  .loading .msg {
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .err {
    color: var(--warn);
  }
</style>
