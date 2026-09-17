/**
 * The propagation worker: owns one satellite.js record per object and, on request, runs
 * SGP4/SDP4 for every object at a single simulation time. Off the main thread so the
 * frame loop never waits on it.
 *
 * Output per tick is two Float32Arrays — position (km) and velocity (km/s) — in the
 * renderer's *scene* frame: ECI with y up, i.e. (x, z, −y) of the propagator's (x, y, z).
 * The swizzle is done here so the buffers can go straight to the GPU. See
 * lib/astro/frames.ts for the frame convention.
 *
 * Buffers are transferred, not copied; the main thread hands them back ('recycle') once
 * it has copied them, so steady state allocates nothing.
 *
 * Messages in:  init | propagate | orbitPath | passes | recycle
 * Messages out: ready | frame | orbitPath | passes | error
 */

import { json2satrec, sgp4, type SatRec } from 'satellite.js';
import type { ObserverGeodetic, Vec3 } from '../astro/topocentric';
import type { OmmColumns } from './loadOrbitSnapshot';
import { predictPasses, type Pass } from './predictPasses';

export type WorkerRequest =
  | { type: 'init'; count: number; omm: OmmColumns }
  | { type: 'propagate'; seq: number; simMs: number }
  | { type: 'orbitPath'; requestId: number; index: number; startMs: number; periodMs: number; samples: number }
  | { type: 'passes'; requestId: number; indices: number[]; observer: ObserverGeodetic; startMs: number; endMs: number; minElevationDeg: number }
  | { type: 'recycle'; pos: ArrayBuffer; vel: ArrayBuffer };

export type WorkerResponse =
  | { type: 'ready'; count: number; initMs: number; initErrors: number }
  | { type: 'frame'; seq: number; simMs: number; pos: ArrayBuffer; vel: ArrayBuffer; computeMs: number; errors: number }
  | { type: 'orbitPath'; requestId: number; index: number; startMs: number; periodMs: number; points: ArrayBuffer }
  | { type: 'passes'; requestId: number; passes: Pass[]; computeMs: number; evaluations: number }
  | { type: 'error'; message: string };

const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JD = 2_440_587.5;
const MIN_PER_DAY = 1440;

let satrecs: SatRec[] = [];
let count = 0;
const pool: { pos: ArrayBuffer; vel: ArrayBuffer }[] = [];

const post = (msg: WorkerResponse, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(msg, transfer ?? []);

function init(n: number, omm: OmmColumns): void {
  const t0 = performance.now();
  satrecs = new Array<SatRec>(n);
  let initErrors = 0;
  for (let i = 0; i < n; i++) {
    const rec = json2satrec({
      OBJECT_NAME: omm.OBJECT_NAME[i],
      OBJECT_ID: omm.OBJECT_ID[i],
      NORAD_CAT_ID: omm.NORAD_CAT_ID[i],
      EPOCH: omm.EPOCH[i],
      MEAN_MOTION: omm.MEAN_MOTION[i],
      ECCENTRICITY: omm.ECCENTRICITY[i],
      INCLINATION: omm.INCLINATION[i],
      RA_OF_ASC_NODE: omm.RA_OF_ASC_NODE[i],
      ARG_OF_PERICENTER: omm.ARG_OF_PERICENTER[i],
      MEAN_ANOMALY: omm.MEAN_ANOMALY[i],
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: 'U',
      ELEMENT_SET_NO: omm.ELEMENT_SET_NO[i],
      REV_AT_EPOCH: omm.REV_AT_EPOCH[i],
      BSTAR: omm.BSTAR[i],
      MEAN_MOTION_DOT: omm.MEAN_MOTION_DOT[i],
      MEAN_MOTION_DDOT: omm.MEAN_MOTION_DDOT[i],
    });
    if (rec.error !== 0) initErrors++;
    satrecs[i] = rec;
  }
  count = n;
  pool.length = 0;
  for (let k = 0; k < 3; k++) pool.push({ pos: new ArrayBuffer(n * 12), vel: new ArrayBuffer(n * 12) });
  post({ type: 'ready', count: n, initMs: performance.now() - t0, initErrors });
}

function propagateAll(seq: number, simMs: number): void {
  const t0 = performance.now();
  const jd = simMs / MS_PER_DAY + UNIX_EPOCH_JD;
  const buf = pool.pop() ?? { pos: new ArrayBuffer(count * 12), vel: new ArrayBuffer(count * 12) };
  const pos = new Float32Array(buf.pos);
  const vel = new Float32Array(buf.vel);
  let errors = 0;

  for (let i = 0; i < count; i++) {
    const s = satrecs[i];
    const r = sgp4(s, (jd - s.jdsatepoch) * MIN_PER_DAY);
    const o = i * 3;
    if (r === null) {
      // Decayed or diverged at this time: park it at the centre, where the Earth hides it.
      errors++;
      pos[o] = pos[o + 1] = pos[o + 2] = 0;
      vel[o] = vel[o + 1] = vel[o + 2] = 0;
      continue;
    }
    pos[o] = r.position.x;
    pos[o + 1] = r.position.z;
    pos[o + 2] = -r.position.y;
    vel[o] = r.velocity.x;
    vel[o + 1] = r.velocity.z;
    vel[o + 2] = -r.velocity.y;
  }

  post({ type: 'frame', seq, simMs, pos: buf.pos, vel: buf.vel, computeMs: performance.now() - t0, errors }, [buf.pos, buf.vel]);
}

/** One closed revolution of a single object, `samples + 1` points, first == last in time-phase. */
function orbitPath(requestId: number, index: number, startMs: number, periodMs: number, samples: number): void {
  const s = satrecs[index];
  const out = new Float32Array((samples + 1) * 3);
  for (let k = 0; k <= samples; k++) {
    const tMs = startMs + (periodMs * k) / samples;
    const jd = tMs / MS_PER_DAY + UNIX_EPOCH_JD;
    const r = sgp4(s, (jd - s.jdsatepoch) * MIN_PER_DAY);
    const o = k * 3;
    if (r === null) {
      out[o] = out[o + 1] = out[o + 2] = 0;
      continue;
    }
    out[o] = r.position.x;
    out[o + 1] = r.position.z;
    out[o + 2] = -r.position.y;
  }
  post({ type: 'orbitPath', requestId, index, startMs, periodMs, points: out.buffer }, [out.buffer]);
}

/**
 * Passes of the given objects over an observer within a time window. Each object is
 * propagated on demand through `predictPasses`; results come back flat, sorted by rise time.
 */
function passes(requestId: number, indices: number[], observer: ObserverGeodetic, startMs: number, endMs: number, minElevationDeg: number): void {
  const t0 = performance.now();
  let evaluations = 0;
  const out: Pass[] = [];
  for (const index of indices) {
    const s = satrecs[index];
    if (!s || s.error !== 0) continue;
    const eph = (ms: number): Vec3 | null => {
      evaluations++;
      const jd = ms / MS_PER_DAY + UNIX_EPOCH_JD;
      const r = sgp4(s, (jd - s.jdsatepoch) * MIN_PER_DAY);
      return r === null ? null : [r.position.x, r.position.y, r.position.z];
    };
    const periodMin = (2 * Math.PI) / s.no;
    out.push(...predictPasses(index, eph, periodMin, observer, startMs, endMs, { minElevationDeg }));
  }
  out.sort((a, b) => a.riseMs - b.riseMs);
  post({ type: 'passes', requestId, passes: out, computeMs: performance.now() - t0, evaluations });
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init':
        init(m.count, m.omm);
        break;
      case 'propagate':
        propagateAll(m.seq, m.simMs);
        break;
      case 'orbitPath':
        orbitPath(m.requestId, m.index, m.startMs, m.periodMs, m.samples);
        break;
      case 'passes':
        passes(m.requestId, m.indices, m.observer, m.startMs, m.endMs, m.minElevationDeg);
        break;
      case 'recycle':
        if (m.pos.byteLength === count * 12 && pool.length < 4) pool.push({ pos: m.pos, vel: m.vel });
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
