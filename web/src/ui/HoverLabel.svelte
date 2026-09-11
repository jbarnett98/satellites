<script lang="ts">
  import { catalog } from '../lib/state/catalog.svelte';
  import { OBJECT_TYPE_LABELS, OBJECT_TYPES, REGIMES } from '../lib/orbits/SatelliteCatalog';

  const item = $derived.by(() => {
    const cat = catalog.catalog;
    const i = catalog.hovered;
    if (!cat || i < 0 || i === catalog.selected) return null;
    return {
      name: cat.data.OBJECT_NAME[i],
      norad: cat.data.NORAD_CAT_ID[i],
      type: OBJECT_TYPE_LABELS[OBJECT_TYPES[cat.typeCode[i]]],
      regime: REGIMES[cat.regimeCode[i]],
      apogee: cat.data.APOGEE_KM[i],
      perigee: cat.data.PERIGEE_KM[i],
    };
  });
</script>

{#if item}
  <div class="hover" style:left={`${catalog.pointer.x + 16}px`} style:top={`${catalog.pointer.y + 12}px`}>
    <div class="name">{item.name}</div>
    <div class="meta mono">
      {item.norad} · {item.type} · {item.regime} · {Math.round(item.perigee).toLocaleString('en-GB')}–{Math.round(item.apogee).toLocaleString('en-GB')} km
    </div>
  </div>
{/if}

<style>
  .hover {
    position: absolute;
    pointer-events: none;
    padding: 6px 9px;
    background: var(--panel-strong);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius);
    white-space: nowrap;
    z-index: 5;
  }

  .name {
    font-family: var(--font-head);
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.02em;
  }

  .meta {
    margin-top: 1px;
    font-size: 11px;
    color: var(--muted);
  }
</style>
