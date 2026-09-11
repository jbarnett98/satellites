<script lang="ts">
  import { status } from '../lib/state/status.svelte';
  import { formatKm, formatLat, formatLon, formatSidereal } from '../lib/format';
</script>

<section class="panel status" aria-label="Status">
  <dl class="readout">
    <dt>Camera</dt>
    <dd>{formatLat(status.cameraLatDeg)} · {formatLon(status.cameraLonDeg)}</dd>
    <dt>Altitude</dt>
    <dd>{formatKm(status.cameraAltitudeKm)}</dd>
    <dt>Sub-solar</dt>
    <dd>{formatLat(status.subsolarLatDeg)} · {formatLon(status.subsolarLonDeg)}</dd>
    <dt>GMST</dt>
    <dd>{formatSidereal(status.gmstRad)}</dd>
    <dt>Render</dt>
    <dd>{status.fps.toFixed(0)} fps · {status.starCount.toLocaleString('en-GB')} stars</dd>
  </dl>
  <p class="credits">
    Imagery NASA Blue Marble &amp; Black Marble · Stars Yale BSC5 · Figure WGS84
  </p>
</section>

<style>
  .status {
    padding: 10px 12px;
    min-width: 300px;
  }

  .credits {
    margin: 8px 0 0;
    padding-top: 8px;
    border-top: 1px solid var(--panel-border);
    color: var(--faint);
    font-size: 11px;
    letter-spacing: 0.02em;
  }
</style>
