<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { catalog } from '../lib/state/catalog.svelte';
  import { clock } from '../lib/state/clock.svelte';
  import { observer } from '../lib/state/observer.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { loadPlaces, placesLoaded, searchPlaces, type Place } from '../lib/places/loadPlaces';
  import { compassPoint, skyCondition } from '../lib/astro/topocentric';
  import { GROUPS } from '../lib/orbits/constellations';
  import { MAX_GROUP_PASSES } from '../lib/orbits/passWatchlist';
  import type { Pass } from '../lib/orbits/predictPasses';
  import { TYPE_COLORS } from '../lib/globe/satellites';
  import { formatClock, formatDay, formatDuration, formatLatLon, formatUntil, localZoneName } from '../lib/format';
  import SkyChart from './SkyChart.svelte';

  const TOP_ROWS = 6;
  const fmt = (n: number) => n.toLocaleString('en-GB');

  // ---------------------------------------------------------------- a slow "now" for relative labels

  let nowMs = $state(untrack(() => clock.simTime));
  onMount(() => {
    const t = setInterval(() => (nowMs = clock.simTime), 1000);
    return () => clearInterval(t);
  });

  // ---------------------------------------------------------------- location

  let changing = $state(false);
  let placeQuery = $state('');
  let placeHits = $state<Place[]>([]);
  let placeActive = $state(0);
  let placesReady = $state(placesLoaded());
  let placesError = $state<string | null>(null);
  let latText = $state('');
  let lonText = $state('');
  let placeInput: HTMLInputElement | undefined = $state();

  const showPicker = $derived(!observer.location || changing);

  function ensurePlaces() {
    if (placesReady) return;
    loadPlaces()
      .then(() => (placesReady = true))
      .catch((e) => (placesError = e instanceof Error ? e.message : String(e)));
  }

  $effect(() => {
    // Search as the visitor types, once the list is in.
    const q = placeQuery;
    if (!placesReady) return;
    placeHits = searchPlaces(q, 8);
    placeActive = 0;
  });

  function choosePlace(p: Place) {
    observer.setLocation({ latDeg: p.latDeg, lonDeg: p.lonDeg, heightKm: 0, label: p.name, source: 'place' });
    placeQuery = '';
    placeHits = [];
    changing = false;
  }

  function onPlaceKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      placeActive = Math.min(placeHits.length - 1, placeActive + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      placeActive = Math.max(0, placeActive - 1);
    } else if (e.key === 'Enter') {
      if (placeHits[placeActive]) choosePlace(placeHits[placeActive]);
    } else if (e.key === 'Escape') {
      placeQuery = '';
      placeInput?.blur();
    }
  }

  function setManual() {
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    observer.setAt(lat, lon, 'manual');
    changing = false;
  }

  function startPicking() {
    observer.picking = !observer.picking;
    if (observer.picking) changing = false;
  }

  // Picking on the globe ends when a location lands.
  $effect(() => {
    void observer.location;
    changing = false;
  });

  // ---------------------------------------------------------------- the sky now

  const condition = $derived(skyCondition(observer.sunElevationDeg));
  const top = $derived.by(() => {
    const scan = observer.scan;
    const cat = catalog.catalog;
    if (!scan || !cat) return [];
    const rows = [];
    const e = scan.entries;
    for (let k = 0; k < e.length && rows.length < TOP_ROWS; k += 4) {
      const i = e[k];
      rows.push({ index: i, name: cat.data.OBJECT_NAME[i], typeCode: cat.typeCode[i], az: e[k + 1], el: e[k + 2], range: e[k + 3] });
    }
    return rows;
  });

  // ---------------------------------------------------------------- passes

  let pinned = $state<Pass | null>(null);
  const zone = $derived(observer.timeZone);
  const zoneLabel = $derived(zone === 'utc' ? 'UTC' : localZoneName());

  /** Objects flying together (a station and everything docked to it) rise and set together: one row. */
  const TOGETHER_MS = 90_000;
  const primaryName = (name: string) => /^(ISS \(ZARYA\)|CSS \(TIANHE\))/.test(name);

  interface PassRow {
    pass: Pass;
    name: string;
    typeCode: number;
    live: boolean;
    kind: 'visible' | 'shadow' | 'daylight';
    /** Other objects on the same pass. */
    with: string[];
  }

  const passRows = $derived.by(() => {
    const set = observer.passes;
    const cat = catalog.catalog;
    if (!set || !cat) return [];
    const cutoff = nowMs;
    const rows: PassRow[] = [];
    for (const p of set.passes) {
      if (p.setMs <= cutoff) continue;
      const name = cat.data.OBJECT_NAME[p.index];
      const last = rows[rows.length - 1];
      if (last && Math.abs(p.riseMs - last.pass.riseMs) < TOGETHER_MS && Math.abs(p.setMs - last.pass.setMs) < TOGETHER_MS && Math.abs(p.maxElDeg - last.pass.maxElDeg) < 3) {
        if (primaryName(name) && !primaryName(last.name)) {
          last.with.push(last.name);
          last.pass = p;
          last.name = name;
          last.typeCode = cat.typeCode[p.index];
        } else {
          last.with.push(name);
        }
        continue;
      }
      rows.push({
        pass: p,
        name,
        typeCode: cat.typeCode[p.index],
        live: p.riseMs <= nowMs && p.setMs >= nowMs,
        kind: p.visibleFromMs !== null ? 'visible' : p.darkAtMax ? 'shadow' : 'daylight',
        with: [],
      });
    }
    return rows;
  });

  // The track on the chart: a pinned pass, else the selected object's next pass.
  const track = $derived.by(() => {
    if (pinned && observer.passes?.passes.includes(pinned)) return pinned;
    const sel = catalog.selected;
    if (sel < 0) return null;
    return passRows.find((r) => r.pass.index === sel)?.pass ?? null;
  });

  $effect(() => {
    // A fresh prediction set drops any pin that belonged to the old one.
    void observer.passes;
    pinned = null;
  });

  function choosePass(p: Pass) {
    pinned = p;
    catalog.select(p.index);
  }

  const groupSkipped = $derived.by(() => {
    const cat = catalog.catalog;
    if (!cat || !settings.hasPick) return false;
    const mask = cat.membershipMask({ group: settings.pick.group, owner: settings.pick.owner });
    return !!mask && cat.indicesOf(mask).length > MAX_GROUP_PASSES;
  });
  const pickLabel = $derived(settings.pick.group >= 0 ? GROUPS[settings.pick.group].label : (settings.pick.owner ?? ''));
</script>

<section class="panel observer" aria-label="Above you">
  <div class="head-row">
    <div class="eyebrow">Above you</div>
    {#if observer.location && !showPicker}
      <div class="head-actions">
        <button class="btn small" onclick={() => (changing = true)}>Change</button>
        <button class="btn small" onclick={() => observer.flyRequest++} title="Swing the camera round to your location">Locate</button>
      </div>
    {/if}
  </div>

  <div class="scroll">
    {#if observer.location}
      <div class="loc">
        <div class="loc-name">{observer.location.label}</div>
        <div class="mono loc-coords">{formatLatLon(observer.location.latDeg, observer.location.lonDeg)}</div>
      </div>
    {/if}

    {#if showPicker}
      <div class="picker">
        {#if !observer.location}
          <p class="lead">Where are you? Then the globe shows what is over your head, and when the stations pass.</p>
        {/if}
        <div class="place">
          <input
            bind:this={placeInput}
            class="field"
            type="search"
            placeholder={placesError ? 'Place list unavailable' : 'Type a city'}
            autocomplete="off"
            spellcheck="false"
            aria-label="Set location by place name"
            bind:value={placeQuery}
            onfocus={ensurePlaces}
            onkeydown={onPlaceKey}
            disabled={!!placesError}
          />
          {#if placeQuery.trim() && placesReady}
            <ul class="hits" role="listbox">
              {#each placeHits as p, k (p.name + p.country + p.latDeg)}
                <li>
                  <button class="hit" class:active={k === placeActive} role="option" aria-selected={k === placeActive} onmousedown={(e) => e.preventDefault()} onmouseenter={() => (placeActive = k)} onclick={() => choosePlace(p)}>
                    <span class="hit-name">{p.name}</span>
                    <span class="hit-sub">{p.country}</span>
                  </button>
                </li>
              {:else}
                <li class="none">No place called “{placeQuery.trim()}” in the list — pick on the globe or enter coordinates.</li>
              {/each}
            </ul>
          {/if}
        </div>

        <div class="ways">
          <button class="btn" onclick={() => observer.locate()} disabled={observer.locating}>{observer.locating ? 'Locating…' : 'Use my location'}</button>
          <button class="btn" class:is-active={observer.picking} onclick={startPicking}>{observer.picking ? 'Click the globe · Esc cancels' : 'Pick on the globe'}</button>
        </div>
        {#if observer.locateError}
          <div class="err">{observer.locateError}</div>
        {/if}

        <form class="manual" onsubmit={(e) => { e.preventDefault(); setManual(); }}>
          <input class="field mono" type="text" inputmode="decimal" placeholder="lat" aria-label="Latitude" bind:value={latText} />
          <input class="field mono" type="text" inputmode="decimal" placeholder="lon" aria-label="Longitude" bind:value={lonText} />
          <button class="btn" type="submit">Set</button>
          {#if observer.location}
            <button class="btn" type="button" onclick={() => (changing = false)}>Cancel</button>
          {/if}
        </form>
      </div>
    {/if}

    {#if observer.location && !showPicker}
      <div class="eyebrow section">Sky now</div>
      <div class="sky-line">
        <span class="cond" class:night={condition === 'night'}>{condition}</span>
        <span class="mono muted">Sun {observer.sunElevationDeg >= 0 ? `${observer.sunElevationDeg.toFixed(0)}° up` : `${(-observer.sunElevationDeg).toFixed(0)}° below the horizon`}</span>
      </div>
      {#if observer.scan}
        <div class="counts">
          <span><b class="mono">{fmt(observer.scan.aboveHorizon)}</b> above the horizon</span>
          <span><b class="mono">{fmt(observer.scan.aboveMin)}</b> above {observer.minElevationDeg}°</span>
        </div>
      {/if}

      <div class="chart-wrap">
        <SkyChart {track} size={296} />
      </div>
      <div class="chart-hint">Held overhead: north up, east left. Click a dot to select it.</div>

      <label class="row opt">
        <input type="checkbox" bind:checked={observer.highlight} />
        <span>Dim everything below my horizon</span>
      </label>

      {#if top.length}
        <div class="eyebrow section">Highest now</div>
        <ul class="list">
          {#each top as r (r.index)}
            <li>
              <button class="obj" class:is-active={catalog.selected === r.index} onclick={() => catalog.select(r.index)} onmouseenter={() => (observer.hoveredIndex = r.index)} onmouseleave={() => (observer.hoveredIndex = -1)}>
                <span class="dot" style:background={TYPE_COLORS[r.typeCode]}></span>
                <span class="name">{r.name}</span>
                <span class="mono meta">{r.el.toFixed(0)}° {compassPoint(r.az)} · {fmt(Math.round(r.range))} km</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="section head-row">
        <div class="eyebrow">Next passes · 24 h</div>
        <div class="pass-ctl">
          <select class="field sel" aria-label="Minimum peak elevation" bind:value={observer.minElevationDeg}>
            <option value={0}>≥ 0°</option>
            <option value={10}>≥ 10°</option>
            <option value={20}>≥ 20°</option>
            <option value={30}>≥ 30°</option>
          </select>
          <div class="seg" role="group" aria-label="Time zone">
            <button class="btn tz" class:is-active={zone === 'local'} onclick={() => (observer.timeZone = 'local')}>{zone === 'local' ? zoneLabel : localZoneName()}</button>
            <button class="btn tz" class:is-active={zone === 'utc'} onclick={() => (observer.timeZone = 'utc')}>UTC</button>
          </div>
        </div>
      </div>
      <div class="who">
        Stations, visiting vehicles, Hubble{catalog.selected >= 0 ? ', the selected object' : ''}{settings.hasPick && !groupSkipped ? `, ${pickLabel}` : ''}.
        {#if groupSkipped}<span class="warn">{pickLabel} is too big to predict here (over {MAX_GROUP_PASSES} objects).</span>{/if}
      </div>

      {#if observer.passesBusy && !observer.passes}
        <div class="muted small">Predicting…</div>
      {:else if passRows.length === 0}
        <div class="muted small">Nothing on the list clears {observer.minElevationDeg}° in the next 24 hours.</div>
      {:else}
        <ul class="list passes">
          {#each passRows as r (r.pass.index + ':' + r.pass.riseMs)}
            <li>
              <button class="pass" class:is-active={track === r.pass} onclick={() => choosePass(r.pass)} onmouseenter={() => (observer.hoveredIndex = r.pass.index)} onmouseleave={() => (observer.hoveredIndex = -1)}>
                <span class="when">
                  <span class="day">{r.live ? 'Now' : formatDay(r.pass.riseMs, zone, nowMs)}</span>
                  <span class="mono clock">{r.live ? `until ${formatClock(r.pass.setMs, zone)}` : formatClock(r.pass.riseMs, zone)}</span>
                </span>
                <span class="what">
                  <span class="name"><span class="dot" style:background={TYPE_COLORS[r.typeCode]}></span>{r.name}{#if r.with.length}<span class="with" title={`with ${r.with.join(', ')}`}>+{r.with.length}</span>{/if}</span>
                  <span class="mono meta">
                    {compassPoint(r.pass.riseAzDeg)} → {r.pass.maxElDeg.toFixed(0)}° {compassPoint(r.pass.maxAzDeg)} {formatClock(r.pass.maxMs, zone)} → {compassPoint(r.pass.setAzDeg)} · {formatDuration(r.pass.setMs - r.pass.riseMs)}
                  </span>
                  {#if r.kind === 'visible'}
                    <span class="mono meta vis">visible {formatClock(r.pass.visibleFromMs!, zone)}–{formatClock(r.pass.visibleToMs!, zone)}, up to {r.pass.visibleMaxElDeg.toFixed(0)}°</span>
                  {/if}
                </span>
                <span class="badge" class:visible={r.kind === 'visible'} class:live={r.live}>{r.live ? 'up now' : r.kind === 'visible' ? 'visible' : r.kind === 'shadow' ? 'in shadow' : 'daylight'}</span>
                <span class="mono until">{r.live ? `sets ${formatUntil(r.pass.setMs, nowMs)}` : formatUntil(r.pass.riseMs, nowMs)}</span>
              </button>
            </li>
          {/each}
        </ul>
        {#if observer.passes}
          <div class="mono foot">{observer.passes.indices.length} objects · {fmt(observer.passes.evaluations)} SGP4 evaluations in {observer.passes.computeMs.toFixed(0)} ms{observer.passesBusy ? ' · updating…' : ''}</div>
        {/if}
      {/if}
    {/if}
  </div>
</section>

<style>
  .observer {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    width: 340px;
    max-height: calc(100vh - 370px); /* clears the status bar (282 px + margins) */
    padding: 10px 0 0;
    background: var(--panel-strong);
  }

  .head-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 0 12px 8px;
  }

  .head-actions {
    display: flex;
    gap: 6px;
  }

  .btn.small {
    height: 24px;
    font-size: 12px;
    padding: 0 8px;
  }

  .scroll {
    overflow-y: auto;
    padding: 0 12px 12px;
    border-top: 1px solid var(--panel-border);
  }

  .loc {
    padding: 8px 0 2px;
  }

  .loc-name {
    font-family: var(--font-head);
    font-weight: 700;
    font-size: 16px;
  }

  .loc-coords {
    font-size: 11.5px;
    color: var(--muted);
  }

  .picker {
    display: grid;
    gap: 8px;
    padding: 8px 0 10px;
  }

  .lead {
    margin: 0 0 2px;
    color: var(--muted);
    font-size: 13px;
  }

  .field {
    width: 100%;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--ink);
    font-size: 12.5px;
    outline: none;
  }

  .field:focus {
    border-color: var(--accent);
  }

  .field::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }

  .place {
    position: relative;
  }

  .hits {
    position: absolute;
    left: 0;
    right: 0;
    top: 34px;
    z-index: 5;
    list-style: none;
    margin: 0;
    padding: 4px 0;
    background: var(--panel-strong);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }

  .hit {
    display: grid;
    width: 100%;
    padding: 4px 10px;
    text-align: left;
    line-height: 1.25;
  }

  .hit.active {
    background: var(--accent-soft);
  }

  .hit-name {
    font-weight: 600;
    font-size: 13.5px;
  }

  .hit-sub {
    font-size: 11.5px;
    color: var(--muted);
  }

  .none {
    padding: 6px 10px;
    font-size: 12.5px;
    color: var(--muted);
  }

  .ways {
    display: flex;
    gap: 6px;
  }

  .ways .btn {
    flex: 1;
  }

  .err {
    color: var(--warn);
    font-size: 12.5px;
  }

  .manual {
    display: grid;
    grid-template-columns: 1fr 1fr auto auto;
    gap: 6px;
  }

  .section {
    margin: 12px 0 4px;
    padding-left: 0;
    padding-right: 0;
  }

  .sky-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }

  .cond {
    font-family: var(--font-head);
    font-weight: 700;
    font-size: 15px;
    text-transform: capitalize;
    white-space: nowrap;
  }

  .sky-line .mono {
    text-align: right;
    font-size: 12px;
  }

  .cond.night {
    color: var(--accent);
  }

  .counts {
    display: flex;
    justify-content: space-between;
    font-size: 12.5px;
    color: var(--muted);
    margin-top: 2px;
  }

  .counts b {
    color: var(--ink);
    font-weight: 500;
  }

  .chart-wrap {
    display: flex;
    justify-content: center;
    margin-top: 8px;
  }

  .chart-hint {
    text-align: center;
    font-size: 11px;
    color: var(--faint);
    margin-top: 2px;
  }

  .row.opt {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    font-size: 12.5px;
    color: var(--muted);
    cursor: pointer;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .obj {
    display: grid;
    grid-template-columns: 8px 1fr auto;
    align-items: center;
    column-gap: 8px;
    width: calc(100% + 16px);
    margin: 0 -8px;
    padding: 3px 8px;
    border-radius: var(--radius);
    text-align: left;
  }

  .obj:hover,
  .pass:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .obj.is-active,
  .pass.is-active {
    background: var(--accent-soft);
  }

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.4);
  }

  .name {
    font-family: var(--font-head);
    font-weight: 600;
    font-size: 13.5px;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    font-size: 11px;
    color: var(--muted);
  }

  .pass-ctl {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sel {
    width: auto;
    height: 24px;
    padding: 0 6px;
    font-size: 12px;
  }

  .btn.tz {
    height: 24px;
    font-size: 11.5px;
    padding: 0 7px;
  }

  .who {
    font-size: 11.5px;
    color: var(--faint);
    margin-bottom: 4px;
  }

  .warn {
    color: var(--warn);
  }

  .small {
    font-size: 12.5px;
  }

  .muted {
    color: var(--muted);
  }

  .pass {
    display: grid;
    grid-template-columns: 74px 1fr auto;
    grid-template-areas:
      'when what badge'
      'when what until';
    column-gap: 8px;
    align-items: start;
    width: calc(100% + 16px);
    margin: 0 -8px;
    padding: 5px 8px;
    border-radius: var(--radius);
    text-align: left;
    line-height: 1.3;
  }

  .when {
    grid-area: when;
    display: grid;
  }

  .day {
    font-weight: 600;
    font-size: 12.5px;
  }

  .clock {
    font-size: 12px;
    color: var(--muted);
  }

  .what {
    grid-area: what;
    display: grid;
    min-width: 0;
  }

  .what .name {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .vis {
    color: var(--accent);
  }

  .with {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--muted);
    border: 1px solid var(--panel-border);
    border-radius: 3px;
    padding: 0 4px;
    cursor: help;
  }

  .badge {
    grid-area: badge;
    justify-self: end;
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 3px;
    color: var(--muted);
    border: 1px solid var(--panel-border);
  }

  .badge.visible {
    color: var(--bg);
    background: var(--accent);
    border-color: var(--accent);
  }

  .badge.live {
    color: var(--bg);
    background: var(--live);
    border-color: var(--live);
  }

  .until {
    grid-area: until;
    justify-self: end;
    font-size: 11px;
    color: var(--faint);
  }

  .foot {
    margin-top: 6px;
    font-size: 11px;
    color: var(--faint);
  }
</style>
