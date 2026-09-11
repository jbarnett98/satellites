/**
 * Time scales the globe needs. Everything is UTC; we ignore UT1−UTC (< 0.9 s), which is
 * far below anything visible at globe scale.
 */

export const MS_PER_DAY = 86_400_000;
export const JD_UNIX_EPOCH = 2_440_587.5; // Julian date of 1970-01-01T00:00:00Z
export const JD_J2000 = 2_451_545.0; // Julian date of 2000-01-01T12:00:00 TT
export const TWO_PI = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** Julian date from a Unix millisecond timestamp. */
export function julianDate(ms: number): number {
  return ms / MS_PER_DAY + JD_UNIX_EPOCH;
}

/** Julian centuries since J2000.0. */
export function julianCenturiesJ2000(jd: number): number {
  return (jd - JD_J2000) / 36525;
}

/**
 * Greenwich Mean Sidereal Time, radians in [0, 2π).
 * Vallado's polynomial (same form satellite.js uses), so the Earth we draw rotates in
 * exactly the frame the SGP4 output will later be expressed in.
 */
export function gmst(jd: number): number {
  const t = julianCenturiesJ2000(jd);
  let seconds =
    -6.2e-6 * t * t * t +
    0.093104 * t * t +
    (876600 * 3600 + 8640184.812866) * t +
    67310.54841;
  // seconds of time → radians: 360° / 86400 s = 1/240 deg per second
  let rad = ((seconds * DEG2RAD) / 240) % TWO_PI;
  if (rad < 0) rad += TWO_PI;
  return rad;
}

export function wrap180(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  return d === -180 ? 180 : d;
}

export function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
