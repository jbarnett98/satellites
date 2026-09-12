<script lang="ts">
  import { settings } from '../lib/state/settings.svelte';
  import { catalog } from '../lib/state/catalog.svelte';
  import { GROUP_CATEGORY_LABELS, GROUPS, summariseObjects, type GroupCategory } from '../lib/orbits/constellations';
  import { OBJECT_TYPE_LABELS, OBJECT_TYPES, REGIMES } from '../lib/orbits/SatelliteCatalog';
  import { ownerLabel } from '../lib/orbits/satcatCodes';
  import { TYPE_COLORS } from '../lib/globe/satellites';

  const OWNER_ROWS = 14;
  const fmt = (n: number) => n.toLocaleString('en-GB');
  const pick = settings.pick;

  const cat = $derived(catalog.catalog);
  const categories = $derived.by(() => {
    const c = cat;
    if (!c) return [];
    const order: GroupCategory[] = ['broadband', 'communications', 'navigation', 'observation', 'stations', 'debris'];
    return order.map((category) => ({
      category,
      label: GROUP_CATEGORY_LABELS[category],
      groups: GROUPS.map((g, i) => ({ ...g, i, n: c.groupCounts[i] })).filter((g) => g.category === category && g.n > 0),
    }));
  });
  const owners = $derived((cat?.ownerCounts ?? []).slice(0, OWNER_ROWS));

  // The picked-out set, described.
  const summary = $derived.by(() => {
    const c = cat;
    if (!c || !settings.hasPick) return null;
    const mask = c.membershipMask({ group: pick.group, owner: pick.owner });
    if (!mask) return null;
    return summariseObjects(c, c.indicesOf(mask));
  });
  const pickTitle = $derived.by(() => {
    const parts: string[] = [];
    if (pick.group >= 0) parts.push(GROUPS[pick.group].label);
    if (pick.owner) parts.push(ownerLabel(pick.owner));
    return parts.join(' · ');
  });

  function toggleGroup(i: number) {
    pick.group = pick.group === i ? -1 : i;
  }
  function toggleOwner(code: string) {
    pick.owner = pick.owner === code ? null : code;
  }
</script>

<section class="panel groups" aria-label="Groups">
  <div class="head-row">
    <div class="eyebrow">Groups</div>
    {#if settings.hasPick}
      <button class="btn small" onclick={() => settings.clearPick()}>Clear</button>
    {/if}
  </div>

  {#if summary}
    <div class="summary">
      <div class="title">{pickTitle}</div>
      <dl class="readout">
        <dt>Objects</dt>
        <dd>{fmt(summary.count)}{summary.launchedLast30Days ? ` · ${fmt(summary.launchedLast30Days)} launched in 30 d` : ''}</dd>
        <dt>Types</dt>
        <dd>{summary.byType.map((n, k) => (n ? `${fmt(n)} ${OBJECT_TYPE_LABELS[OBJECT_TYPES[k]].toLowerCase()}` : '')).filter(Boolean).join(' · ')}</dd>
        <dt>Regime</dt>
        <dd>{summary.byRegime.map((n, k) => (n ? `${REGIMES[k]} ${fmt(n)}` : '')).filter(Boolean).join(' · ')}</dd>
        <dt>Altitude</dt>
        <dd>median {Math.round(summary.perigeeKm).toLocaleString('en-GB')} – {Math.round(summary.apogeeKm).toLocaleString('en-GB')} km</dd>
        <dt>Inclinations</dt>
        <dd>{summary.inclinations.map(([deg, n]) => `${deg.toFixed(1)}° (${fmt(n)})`).join(' · ')}</dd>
        <dt>Launched</dt>
        <dd>{summary.oldestLaunch && summary.newestLaunch ? (summary.oldestLaunch === summary.newestLaunch ? summary.oldestLaunch : `${summary.oldestLaunch} → ${summary.newestLaunch}`) : '—'}</dd>
        {#if !pick.owner}
          <dt>Owners</dt>
          <dd class="wrap">{summary.owners.map(([code, n]) => `${ownerLabel(code)} ${fmt(n)}`).join(' · ')}</dd>
        {/if}
      </dl>
      <div class="mode">
        <span class="eyebrow">Others</span>
        <div class="seg" role="group" aria-label="Everything else">
          <button class="btn" class:is-active={pick.mode === 'dim'} onclick={() => (pick.mode = 'dim')}>Dim</button>
          <button class="btn" class:is-active={pick.mode === 'hide'} onclick={() => (pick.mode = 'hide')}>Hide</button>
        </div>
      </div>
    </div>
  {/if}

  <div class="scroll">
    {#each categories as c (c.category)}
      {#if c.groups.length}
        <div class="eyebrow cat">{c.label}</div>
        <ul class="list">
          {#each c.groups as g (g.id)}
            <li>
              <button class="row" class:is-active={pick.group === g.i} onclick={() => toggleGroup(g.i)} aria-pressed={pick.group === g.i}>
                <span class="label">{g.label}</span>
                <span class="sub">{g.operator}</span>
                <span class="mono count">{fmt(g.n)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}

    <div class="eyebrow cat">Owners</div>
    <ul class="list">
      {#each owners as [code, n] (code)}
        <li>
          <button class="row" class:is-active={pick.owner === code} onclick={() => toggleOwner(code)} aria-pressed={pick.owner === code}>
            <span class="label">{ownerLabel(code)}</span>
            <span class="sub mono">{code}</span>
            <span class="mono count">{fmt(n)}</span>
          </button>
        </li>
      {/each}
    </ul>

    <div class="eyebrow cat">Types</div>
    <div class="chips">
      {#each OBJECT_TYPES as t, k (t)}
        <label class="chip" class:off={!settings.satellites.types[k]}>
          <input type="checkbox" bind:checked={settings.satellites.types[k]} />
          <span class="dot" style:background={TYPE_COLORS[k]}></span>
          {OBJECT_TYPE_LABELS[t]}
          <span class="mono count">{cat ? fmt(cat.counts.byType[k]) : ''}</span>
        </label>
      {/each}
    </div>
  </div>
</section>

<style>
  .groups {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    width: 340px;
    max-height: calc(100vh - 300px); /* stops above the status bar */
    padding: 10px 0 0;
    background: var(--panel-strong);
  }

  .head-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 12px 8px;
  }

  .btn.small {
    height: 24px;
    font-size: 12px;
    padding: 0 8px;
  }

  .summary {
    padding: 8px 12px 10px;
    border-top: 1px solid var(--panel-border);
    border-bottom: 1px solid var(--panel-border);
    background: var(--accent-soft);
  }

  .summary .title {
    font-family: var(--font-head);
    font-weight: 700;
    font-size: 15px;
    margin-bottom: 6px;
  }

  .summary .readout {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 2px 12px;
  }

  .summary .readout dd {
    text-align: left;
    white-space: normal;
    font-size: 12px;
  }

  .mode {
    display: grid;
    grid-template-columns: 72px 1fr;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }

  .scroll {
    overflow-y: auto;
    padding: 4px 12px 12px;
  }

  .cat {
    margin: 10px 0 4px;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'label count'
      'sub count';
    column-gap: 10px;
    width: 100%;
    padding: 4px 8px;
    margin: 0 -8px;
    width: calc(100% + 16px);
    border-radius: var(--radius);
    text-align: left;
    line-height: 1.25;
  }

  .row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .row.is-active {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .label {
    grid-area: label;
    font-weight: 500;
    font-size: 13.5px;
  }

  .sub {
    grid-area: sub;
    font-size: 11.5px;
    color: var(--muted);
  }

  .count {
    grid-area: count;
    align-self: center;
    font-size: 12px;
    color: var(--muted);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border: 1px solid var(--panel-border);
    border-radius: 3px;
    font-size: 12.5px;
    cursor: pointer;
  }

  .chip.off {
    opacity: 0.45;
  }

  .chip input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .chip .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.4);
  }

  .chip .count {
    font-size: 11px;
  }
</style>
