<script lang="ts">
  import { LAYER_LABELS, settings, type LayerName } from '../lib/state/settings.svelte';

  const names = Object.keys(LAYER_LABELS) as LayerName[];
</script>

<section class="panel layers" aria-label="Layers">
  <div class="eyebrow head">Layers</div>
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
    width: 310px;
    background: var(--panel-strong);
  }

  .head {
    margin-bottom: 4px;
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

  .hint {
    grid-area: hint;
    color: var(--muted);
    font-size: 12px;
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
