<script lang="ts">
  import { LAYER_LABELS, settings, type LayerName } from '../lib/state/settings.svelte';
  import { catalog } from '../lib/state/catalog.svelte';
  import { OBJECT_TYPE_LABELS, OBJECT_TYPES, REGIME_LABELS, REGIMES } from '../lib/orbits/SatelliteCatalog';
  import { REGIME_COLORS, TYPE_COLORS } from '../lib/globe/satellites';

  const names = Object.keys(LAYER_LABELS) as LayerName[];
  const sat = settings.satellites;

  const counts = $derived(catalog.catalog?.counts ?? null);
  const legend = $derived(
    sat.colorBy === 'type'
      ? OBJECT_TYPES.map((t, i) => ({ label: OBJECT_TYPE_LABELS[t], color: TYPE_COLORS[i], n: counts?.byType[i] ?? 0 }))
      : REGIMES.map((r, i) => ({ label: REGIME_LABELS[r], color: REGIME_COLORS[i], n: counts?.byRegime[i] ?? 0 })),
  );
  const fmt = (n: number) => n.toLocaleString('en-GB');
</script>

<section class="panel layers" aria-label="Layers">
  <div class="eyebrow head">Satellites</div>

  <label class="row">
    <input type="checkbox" bind:checked={sat.on} />
    <span class="label">Show objects</span>
    <span class="hint">{counts ? `${fmt(counts.total)} tracked objects, propagated live` : 'Loading the catalogue…'}</span>
  </label>

  <div class="sub" class:disabled={!sat.on}>
    <label class="row">
      <input type="checkbox" bind:checked={sat.active} disabled={!sat.on} />
      <span class="label">Active catalogue <span class="mono count">{counts ? fmt(counts.active) : ''}</span></span>
      <span class="hint">Every active satellite, stations, and the last 30 days of launches</span>
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={sat.debrisClouds} disabled={!sat.on} />
      <span class="label">Debris clouds <span class="mono count">{counts ? fmt(counts.debrisClouds) : ''}</span></span>
      <span class="hint">Fengyun-1C · Iridium 33 · Cosmos 2251 fragments</span>
    </label>

    <div class="ctl">
      <span class="eyebrow">Colour</span>
      <div class="seg" role="group" aria-label="Colour by">
        <button class="btn" class:is-active={sat.colorBy === 'type'} onclick={() => (sat.colorBy = 'type')} disabled={!sat.on}>Type</button>
        <button class="btn" class:is-active={sat.colorBy === 'regime'} onclick={() => (sat.colorBy = 'regime')} disabled={!sat.on}>Regime</button>
      </div>
    </div>
    <ul class="legend">
      {#each legend as item (item.label)}
        <li>
          <span class="dot" style:background={item.color}></span>
          <span>{item.label}</span>
          <span class="mono count">{counts ? fmt(item.n) : ''}</span>
        </li>
      {/each}
    </ul>

    <label class="slider">
      <span class="eyebrow">Size</span>
      <input type="range" min="0.5" max="2" step="0.05" bind:value={sat.sizeScale} disabled={!sat.on} />
      <span class="mono val">{sat.sizeScale.toFixed(2)}×</span>
    </label>

    <label class="row">
      <input type="checkbox" bind:checked={sat.earthShadow} disabled={!sat.on} />
      <span class="label">Earth's shadow</span>
      <span class="hint">Dim objects while they are eclipsed</span>
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={sat.orbitPath} disabled={!sat.on} />
      <span class="label">Orbit of selection</span>
      <span class="hint">One revolution, brightest at the object</span>
    </label>
  </div>

  <div class="eyebrow head globe-head">Globe</div>
  {#each names as name (name)}
    <label class="row">
      <input type="checkbox" bind:checked={settings.layers[name]} />
      <span class="label">{LAYER_LABELS[name].label}</span>
      <span class="hint">{LAYER_LABELS[name].hint}</span>
    </label>

    {#if name === 'stars'}
      <label class="slider" class:disabled={!settings.layers.stars}>
        <span class="eyebrow">Brightness</span>
        <input type="range" min="0.4" max="2.2" step="0.05" bind:value={settings.starBrightness} disabled={!settings.layers.stars} />
        <span class="mono val">{settings.starBrightness.toFixed(2)}×</span>
      </label>
    {:else if name === 'milkyWay'}
      <label class="slider" class:disabled={!settings.layers.milkyWay}>
        <span class="eyebrow">Intensity</span>
        <input type="range" min="0" max="1" step="0.05" bind:value={settings.milkyWayIntensity} disabled={!settings.layers.milkyWay} />
        <span class="mono val">{Math.round(settings.milkyWayIntensity * 100)}%</span>
      </label>
    {/if}
  {/each}
</section>

<style>
  .layers {
    display: grid;
    gap: 4px;
    padding: 10px 12px 12px;
    width: 330px;
    max-height: calc(100vh - 90px);
    overflow-y: auto;
    background: var(--panel-strong);
  }

  .head {
    margin-bottom: 4px;
  }

  .globe-head {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--panel-border);
  }

  .sub {
    display: grid;
    gap: 4px;
    padding-left: 10px;
    border-left: 2px solid var(--panel-border);
    margin-left: 6px;
  }

  .sub.disabled {
    opacity: 0.45;
  }

  .row {
    display: grid;
    grid-template-columns: 18px 1fr;
    grid-template-areas:
      'box label'
      'box hint';
    column-gap: 10px;
    align-items: center;
    cursor: pointer;
    padding: 4px 0;
  }

  .row input {
    grid-area: box;
    accent-color: var(--accent);
    width: 15px;
    height: 15px;
    margin: 0;
  }

  .label {
    grid-area: label;
    font-weight: 500;
  }

  .count {
    margin-left: 6px;
    font-size: 11.5px;
    color: var(--muted);
  }

  .hint {
    grid-area: hint;
    color: var(--muted);
    font-size: 12px;
  }

  .ctl {
    display: grid;
    grid-template-columns: 72px 1fr;
    align-items: center;
    gap: 8px;
    padding: 4px 0 2px 28px;
  }

  .legend {
    list-style: none;
    margin: 0 0 4px;
    padding: 0 0 0 28px;
    display: grid;
    gap: 2px;
    font-size: 12px;
    color: var(--muted);
  }

  .legend li {
    display: grid;
    grid-template-columns: 10px 1fr auto;
    gap: 8px;
    align-items: center;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.4);
  }

  .slider {
    display: grid;
    grid-template-columns: 72px 1fr 44px;
    align-items: center;
    gap: 8px;
    padding: 0 0 6px 28px;
  }

  .slider.disabled {
    opacity: 0.4;
  }

  .slider input[type='range'] {
    width: 100%;
    margin: 0;
    accent-color: var(--accent);
  }

  .val {
    font-size: 11.5px;
    text-align: right;
    color: var(--muted);
  }
</style>
