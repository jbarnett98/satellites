/**
 * The observer's frame: where a satellite is *in the sky* from a point on the ground.
 *
 * An observer at geodetic (lat, lon, height) has an Earth-fixed position and three local
 * axes — east, north, up (the ellipsoid normal). A satellite's direction from there is the
 * difference vector, resolved onto those axes: azimuth is measured from north through east,
 * elevation from the horizon. Everything here is plain arithmetic on number triples, with
 * no Three.js, so the propagation worker can use it as well as the renderer.
 *
 * Frames. The propagator works in ECI; the observer is fixed to the rotating Earth. Rather
 * than rotate every satellite into the Earth-fixed frame, we rotate the observer (position
 * and axes) into ECI once per instant by the sidereal angle, and take dot products there.
 * `toSceneFrame()` does the same into the renderer's (x, z, −y) scene frame so the layer's
 * position buffer can be scanned as it is.
 */

import { WGS84_A_KM, WGS84_E2 } from './wgs84';
import { DEG2RAD, RAD2DEG } from './time';

export type Vec3 = [number, number, number];

export interface ObserverGeodetic {
  latDeg: number;
  lonDeg: number;
  /** Height above the WGS84 ellipsoid, km. */
  heightKm: number;
}

/** An observer resolved into the Earth-fixed frame: position and the east/north/up axes. */
export interface ObserverEcef {
  pos: Vec3;
  east: Vec3;
  north: Vec3;
  up: Vec3;
}

/** The same observer rotated into an inertial frame at one instant. */
export interface ObserverInertial extends ObserverEcef {
  gmstRad: number;
}

export interface LookAngles {
  azDeg: number;
  elDeg: number;
  rangeKm: number;
}

/** Geodetic → ECEF (km). */
export function geodeticToEcef(latDeg: number, lonDeg: number, heightKm: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  const n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sLat * sLat); // prime vertical radius
  out[0] = (n + heightKm) * cLat * Math.cos(lon);
  out[1] = (n + heightKm) * cLat * Math.sin(lon);
  out[2] = (n * (1 - WGS84_E2) + heightKm) * sLat;
  return out;
}

export function observerEcef(o: ObserverGeodetic): ObserverEcef {
  const lat = o.latDeg * DEG2RAD;
  const lon = o.lonDeg * DEG2RAD;
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  const sLon = Math.sin(lon);
  const cLon = Math.cos(lon);
  return {
    pos: geodeticToEcef(o.latDeg, o.lonDeg, o.heightKm),
    east: [-sLon, cLon, 0],
    north: [-sLat * cLon, -sLat * sLon, cLat],
    up: [cLat * cLon, cLat * sLon, sLat],
  };
}

/** ECEF → ECI by the sidereal angle (the inverse of frames.eciToEcef). */
export function rotateEcefToEci(v: Vec3, gmstRad: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const c = Math.cos(gmstRad);
  const s = Math.sin(gmstRad);
  const x = v[0];
  const y = v[1];
  out[0] = c * x - s * y;
  out[1] = s * x + c * y;
  out[2] = v[2];
  return out;
}

/** The observer at one instant, in ECI. Reuses `out` when given. */
export function observerInertial(obs: ObserverEcef, gmstRad: number, out?: ObserverInertial): ObserverInertial {
  const o = out ?? { pos: [0, 0, 0], east: [0, 0, 0], north: [0, 0, 0], up: [0, 0, 0], gmstRad };
  rotateEcefToEci(obs.pos, gmstRad, o.pos);
  rotateEcefToEci(obs.east, gmstRad, o.east);
  rotateEcefToEci(obs.north, gmstRad, o.north);
  rotateEcefToEci(obs.up, gmstRad, o.up);
  o.gmstRad = gmstRad;
  return o;
}

/** ECI (x, y, z) → the renderer's scene frame (x, z, −y), in place. */
export function toSceneFrame(o: ObserverInertial): ObserverInertial {
  for (const v of [o.pos, o.east, o.north, o.up]) {
    const y = v[1];
    v[1] = v[2];
    v[2] = -y;
  }
  return o;
}

/**
 * Azimuth (from north through east), elevation and range of a point at (x, y, z) — same
 * frame as `o` — from the observer.
 */
export function lookAngles(o: ObserverInertial, x: number, y: number, z: number, out: LookAngles = { azDeg: 0, elDeg: 0, rangeKm: 0 }): LookAngles {
  const dx = x - o.pos[0];
  const dy = y - o.pos[1];
  const dz = z - o.pos[2];
  const e = dx * o.east[0] + dy * o.east[1] + dz * o.east[2];
  const n = dx * o.north[0] + dy * o.north[1] + dz * o.north[2];
  const u = dx * o.up[0] + dy * o.up[1] + dz * o.up[2];
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
  let az = Math.atan2(e, n) * RAD2DEG;
  if (az < 0) az += 360;
  out.azDeg = az;
  out.elDeg = range > 0 ? Math.asin(u / range) * RAD2DEG : 0;
  out.rangeKm = range;
  return out;
}

/** Elevation only — the hot path in pass prediction. Degrees. */
export function elevationDeg(o: ObserverInertial, x: number, y: number, z: number): number {
  const dx = x - o.pos[0];
  const dy = y - o.pos[1];
  const dz = z - o.pos[2];
  const u = dx * o.up[0] + dy * o.up[1] + dz * o.up[2];
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return range > 0 ? Math.asin(u / range) * RAD2DEG : 0;
}

/** Elevation of a direction (unit vector, same frame as `o`) — used for the Sun. */
export function directionElevationDeg(o: ObserverInertial, dir: readonly [number, number, number]): number {
  return Math.asin(Math.max(-1, Math.min(1, dir[0] * o.up[0] + dir[1] * o.up[1] + dir[2] * o.up[2]))) * RAD2DEG;
}

/** Is a point (same frame as `sunDir`) inside the Earth's cylindrical shadow? */
export function inEarthShadow(x: number, y: number, z: number, sunDir: readonly [number, number, number]): boolean {
  const along = x * sunDir[0] + y * sunDir[1] + z * sunDir[2];
  if (along >= 0) return false;
  const px = x - along * sunDir[0];
  const py = y - along * sunDir[1];
  const pz = z - along * sunDir[2];
  return px * px + py * py + pz * pz < WGS84_A_KM * WGS84_A_KM;
}

/** The Sun's altitude that ends civil twilight: below this the sky is dark enough to see satellites. */
export const CIVIL_TWILIGHT_DEG = -6;

export type SkyCondition = 'day' | 'civil twilight' | 'nautical twilight' | 'night';

export function skyCondition(sunElevationDeg: number): SkyCondition {
  if (sunElevationDeg >= 0) return 'day';
  if (sunElevationDeg >= -6) return 'civil twilight';
  if (sunElevationDeg >= -12) return 'nautical twilight';
  return 'night';
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 16-point compass name for an azimuth. */
export function compassPoint(azDeg: number): string {
  return COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16];
}

/** Great-circle distance between two points on the sphere, km. */
export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * DEG2RAD;
  const φ2 = lat2 * DEG2RAD;
  const dφ = φ2 - φ1;
  const dλ = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}
