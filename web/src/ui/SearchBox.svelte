<script lang="ts">
  import { onMount } from 'svelte';
  import { catalog } from '../lib/state/catalog.svelte';
  import { searchCatalog } from '../lib/orbits/searchCatalog';
  import { GROUPS } from '../lib/orbits/constellations';
  import { OBJECT_TYPE_LABELS, OBJECT_TYPES, REGIMES } from '../lib/orbits/SatelliteCatalog';
  import { TYPE_COLORS } from '../lib/globe/satellites';

  const LIMIT = 40;
  const EXAMPLES = ['ISS', 'Hubble', 'Tiangong', '25544', 'Starlink 36802', 'Navstar', '1958-002B'];

  let input: HTMLInputElement;
  let active = $state(0);

  const result = $derived.by(() => {
    const cat = catalog.catalog;
    if (!cat || !catalog.query.trim()) return { hits: [], total: 0 };
    return searchCatalog(cat, catalog.query, LIMIT);
  });

  const rows = $derived.by(() => {
    const cat = catalog.catalog;
    if (!cat) return [];
    const d = cat.data;
    return result.hits.map((h) => {
      const i = h.index;
      const g = cat.group[i];
      return {
        index: i,
        name: d.OBJECT_NAME[i],
        norad: d.NORAD_CAT_ID[i],
        intl: d.OBJECT_ID[i],
        typeCode: cat.typeCode[i],
        type: OBJECT_TYPE_LABELS[OBJECT_TYPES[cat.typeCode[i]]],
        regime: REGIMES[cat.regimeCode[i]],
        group: g >= 0 ? GROUPS[g].label : '',
      };
    });
  });

  $effect(() => {
    // Reset the keyboard cursor whenever the results change.
    void rows;
    active = 0;
  });

  function choose(index: number) {
    catalog.select(index, true);
    catalog.searchOpen = false;
    input?.blur();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(rows.length - 1, active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, active - 1);
    } else if (e.key === 'Enter') {
      if (rows[active]) choose(rows[active].index);
    } else if (e.key === 'Escape') {
      if (catalog.query) catalog.query = '';
      else input.blur();
      catalog.searchOpen = false;
    }
  }

  onMount(() => {
    // "/" focuses the search from anywhere that isn't already a text field.
    const onGlobalKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  });

  const fmt = (n: number) => n.toLocaleString('en-GB');
  const placeholder = $derived(catalog.ready ? `Search ${fmt(catalog.count)} objects` : 'Loading the catalogue…');
</script>

<div class="search" class:open={catalog.searchOpen}>
  <input
    bind:this={input}
    class="field mono"
    type="search"
    {placeholder}
    autocomplete="off"
    spellcheck="false"
    aria-label="Search the catalogue"
    disabled={!catalog.ready}
    bind:value={catalog.query}
    onfocus={() => (catalog.searchOpen = true)}
    onblur={() => setTimeout(() => (catalog.searchOpen = false), 120)}
    onkeydown={onKey}
  />
  <kbd class="hint" aria-hidden="true">/</kbd>

  {#if catalog.searchOpen && catalog.ready}
    <div class="panel results" role="listbox">
      {#if !catalog.query.trim()}
        <div class="empty">
          <span class="eyebrow">Try</span>
          <div class="examples">
            {#each EXAMPLES as ex (ex)}
              <button class="chip" onmousedown={(e) => e.preventDefault()} onclick={() => (catalog.query = ex)}>{ex}</button>
            {/each}
          </div>
        </div>
      {:else if rows.length === 0}
        <div class="empty muted">No object matches “{catalog.query.trim()}”.</div>
      {:else}
        <ul>
          {#each rows as r, k (r.index)}
            <li>
              <button
                class="row"
                class:active={k === active}
                role="option"
                aria-selected={k === active}
                onmousedown={(e) => e.preventDefault()}
                onmouseenter={() => (active = k)}
                onclick={() => choose(r.index)}
              >
                <span class="dot" style:background={TYPE_COLORS[r.typeCode]}></span>
                <span class="name">{r.name}</span>
                <span class="meta mono">{r.norad} · {r.intl} · {r.type} · {r.regime}{r.group ? ` · ${r.group}` : ''}</span>
              </button>
            </li>
          {/each}
        </ul>
        <div class="foot mono">
          {result.total > rows.length ? `first ${rows.length} of ${fmt(result.total)}` : `${fmt(result.total)} ${result.total === 1 ? 'match' : 'matches'}`}
          · ↑↓ Enter
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .search {
    position: relative;
    width: min(340px, 100%);
  }

  .field {
    width: 100%;
    height: 30px;
    padding: 0 30px 0 10px;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--ink);
    font-size: 12.5px;
    outline: none;
  }

  .field::placeholder {
    color: var(--faint);
  }

  .field:focus {
    border-color: var(--accent);
  }

  .field::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }

  .hint {
    position: absolute;
    right: 8px;
    top: 7px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--faint);
    border: 1px solid var(--panel-border);
    border-radius: 3px;
    padding: 0 5px;
    line-height: 15px;
    pointer-events: none;
  }

  .open .hint {
    display: none;
  }

  .results {
    position: absolute;
    top: 36px;
    left: 0;
    width: 440px;
    max-height: min(520px, calc(100vh - 120px));
    overflow-y: auto;
    background: var(--panel-strong);
    z-index: 6;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }

  .row {
    display: grid;
    grid-template-columns: 8px 1fr;
    grid-template-areas:
      'dot name'
      'dot meta';
    column-gap: 10px;
    width: 100%;
    padding: 5px 12px;
    text-align: left;
    line-height: 1.3;
  }

  .row.active {
    background: var(--accent-soft);
  }

  .dot {
    grid-area: dot;
    width: 8px;
    height: 8px;
    margin-top: 5px;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.4);
  }

  .name {
    grid-area: name;
    font-family: var(--font-head);
    font-weight: 600;
    font-size: 13.5px;
    letter-spacing: 0.02em;
  }

  .meta {
    grid-area: meta;
    font-size: 11px;
    color: var(--muted);
  }

  .foot {
    padding: 6px 12px 8px;
    border-top: 1px solid var(--panel-border);
    font-size: 11px;
    color: var(--faint);
  }

  .empty {
    padding: 10px 12px 12px;
    display: grid;
    gap: 8px;
  }

  .muted {
    color: var(--muted);
    font-size: 13px;
  }

  .examples {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    font-family: var(--font-mono);
    font-size: 11.5px;
    padding: 2px 8px;
    border: 1px solid var(--panel-border);
    border-radius: 3px;
    color: var(--ink);
  }

  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
