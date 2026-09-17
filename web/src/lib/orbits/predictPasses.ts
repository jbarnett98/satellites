/**
 * Pass prediction: when does a satellite rise above an observer's horizon, how high does it
 * get, and could you actually see it?
 *
 * Method. Elevation is sampled along the orbit at a coarse step (about 1/180 of a period —
 * 30 s for a 92-minute orbit, capped at 2 minutes), which is fine enough that a pass can't
 * hide between samples: a LEO satellite takes at least a couple of minutes to cross 0°. Each
 * upward crossing is refined by bisection to well under a second, the peak by golden-section
 * search, and the downward crossing by bisection again. A pass whose peak stays below the
 * minimum elevation is dropped.
 *
 * Visibility. A satellite is visible to the eye when it is in sunlight while the observer's
 * sky is dark (Sun more than 6° below the horizon — the end of civil twilight). The pass is
 * sampled every few seconds for that, and the samples are kept so the sky chart can draw
 * the track with its visible portion marked.
 *
 * The propagator is passed in as a function, so this file has no satellite.js dependency
 * and can be tested against any ephemeris.
 */

import { sunState } from '../astro/sun';
import { gmst, julianDate } from '../astro/time';
import {
  CIVIL_TWILIGHT_DEG,
  directionElevationDeg,
  elevationDeg,
  inEarthShadow,
  lookAngles,
  observerEcef,
  observerInertial,
  type LookAngles,
  type ObserverEcef,
  type ObserverGeodetic,
  type ObserverInertial,
  type Vec3,
} from '../astro/topocentric';

/** Position of an object at a Unix millisecond time, ECI km, or null if it cannot be propagated. */
export type Ephemeris = (ms: number) => Vec3 | null;

export interface PassSample {
  ms: number;
  azDeg: number;
  elDeg: number;
  /** Sunlit satellite over a dark sky: visible to the eye. */
  visible: boolean;
  sunlit: boolean;
}

export interface Pass {
  index: number;
  riseMs: number;
  setMs: number;
  maxMs: number;
  riseAzDeg: number;
  setAzDeg: number;
  maxAzDeg: number;
  maxElDeg: number;
  /** The pass had already begun at the start of the window. */
  inProgress: boolean;
  /** The pass is still going at the end of the window. */
  runsPastEnd: boolean;
  /** First and last moments the object is visible to the eye, or null if never during this pass. */
  visibleFromMs: number | null;
  visibleToMs: number | null;
  /** Peak elevation while visible, degrees (0 if never visible). */
  visibleMaxElDeg: number;
  /** Sky at the peak: is it dark (Sun below civil twilight)? */
  darkAtMax: boolean;
  samples: PassSample[];
}

export interface PassOptions {
  /** Drop passes that never reach this elevation. Degrees. */
  minElevationDeg: number;
  /** Cap on the number of passes returned per object. */
  maxPasses?: number;
  /** Spacing of the kept samples along each pass, seconds. */
  sampleStepS?: number;
}

const MIN_STEP_S = 20;
const MAX_STEP_S = 120;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

class Sky {
  private readonly eph: Ephemeris;
  private readonly ecef: ObserverEcef;
  private readonly frame: ObserverInertial = { pos: [0, 0, 0], east: [0, 0, 0], north: [0, 0, 0], up: [0, 0, 0], gmstRad: 0 };
  private readonly look: LookAngles = { azDeg: 0, elDeg: 0, rangeKm: 0 };

  constructor(observer: ObserverGeodetic, eph: Ephemeris) {
    this.eph = eph;
    this.ecef = observerEcef(observer);
  }

  /** The observer's frame at `ms`, in ECI. */
  at(ms: number): ObserverInertial {
    return observerInertial(this.ecef, gmst(julianDate(ms)), this.frame);
  }

  /** Elevation of the object at `ms`, or −90 if it cannot be propagated. */
  elevation(ms: number): number {
    const p = this.eph(ms);
    if (!p) return -90;
    return elevationDeg(this.at(ms), p[0], p[1], p[2]);
  }

  /** Full sample: look angles plus lighting. */
  sample(ms: number): PassSample | null {
    const p = this.eph(ms);
    if (!p) return null;
    const o = this.at(ms);
    lookAngles(o, p[0], p[1], p[2], this.look);
    const sun = sunState(julianDate(ms));
    const sunlit = !inEarthShadow(p[0], p[1], p[2], sun.dir);
    const dark = directionElevationDeg(o, sun.dir) < CIVIL_TWILIGHT_DEG;
    return { ms, azDeg: this.look.azDeg, elDeg: this.look.elDeg, visible: sunlit && dark, sunlit };
  }

  sunElevation(ms: number): number {
    return directionElevationDeg(this.at(ms), sunState(julianDate(ms)).dir);
  }
}

/** Time at which elevation crosses zero between `a` (below) and `b` (above), or the reverse. */
function bisectHorizon(sky: Sky, a: number, b: number, rising: boolean): number {
  let lo = a;
  let hi = b;
  for (let k = 0; k < 16; k++) {
    const mid = (lo + hi) / 2;
    const up = sky.elevation(mid) >= 0;
    if (up === rising) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Time of peak elevation in [a, b] by golden-section search. */
function peak(sky: Sky, a: number, b: number): number {
  let lo = a;
  let hi = b;
  let x1 = hi - GOLDEN * (hi - lo);
  let x2 = lo + GOLDEN * (hi - lo);
  let f1 = sky.elevation(x1);
  let f2 = sky.elevation(x2);
  for (let k = 0; k < 24; k++) {
    if (f1 < f2) {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + GOLDEN * (hi - lo);
      f2 = sky.elevation(x2);
    } else {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - GOLDEN * (hi - lo);
      f1 = sky.elevation(x1);
    }
  }
  return (lo + hi) / 2;
}

/**
 * Every pass of one object over the observer between `startMs` and `endMs`.
 * `periodMin` sets the coarse search step; `index` is stamped onto each pass for the caller.
 */
export function predictPasses(
  index: number,
  eph: Ephemeris,
  periodMin: number,
  observer: ObserverGeodetic,
  startMs: number,
  endMs: number,
  opts: PassOptions,
): Pass[] {
  const sky = new Sky(observer, eph);
  const stepMs = 1000 * Math.min(MAX_STEP_S, Math.max(MIN_STEP_S, (periodMin * 60) / 180));
  const maxPasses = opts.maxPasses ?? 40;
  const sampleStepMs = 1000 * (opts.sampleStepS ?? 8);
  const passes: Pass[] = [];

  let t = startMs;
  let prevUp = sky.elevation(t) >= 0;
  let riseMs = prevUp ? startMs : NaN;
  let inProgress = prevUp;

  while (t < endMs && passes.length < maxPasses) {
    const next = Math.min(endMs, t + stepMs);
    const up = sky.elevation(next) >= 0;

    if (!prevUp && up) {
      riseMs = bisectHorizon(sky, t, next, true);
      inProgress = false;
    } else if (prevUp && (!up || next >= endMs)) {
      const setMs = !up ? bisectHorizon(sky, t, next, false) : endMs;
      const pass = buildPass(sky, index, riseMs, setMs, inProgress, next >= endMs && up, stepMs, sampleStepMs);
      if (pass.maxElDeg >= opts.minElevationDeg) passes.push(pass);
      riseMs = NaN;
    }

    prevUp = up;
    t = next;
  }
  return passes;
}

function buildPass(sky: Sky, index: number, riseMs: number, setMs: number, inProgress: boolean, runsPastEnd: boolean, stepMs: number, sampleStepMs: number): Pass {
  // Peak: coarse scan between rise and set, then refine around the best coarse sample.
  let bestMs = riseMs;
  let bestEl = -90;
  const n = Math.max(2, Math.ceil((setMs - riseMs) / stepMs) * 2);
  for (let k = 0; k <= n; k++) {
    const ms = riseMs + ((setMs - riseMs) * k) / n;
    const el = sky.elevation(ms);
    if (el > bestEl) {
      bestEl = el;
      bestMs = ms;
    }
  }
  const half = (setMs - riseMs) / n;
  const maxMs = peak(sky, Math.max(riseMs, bestMs - half), Math.min(setMs, bestMs + half));

  // Samples along the pass, for the chart and for the visibility window.
  const samples: PassSample[] = [];
  const count = Math.min(400, Math.max(2, Math.round((setMs - riseMs) / sampleStepMs)));
  for (let k = 0; k <= count; k++) {
    const s = sky.sample(riseMs + ((setMs - riseMs) * k) / count);
    if (s) samples.push(s);
  }
  const atMax = sky.sample(maxMs);
  const rise = samples[0];
  const set = samples[samples.length - 1];

  let visibleFromMs: number | null = null;
  let visibleToMs: number | null = null;
  let visibleMaxElDeg = 0;
  for (const s of samples) {
    if (!s.visible) continue;
    if (visibleFromMs === null) visibleFromMs = s.ms;
    visibleToMs = s.ms;
    if (s.elDeg > visibleMaxElDeg) visibleMaxElDeg = s.elDeg;
  }

  return {
    index,
    riseMs,
    setMs,
    runsPastEnd,
    maxMs,
    riseAzDeg: rise?.azDeg ?? 0,
    setAzDeg: set?.azDeg ?? 0,
    maxAzDeg: atMax?.azDeg ?? 0,
    maxElDeg: atMax?.elDeg ?? bestEl,
    inProgress,
    visibleFromMs,
    visibleToMs,
    visibleMaxElDeg,
    darkAtMax: sky.sunElevation(maxMs) < CIVIL_TWILIGHT_DEG,
    samples,
  };
}
