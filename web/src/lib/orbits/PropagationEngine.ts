/**
 * Main-thread side of propagation. Owns the worker, decides *when* to ask it for a new
 * set of positions, and hands finished frames to whoever renders them.
 *
 * Timing model. The worker propagates every object at one simulation instant; between
 * ticks the renderer extrapolates each object along its velocity (plus point-mass gravity)
 * for a few seconds of simulation time. So the tick rate only has to keep that
 * extrapolation short in *simulation* seconds:
 *
 *   rate 1×  → 1 tick/s  → ≤1 s of extrapolation   (error ≪ 1 m)
 *   rate 60× → 30 tick/s → 2 s                       (error ≪ 1 m)
 *   rate 3600× → 30 tick/s → 120 s                   (error ~ hundreds of m for LEO)
 *
 * Each request is aimed at the *middle* of the interval it will be displayed for
 * (now + rate × (round-trip + interval/2)), so the extrapolation runs both backward and
 * forward by half an interval instead of only forward by a whole one.
 *
 * At most one request is in flight. A time jump or a rate change forces a fresh tick.
 */

import type { OmmColumns } from './loadOrbitSnapshot';
import type { WorkerRequest, WorkerResponse } from './propagation.worker';

export interface PropagationFrame {
  seq: number;
  /** Simulation time the positions are exact at (Unix ms). */
  simMs: number;
  /** Scene-frame ECI position, km, ×3 per object. */
  pos: Float32Array;
  /** Scene-frame ECI velocity, km/s, ×3 per object. */
  vel: Float32Array;
  computeMs: number;
  errors: number;
}

export interface PropagationStats {
  ticks: number;
  /** Worker time per tick, ms (smoothed). */
  computeMs: number;
  /** Request → frame received, ms (smoothed). */
  roundTripMs: number;
  /** Ticks per real second over the last second. */
  hz: number;
  errors: number;
  workerInitMs: number;
  initErrors: number;
}

const MIN_INTERVAL_MS = 1000 / 30;
const MAX_INTERVAL_MS = 1000;
/**
 * Predicted-vs-actual sim time gap beyond which we treat the clock as having jumped: 1.5 s of
 * simulation, or whatever 60 ms of real-time jitter amounts to at the current rate — at 3,600×
 * a frame's worth of timing noise is already 1.4 simulated seconds.
 */
const JUMP_TOLERANCE_MS = 1500;
const JUMP_JITTER_REAL_MS = 60;

export class PropagationEngine {
  readonly count: number;
  readonly ready: Promise<{ initMs: number; initErrors: number }>;
  readonly stats: PropagationStats = { ticks: 0, computeMs: 0, roundTripMs: 30, hz: 0, errors: 0, workerInitMs: 0, initErrors: 0 };

  private readonly worker: Worker;
  private isReady = false;
  private disposed = false;

  private seq = 0;
  private inFlight: { seq: number; sentAt: number } | null = null;
  private pending: PropagationFrame | null = null;
  private lastRequestReal = -Infinity;
  private lastRequestSim = NaN;
  private lastRate = NaN;
  private hzWindowStart = 0;
  private hzWindowTicks = 0;

  private orbitPathRequests = new Map<number, (points: Float32Array) => void>();
  private orbitPathSeq = 0;

  constructor(count: number, omm: OmmColumns) {
    this.count = count;
    this.worker = new Worker(new URL('./propagation.worker.ts', import.meta.url), { type: 'module', name: 'propagation' });

    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        switch (m.type) {
          case 'ready':
            this.isReady = true;
            this.stats.workerInitMs = m.initMs;
            this.stats.initErrors = m.initErrors;
            resolve({ initMs: m.initMs, initErrors: m.initErrors });
            break;
          case 'frame':
            this.onFrame(m);
            break;
          case 'orbitPath': {
            const cb = this.orbitPathRequests.get(m.requestId);
            this.orbitPathRequests.delete(m.requestId);
            cb?.(new Float32Array(m.points));
            break;
          }
          case 'error':
            console.error('[propagation worker]', m.message);
            if (!this.isReady) reject(new Error(m.message));
            break;
        }
      };
      this.worker.onerror = (e) => {
        console.error('[propagation worker]', e.message);
        if (!this.isReady) reject(new Error(e.message));
      };
    });

    this.send({ type: 'init', count, omm });
  }

  private send(msg: WorkerRequest, transfer?: Transferable[]): void {
    if (this.disposed) return;
    this.worker.postMessage(msg, transfer ?? []);
  }

  private onFrame(m: Extract<WorkerResponse, { type: 'frame' }>): void {
    const now = performance.now();
    if (this.inFlight && this.inFlight.seq === m.seq) {
      const rtt = now - this.inFlight.sentAt;
      this.stats.roundTripMs = this.stats.roundTripMs * 0.7 + rtt * 0.3;
      this.inFlight = null;
    }
    this.stats.ticks++;
    this.stats.computeMs = this.stats.ticks === 1 ? m.computeMs : this.stats.computeMs * 0.8 + m.computeMs * 0.2;
    this.stats.errors = m.errors;
    this.hzWindowTicks++;
    if (now - this.hzWindowStart >= 1000) {
      this.stats.hz = (this.hzWindowTicks * 1000) / (now - this.hzWindowStart);
      this.hzWindowStart = now;
      this.hzWindowTicks = 0;
    }
    // If the renderer hasn't collected the previous frame yet, the newer one supersedes it.
    if (this.pending) this.recycle(this.pending);
    this.pending = { seq: m.seq, simMs: m.simMs, pos: new Float32Array(m.pos), vel: new Float32Array(m.vel), computeMs: m.computeMs, errors: m.errors };
  }

  /** Interval between ticks for a given time rate (real ms). */
  static intervalFor(rate: number): number {
    if (rate === 0) return Infinity;
    return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, 1000 / Math.abs(rate)));
  }

  /**
   * Call once per rendered frame. Issues a worker request when one is due and returns
   * the newest finished frame, if any arrived since the last call. The caller must copy
   * the frame's arrays and then hand it back through `recycle()`.
   */
  update(simMs: number, rate: number): PropagationFrame | null {
    if (!this.isReady || this.disposed) return null;
    const now = performance.now();

    const predictedSim = this.lastRequestSim + this.lastRate * (now - this.lastRequestReal);
    const tolerance = Math.max(JUMP_TOLERANCE_MS, Math.abs(this.lastRate) * JUMP_JITTER_REAL_MS);
    const jumped = !Number.isFinite(predictedSim) || Math.abs(simMs - predictedSim) > tolerance;
    const rateChanged = rate !== this.lastRate;
    const due = now - this.lastRequestReal >= PropagationEngine.intervalFor(rate);

    if (!this.inFlight && (jumped || rateChanged || due)) {
      const interval = PropagationEngine.intervalFor(rate);
      const lead = rate === 0 ? 0 : rate * (this.stats.roundTripMs + interval / 2);
      const target = simMs + lead;
      const seq = ++this.seq;
      this.inFlight = { seq, sentAt: now };
      this.lastRequestReal = now;
      this.lastRequestSim = simMs;
      this.lastRate = rate;
      this.send({ type: 'propagate', seq, simMs: target });
    }

    const frame = this.pending;
    this.pending = null;
    return frame;
  }

  /** Hand a consumed frame's buffers back to the worker so they can be reused. */
  recycle(frame: PropagationFrame): void {
    const pos = frame.pos.buffer as ArrayBuffer;
    const vel = frame.vel.buffer as ArrayBuffer;
    if (pos.byteLength === 0) return; // already transferred
    this.send({ type: 'recycle', pos, vel }, [pos, vel]);
  }

  /** One revolution of object `index` starting at `startMs`, as scene-frame xyz triples. */
  requestOrbitPath(index: number, startMs: number, periodMs: number, samples = 360): Promise<Float32Array> {
    return new Promise((resolve) => {
      const requestId = ++this.orbitPathSeq;
      this.orbitPathRequests.set(requestId, resolve);
      this.send({ type: 'orbitPath', requestId, index, startMs, periodMs, samples });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.worker.terminate();
    this.orbitPathRequests.clear();
  }
}
