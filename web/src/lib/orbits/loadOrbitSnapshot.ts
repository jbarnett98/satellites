/**
 * Loads the orbit snapshot the pipeline publishes. Two requests, always in this order:
 *
 *   GET /data/orbits/manifest.json      small, `no-cache` — revalidated every time
 *   GET /data/orbits/gp-<version>.json  ~5 MB, immutable — the manifest names it
 *
 * The browser never talks to CelesTrak or any other upstream; it only reads what the
 * pipeline wrote. The gp file is column-oriented: one array per field, index = object.
 * Element-set values arrive exactly as CelesTrak published them (EPOCH as an ISO string,
 * the rest as JSON numbers → float64), so they can be handed to satellite.js untouched.
 */

export const ORBITS_BASE = '/data/orbits/';

/** The 17 OMM fields carried verbatim. This is exactly what the propagation worker is sent. */
export const OMM_FIELDS = [
  'NORAD_CAT_ID',
  'OBJECT_NAME',
  'OBJECT_ID',
  'EPOCH',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'EPHEMERIS_TYPE',
  'CLASSIFICATION_TYPE',
  'ELEMENT_SET_NO',
  'REV_AT_EPOCH',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
] as const;
export type OmmField = (typeof OMM_FIELDS)[number];

export interface OmmColumns {
  NORAD_CAT_ID: number[];
  OBJECT_NAME: string[];
  OBJECT_ID: string[];
  EPOCH: string[];
  MEAN_MOTION: number[];
  ECCENTRICITY: number[];
  INCLINATION: number[];
  RA_OF_ASC_NODE: number[];
  ARG_OF_PERICENTER: number[];
  MEAN_ANOMALY: number[];
  EPHEMERIS_TYPE: number[];
  CLASSIFICATION_TYPE: string[];
  ELEMENT_SET_NO: number[];
  REV_AT_EPOCH: number[];
  BSTAR: number[];
  MEAN_MOTION_DOT: number[];
  MEAN_MOTION_DDOT: number[];
}

export interface DerivedColumns {
  PERIOD_MIN: number[];
  SEMI_MAJOR_AXIS_KM: number[];
  APOGEE_KM: number[];
  PERIGEE_KM: number[];
  REGIME: string[];
  EPOCH_AGE_DAYS: number[];
  FLAGS: string[][];
  GROUPS: string[][];
}

export interface SatcatColumns {
  OBJECT_TYPE: string[];
  OPS_STATUS_CODE: string[];
  OWNER: string[];
  LAUNCH_DATE: string[];
  LAUNCH_SITE: string[];
  DECAY_DATE: string[];
  RCS: string[];
}

export type SnapshotColumns = OmmColumns & DerivedColumns & SatcatColumns;

export interface OrbitSnapshot {
  schema: number;
  version: string;
  generated_at: string;
  count: number;
  columns: Record<string, string>;
  data: SnapshotColumns;
}

export interface OrbitManifest {
  schema: number;
  version: string;
  generated_at: string;
  gp_file: string;
  gp_bytes: number;
  counts: {
    objects: number;
    by_object_type: Record<string, number>;
    by_regime: Record<string, number>;
    by_group: Record<string, number>;
    satcat_matched: number;
  };
  validation: Record<string, unknown>;
  credits: Record<string, string>;
}

export type LoadPhase = 'manifest' | 'download' | 'parse';

export interface LoadProgress {
  phase: LoadPhase;
  loadedBytes: number;
  totalBytes: number;
}

export interface LoadTimings {
  manifestMs: number;
  downloadMs: number;
  parseMs: number;
  bytes: number;
}

export async function fetchOrbitManifest(): Promise<OrbitManifest> {
  const res = await fetch(`${ORBITS_BASE}manifest.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
  return (await res.json()) as OrbitManifest;
}

/** Streams a response so the UI can show bytes arriving; returns the decoded text. */
async function fetchText(url: string, onBytes?: (loaded: number, total: number) => void): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!res.body) return res.text();
  // Content-Length is the compressed size when the server gzips; treat it as a hint only.
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes?.(loaded, Math.max(total, loaded));
  }
  const all = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function loadOrbitSnapshot(
  onProgress?: (p: LoadProgress) => void,
): Promise<{ manifest: OrbitManifest; snapshot: OrbitSnapshot; timings: LoadTimings }> {
  onProgress?.({ phase: 'manifest', loadedBytes: 0, totalBytes: 0 });
  const t0 = performance.now();
  const manifest = await fetchOrbitManifest();
  const t1 = performance.now();

  onProgress?.({ phase: 'download', loadedBytes: 0, totalBytes: manifest.gp_bytes });
  const text = await fetchText(`${ORBITS_BASE}${manifest.gp_file}`, (loaded, total) =>
    onProgress?.({ phase: 'download', loadedBytes: loaded, totalBytes: Math.max(total, manifest.gp_bytes) }),
  );
  const t2 = performance.now();

  onProgress?.({ phase: 'parse', loadedBytes: text.length, totalBytes: text.length });
  const snapshot = JSON.parse(text) as OrbitSnapshot;
  const t3 = performance.now();

  if (snapshot.schema !== 1) throw new Error(`orbit snapshot schema ${snapshot.schema} not supported`);
  for (const f of OMM_FIELDS) {
    if (!Array.isArray(snapshot.data[f]) || snapshot.data[f].length !== snapshot.count) {
      throw new Error(`orbit snapshot column ${f} missing or wrong length`);
    }
  }

  return {
    manifest,
    snapshot,
    timings: { manifestMs: t1 - t0, downloadMs: t2 - t1, parseMs: t3 - t2, bytes: text.length },
  };
}
