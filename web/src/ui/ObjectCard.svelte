<script lang="ts">
  import { catalog } from '../lib/state/catalog.svelte';
  import { clock } from '../lib/state/clock.svelte';
  import { OBJECT_TYPE_LABELS, OBJECT_TYPES, REGIME_LABELS, REGIMES } from '../lib/orbits/SatelliteCatalog';
  import { launchSiteLabel, OPS_STATUS_LABELS, ownerLabel, RCS_LABELS } from '../lib/orbits/satcatCodes';
  import { TYPE_COLORS } from '../lib/globe/satellites';
  import { settings } from '../lib/state/settings.svelte';
  import { GROUPS } from '../lib/orbits/constellations';
  import { formatAgeDays, formatEpoch, formatKm, formatLat, formatLon, formatPeriod } from '../lib/format';

  const item = $derived.by(() => {
    const cat = catalog.catalog;
    const i = catalog.selected;
    if (!cat || i < 0) return null;
    const d = cat.data;
    const epochMs = Date.parse(d.EPOCH[i].endsWith('Z') ? d.EPOCH[i] : `${d.EPOCH[i]}Z`);
    return {
      i,
      name: d.OBJECT_NAME[i],
      norad: d.NORAD_CAT_ID[i],
      intl: d.OBJECT_ID[i],
      typeCode: cat.typeCode[i],
      type: OBJECT_TYPE_LABELS[OBJECT_TYPES[cat.typeCode[i]]],
      regime: REGIMES[cat.regimeCode[i]],
      regimeLabel: REGIME_LABELS[REGIMES[cat.regimeCode[i]]],
      owner: ownerLabel(d.OWNER[i]),
      ownerCode: d.OWNER[i],
      launchDate: d.LAUNCH_DATE[i] || '—',
      launchSite: launchSiteLabel(d.LAUNCH_SITE[i]),
      status: OPS_STATUS_LABELS[d.OPS_STATUS_CODE[i]] ?? d.OPS_STATUS_CODE[i],
      rcs: RCS_LABELS[d.RCS[i]] ?? d.RCS[i],
      period: d.PERIOD_MIN[i],
      apogee: d.APOGEE_KM[i],
      perigee: d.PERIGEE_KM[i],
      inclination: d.INCLINATION[i],
      eccentricity: d.ECCENTRICITY[i],
      raan: d.RA_OF_ASC_NODE[i],
      meanMotion: d.MEAN_MOTION[i],
      bstar: d.BSTAR[i],
      epoch: d.EPOCH[i],
      epochMs,
      stale: cat.stale[i] === 1,
      groups: d.GROUPS[i] ?? [],
      groupIndex: cat.group[i],
      groupLabel: cat.group[i] >= 0 ? GROUPS[cat.group[i]].label : '',
    };
  });

  const live = $derived(catalog.selectedReadout?.index === item?.i ? catalog.selectedReadout : null);
  const epochAgeDays = $derived(item ? (clock.simTime - item.epochMs) / 86_400_000 : 0);
</script>

{#if item}
  <section class="panel card" aria-label="Selected object">
    <header class="head">
      <span class="swatch" style:background={TYPE_COLORS[item.typeCode]}></span>
      <div class="title">
        <div class="name">{item.name}</div>
        <div class="sub mono">{item.norad} · {item.intl} · {item.type}</div>
      </div>
      <div class="actions">
        <button class="btn small" onclick={() => catalog.select(item.i, true)} title="Swing the camera round to this object">Locate</button>
        <button class="close" onclick={() => catalog.clearSelection()} aria-label="Close" title="Deselect">×</button>
      </div>
    </header>
    {#if item.groupLabel}
      <button
        class="group"
        class:is-active={settings.pick.group === item.groupIndex}
        onclick={() => {
          settings.pick.group = settings.pick.group === item.groupIndex ? -1 : item.groupIndex;
        }}
        title="Pick this group out on the globe"
      >
        {item.groupLabel}
      </button>
    {/if}

    <div class="eyebrow section">Now</div>
    <dl class="readout">
      <dt>Position</dt>
      <dd>{live ? `${formatLat(live.latDeg)} · ${formatLon(live.lonDeg)}` : '—'}</dd>
      <dt>Altitude</dt>
      <dd>{live ? formatKm(live.altitudeKm) : '—'}</dd>
      <dt>Speed</dt>
      <dd>{live ? `${live.speedKmS.toFixed(2)} km/s` : '—'}</dd>
      <dt>Sunlight</dt>
      <dd>{live ? (live.inShadow ? "in Earth's shadow" : 'sunlit') : '—'}</dd>
    </dl>

    <div class="eyebrow section">Orbit</div>
    <dl class="readout">
      <dt>Regime</dt>
      <dd title={item.regimeLabel}>{item.regime}</dd>
      <dt>Period</dt>
      <dd>{formatPeriod(item.period)}</dd>
      <dt>Perigee · apogee</dt>
      <dd>{Math.round(item.perigee).toLocaleString('en-GB')} · {Math.round(item.apogee).toLocaleString('en-GB')} km</dd>
      <dt>Inclination</dt>
      <dd>{item.inclination.toFixed(2)}°</dd>
      <dt>Eccentricity</dt>
      <dd>{item.eccentricity.toFixed(5)}</dd>
      <dt>Elements</dt>
      <dd class:warn={item.stale} title={item.epoch}>{formatEpoch(item.epoch)} · {formatAgeDays(epochAgeDays)} old</dd>
    </dl>

    <div class="eyebrow section">Catalogue</div>
    <dl class="readout">
      <dt>Owner</dt>
      <dd title={item.ownerCode}>{item.owner}</dd>
      <dt>Launched</dt>
      <dd>{item.launchDate}</dd>
      <dt>Site</dt>
      <dd>{item.launchSite}</dd>
      <dt>Status</dt>
      <dd>{item.status}</dd>
      <dt>Radar size</dt>
      <dd>{item.rcs}</dd>
    </dl>
  </section>
{/if}

<style>
  .card {
    width: 330px;
    padding: 10px 12px 12px;
    background: var(--panel-strong);
  }

  .head {
    display: grid;
    grid-template-columns: 10px 1fr auto;
    gap: 10px;
    align-items: start;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--panel-border);
  }

  .swatch {
    width: 10px;
    height: 10px;
    margin-top: 5px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
  }

  .name {
    font-family: var(--font-head);
    font-weight: 700;
    font-size: 16px;
    letter-spacing: 0.01em;
    line-height: 1.2;
  }

  .sub {
    margin-top: 2px;
    font-size: 11.5px;
    color: var(--muted);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn.small {
    height: 24px;
    font-size: 12px;
    padding: 0 8px;
  }

  .group {
    margin-top: 8px;
    font-family: var(--font-head);
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border: 1px solid var(--panel-border);
    border-radius: 3px;
    color: var(--muted);
  }

  .group:hover,
  .group.is-active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .close {
    font-size: 18px;
    line-height: 1;
    color: var(--muted);
    padding: 0 2px;
  }

  .close:hover {
    color: var(--ink);
  }

  .section {
    margin: 10px 0 4px;
  }

  .readout {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .readout dt {
    white-space: nowrap;
  }

  .readout dd {
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .warn {
    color: var(--warn);
  }
</style>
