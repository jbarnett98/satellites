/**
 * A read-only view over one orbit snapshot, with the per-object codes the renderer and
 * the filters need packed into typed arrays (one byte per object), plus lookups by
 * catalogue number. Everything here is plain data — no Three.js, no Svelte — so it can be
 * shared between the UI, the globe and the propagation engine.
 */

import type { OmmColumns, OrbitSnapshot, SnapshotColumns } from './loadOrbitSnapshot';
import { OMM_FIELDS } from './loadOrbitSnapshot';
import { assignGroups, GROUPS } from './constellations';

/** Object classes as SATCAT codes them; the index is the code used on the GPU. */
export const OBJECT_TYPES = ['PAY', 'R/B', 'DEB', 'UNK'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];
export const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
  PAY: 'Payload',
  'R/B': 'Rocket body',
  DEB: 'Debris',
  UNK: 'Unknown',
};

/** Coarse regimes as the pipeline derives them from the elements; index = GPU code. */
export const REGIMES = ['LEO', 'MEO', 'GEO', 'HEO', 'HIGH'] as const;
export type Regime = (typeof REGIMES)[number];
export const REGIME_LABELS: Record<Regime, string> = {
  LEO: 'Low Earth orbit',
  MEO: 'Medium Earth orbit',
  GEO: 'Geosynchronous',
  HEO: 'Highly elliptical',
  HIGH: 'Beyond GEO',
};

/** CelesTrak groups that are fragmentation clouds rather than the active catalogue. */
export const DEBRIS_CLOUD_GROUPS = new Set(['fengyun-1c-debris', 'iridium-33-debris', 'cosmos-2251-debris']);

export interface CatalogFilter {
  /** Objects that appear in the active catalogue (active / stations / last-30-days). */
  active: boolean;
  /** Objects that appear only in the three fragmentation-cloud groups. */
  debrisClouds: boolean;
  /** Per OBJECT_TYPES code; omit to show all types. */
  types?: boolean[];
}

/** What a visitor has picked out: a named group (index into GROUPS) and/or an owner code. */
export interface CatalogSelection {
  group: number;
  owner: string | null;
}

export interface CatalogCounts {
  total: number;
  active: number;
  debrisClouds: number;
  byType: number[];
  byRegime: number[];
  stale: number;
}

export class SatelliteCatalog {
  readonly count: number;
  readonly version: string;
  readonly generatedAtMs: number;
  readonly data: SnapshotColumns;

  /** Index into OBJECT_TYPES. */
  readonly typeCode: Uint8Array;
  /** Index into REGIMES. */
  readonly regimeCode: Uint8Array;
  /** 1 if the object appears only in fragmentation-cloud groups. */
  readonly debrisCloudOnly: Uint8Array;
  /** 1 if the pipeline flagged the element set as stale (> 14 days old). */
  readonly stale: Uint8Array;
  /** Index into GROUPS (constellations.ts), or −1. */
  readonly group: Int16Array;
  /** Objects per GROUPS entry. */
  readonly groupCounts: number[];
  /** Owner codes with their object counts, most first. */
  readonly ownerCounts: [string, number][];
  readonly counts: CatalogCounts;

  private readonly byNorad = new Map<number, number>();

  constructor(snapshot: OrbitSnapshot) {
    const n = snapshot.count;
    const d = snapshot.data;
    this.count = n;
    this.version = snapshot.version;
    this.generatedAtMs = Date.parse(snapshot.generated_at);
    this.data = d;

    this.typeCode = new Uint8Array(n);
    this.regimeCode = new Uint8Array(n);
    this.debrisCloudOnly = new Uint8Array(n);
    this.stale = new Uint8Array(n);

    const byType = [0, 0, 0, 0];
    const byRegime = [0, 0, 0, 0, 0];
    let debrisClouds = 0;
    let stale = 0;

    for (let i = 0; i < n; i++) {
      const t = OBJECT_TYPES.indexOf(d.OBJECT_TYPE[i] as ObjectType);
      const r = REGIMES.indexOf(d.REGIME[i] as Regime);
      const tc = t < 0 ? 3 : t;
      const rc = r < 0 ? 4 : r;
      this.typeCode[i] = tc;
      this.regimeCode[i] = rc;
      byType[tc]++;
      byRegime[rc]++;

      const groups = d.GROUPS[i] ?? [];
      const cloudOnly = groups.length > 0 && groups.every((g) => DEBRIS_CLOUD_GROUPS.has(g));
      if (cloudOnly) {
        this.debrisCloudOnly[i] = 1;
        debrisClouds++;
      }
      if ((d.FLAGS[i] ?? []).includes('stale')) {
        this.stale[i] = 1;
        stale++;
      }
      this.byNorad.set(d.NORAD_CAT_ID[i], i);
    }

    this.counts = { total: n, active: n - debrisClouds, debrisClouds, byType, byRegime, stale };

    this.group = assignGroups(this);
    this.groupCounts = new Array<number>(GROUPS.length).fill(0);
    const owners = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      if (this.group[i] >= 0) this.groupCounts[this.group[i]]++;
      const owner = d.OWNER[i];
      if (owner) owners.set(owner, (owners.get(owner) ?? 0) + 1);
    }
    this.ownerCounts = [...owners.entries()].sort((a, b) => b[1] - a[1]);
  }

  indexOfNorad(noradId: number): number {
    return this.byNorad.get(noradId) ?? -1;
  }

  /** One byte per object: 1 = shown under this filter. */
  visibilityMask(filter: CatalogFilter): Uint8Array {
    const mask = new Uint8Array(this.count);
    const types = filter.types;
    for (let i = 0; i < this.count; i++) {
      const on = (this.debrisCloudOnly[i] ? filter.debrisClouds : filter.active) && (!types || types[this.typeCode[i]]);
      mask[i] = on ? 1 : 0;
    }
    return mask;
  }

  /** 1 for members of the selection (group and/or owner), or null when nothing is selected. */
  membershipMask(sel: CatalogSelection): Uint8Array | null {
    if (sel.group < 0 && !sel.owner) return null;
    const mask = new Uint8Array(this.count);
    const d = this.data;
    for (let i = 0; i < this.count; i++) {
      const inGroup = sel.group < 0 || this.group[i] === sel.group;
      const inOwner = !sel.owner || d.OWNER[i] === sel.owner;
      mask[i] = inGroup && inOwner ? 1 : 0;
    }
    return mask;
  }

  /** Indices of the objects a mask admits. */
  indicesOf(mask: Uint8Array): number[] {
    const out: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(i);
    return out;
  }

  /** The 17 OMM columns only — what the propagation worker needs. */
  ommColumns(): OmmColumns {
    const out = {} as Record<string, unknown[]>;
    for (const f of OMM_FIELDS) out[f] = this.data[f];
    return out as unknown as OmmColumns;
  }
}
