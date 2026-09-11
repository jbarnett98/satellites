<script lang="ts">
  import { status } from '../lib/state/status.svelte';
  import { catalog } from '../lib/state/catalog.svelte';
  import { formatAgo, formatKm, formatLat, formatLon, formatMB, formatSidereal, formatUtc } from '../lib/format';

  const fmt = (n: number) => n.toLocaleString('en-GB');

  const objectsText = $derived.by(() => {
    switch (catalog.phase) {
      case 'idle':
      case 'manifest':
        return 'reading manifest…';
      case 'download':
        return `downloading ${formatMB(catalog.loadedBytes)} / ${formatMB(catalog.totalBytes)}`;
      case 'parse':
        return 'parsing…';
      case 'init':
        return 'initialising orbits…';
      case 'error':
        return `error: ${catalog.error}`;
      case 'ready': {
        const p = catalog.propagation;
        return p ? `${fmt(p.shown)} shown · ${fmt(p.total)} loaded` : `${fmt(catalog.count)} loaded`;
      }
    }
  });

  const elementsText = $derived.by(() => {
    const cat = catalog.catalog;
    if (!cat) return '—';
    return `${formatUtc(cat.generatedAtMs).slice(11, 16)} UTC · ${formatAgo(cat.generatedAtMs)}`;
  });

  const propagationText = $derived.by(() => {
    const p = catalog.propagation;
    if (!p || !p.hasFrame) return '—';
    const hz = p.hz >= 10 ? p.hz.toFixed(0) : p.hz.toFixed(1);
    const dt = Math.abs(p.frameAgeS) < 0.05 ? '0.0' : p.frameAgeS.toFixed(1);
    return `${hz} Hz · ${p.computeMs.toFixed(1)} ms/tick · Δt ${dt} s`;
  });

  const loadText = $derived.by(() => {
    const t = catalog.timings;
    if (!t) return '—';
    const first = t.firstFrameMs >= 1000 ? `${(t.firstFrameMs / 1000).toFixed(1)} s` : `${t.firstFrameMs.toFixed(0)} ms`;
    return `${formatMB(t.bytes)} in ${t.downloadMs.toFixed(0)} ms · parse ${t.parseMs.toFixed(0)} ms · init ${t.workerInitMs.toFixed(0)} ms · draw +${first}`;
  });
</script>

<section class="panel status" aria-label="Status">
  <dl class="readout">
    <dt>Objects</dt>
    <dd class:warn={catalog.phase === 'error'}>{objectsText}</dd>
    <dt>Elements</dt>
    <dd title={catalog.catalog ? `snapshot ${catalog.catalog.version}` : ''}>{elementsText}</dd>
    <dt>Propagation</dt>
    <dd title="worker tick rate · SGP4 time for every object · simulation seconds the shader is extrapolating by">{propagationText}</dd>
    <dt>Loaded</dt>
    <dd title="snapshot download · JSON parse · satellite records built in the worker · first positions drawn after that">{loadText}</dd>
    <dt>Camera</dt>
    <dd>{formatLat(status.cameraLatDeg)} · {formatLon(status.cameraLonDeg)}</dd>
    <dt>Altitude</dt>
    <dd>{formatKm(status.cameraAltitudeKm)}</dd>
    <dt>Sub-solar</dt>
    <dd>{formatLat(status.subsolarLatDeg)} · {formatLon(status.subsolarLonDeg)}</dd>
    <dt>GMST</dt>
    <dd>{formatSidereal(status.gmstRad)}</dd>
    <dt>Render</dt>
    <dd>{status.fps.toFixed(0)} fps · {status.textureTier} · {status.starCount.toLocaleString('en-GB')} stars</dd>
  </dl>
  <p class="credits">
    Orbits: CelesTrak GP &amp; SATCAT (18 SDS data) · SGP4 via satellite.js &nbsp;|&nbsp; NASA Blue Marble · Black Marble · cloud composite
    &nbsp;|&nbsp; stars HYG 4.4 (CC BY-SA) &nbsp;|&nbsp; WGS84
  </p>
</section>

<style>
  .status {
    padding: 10px 12px;
    min-width: 300px;
    max-width: 400px;
  }

  .warn {
    color: var(--warn);
  }

  .credits {
    margin: 8px 0 0;
    padding-top: 8px;
    border-top: 1px solid var(--panel-border);
    color: var(--faint);
    font-size: 11px;
    line-height: 1.5;
    letter-spacing: 0.02em;
  }
</style>
