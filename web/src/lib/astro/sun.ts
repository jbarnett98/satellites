/**
 * Apparent solar position — the low-precision algorithm from the Astronomical Almanac
 * (also Vallado, Algorithm 29). Accurate to ~0.01°, which is far finer than the width of
 * the terminator we draw. Output is a unit vector in the Earth-centred inertial frame
 * (mean equator and equinox of date, indistinguishable from TEME at this precision).
 */

import { DEG2RAD, RAD2DEG, gmst, julianCenturiesJ2000, wrap180, wrap360 } from './time';

export interface SunState {
  /** Unit vector toward the Sun, ECI, [x, y, z]. */
  dir: readonly [number, number, number];
  rightAscensionDeg: number;
  declinationDeg: number;
  /** Point on Earth directly beneath the Sun. */
  subsolarLatDeg: number;
  subsolarLonDeg: number;
  distanceAu: number;
}

export function sunState(jd: number): SunState {
  const t = julianCenturiesJ2000(jd);

  const meanLonDeg = wrap360(280.46 + 36000.771 * t);
  const meanAnom = wrap360(357.5291092 + 35999.05034 * t) * DEG2RAD;
  const eclLon =
    (meanLonDeg + 1.914666471 * Math.sin(meanAnom) + 0.019994643 * Math.sin(2 * meanAnom)) *
    DEG2RAD;
  const obliquity = (23.439291 - 0.0130042 * t) * DEG2RAD;
  const distanceAu =
    1.000140612 - 0.016708617 * Math.cos(meanAnom) - 0.000139589 * Math.cos(2 * meanAnom);

  const x = Math.cos(eclLon);
  const y = Math.cos(obliquity) * Math.sin(eclLon);
  const z = Math.sin(obliquity) * Math.sin(eclLon);

  const dec = Math.asin(z);
  const ra = Math.atan2(y, x);

  return {
    dir: [x, y, z],
    rightAscensionDeg: wrap360(ra * RAD2DEG),
    declinationDeg: dec * RAD2DEG,
    subsolarLatDeg: dec * RAD2DEG,
    // Sub-solar longitude: where the Sun's right ascension lines up with local sidereal time.
    subsolarLonDeg: wrap180((ra - gmst(jd)) * RAD2DEG),
    distanceAu,
  };
}
