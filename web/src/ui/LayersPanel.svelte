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
  {/each}
</section>

<style>
  .layers {
    display: grid;
    gap: 6px;
    padding: 10px 12px 12px;
    width: 300px;
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
</style>
