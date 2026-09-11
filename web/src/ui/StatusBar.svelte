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
    <dd>{status.fps.toFixed(0)} fps · {status.textureTier} · {status.starCount.toLocaleString('en-GB')} stars</dd>
  </dl>
  <p class="credits">
    NASA Blue Marble · Black Marble · cloud composite &nbsp;|&nbsp; stars HYG 4.4 (CC BY-SA) &nbsp;|&nbsp; Milky Way summed from Tycho-2 (CDS) &nbsp;|&nbsp; WGS84
  </p>
</section>

<style>
  .status {
    padding: 10px 12px;
    min-width: 300px;
    max-width: 380px;
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
