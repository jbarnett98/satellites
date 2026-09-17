/**
 * What is above an observer right now: one pass over the layer's position buffer, three
 * dot products per object. Runs on the main thread each time new positions land (once a
 * second at real time) — about a millisecond for the whole catalogue.
 */

import { gmst, julianDate } from '../astro/time';
import { lookAngles, observerEcef, observerInertial, toSceneFrame, type LookAngles, type ObserverGeodetic } from '../astro/topocentric';

export interface OverheadScan {
  /** Simulation time the positions were exact at. */
  simMs: number;
  aboveHorizon: number;
  /** … of which above the minimum elevation. */
  aboveMin: number;
  /** [index, azDeg, elDeg, rangeKm] × aboveHorizon, highest first. */
  entries: Float32Array;
  /** 1 = above the horizon (and not filtered out), per object. */
  mask: Uint8Array;
}

const look: LookAngles = { azDeg: 0, elDeg: 0, rangeKm: 0 };

/**
 * `positions` are scene-frame ECI km (×3 per object) valid at `simMs`; `visible` masks out
 * filtered objects so the count matches what is drawn.
 */
export function scanOverhead(
  positions: Float32Array,
  count: number,
  visible: Uint8Array,
  observer: ObserverGeodetic,
  simMs: number,
  minElevationDeg: number,
): OverheadScan {
  const o = toSceneFrame(observerInertial(observerEcef(observer), gmst(julianDate(simMs))));
  const mask = new Uint8Array(count);
  const found: number[] = [];
  const az: number[] = [];
  const el: number[] = [];
  const range: number[] = [];
  let aboveMin = 0;

  for (let i = 0; i < count; i++) {
    if (!visible[i]) continue;
    const k = i * 3;
    const x = positions[k];
    const y = positions[k + 1];
    const z = positions[k + 2];
    if (x === 0 && y === 0 && z === 0) continue; // parked (propagation failed)
    lookAngles(o, x, y, z, look);
    if (look.elDeg <= 0) continue;
    mask[i] = 1;
    found.push(i);
    az.push(look.azDeg);
    el.push(look.elDeg);
    range.push(look.rangeKm);
    if (look.elDeg >= minElevationDeg) aboveMin++;
  }

  const order = found.map((_, j) => j).sort((a, b) => el[b] - el[a]);
  const entries = new Float32Array(order.length * 4);
  for (let n = 0; n < order.length; n++) {
    const j = order[n];
    entries[n * 4] = found[j];
    entries[n * 4 + 1] = az[j];
    entries[n * 4 + 2] = el[j];
    entries[n * 4 + 3] = range[j];
  }
  return { simMs, aboveHorizon: found.length, aboveMin, entries, mask };
}
