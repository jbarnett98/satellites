/**
 * Reference frames and the Earth figure.
 *
 * Scene units are kilometres. The scene is laid out in the Earth-centred inertial (ECI)
 * frame — x toward the vernal equinox, z toward the north pole — remapped to Three.js's
 * y-up convention:  scene.x = eci.x,  scene.y = eci.z,  scene.z = -eci.y.
 * That mapping is right-handed, puts north up, and makes east longitude increase toward
 * -z, which is exactly how an equirectangular texture wraps onto a Three.js SphereGeometry.
 *
 * The Earth mesh is rotated about scene-y by GMST; that is the only thing that turns it
 * from an inertial sphere into the real, rotating Earth.
 */

import { Vector3 } from 'three';
import { DEG2RAD, RAD2DEG } from './time';

export const WGS84_A_KM = 6378.137; // equatorial radius
export const WGS84_F = 1 / 298.257223563; // flattening
export const WGS84_B_KM = WGS84_A_KM * (1 - WGS84_F); // polar radius ≈ 6356.752
export const WGS84_E2 = WGS84_F * (2 - WGS84_F); // first eccentricity squared
export const EARTH_MEAN_RADIUS_KM = 6371.0088;
/** Earth's gravitational parameter, km³/s² — used for the short between-tick extrapolation of satellites. */
export const EARTH_MU_KM3_S2 = 398600.4418;

/** ECI (x, y, z) → scene Vector3. */
export function eciToScene(x: number, y: number, z: number, out = new Vector3()): Vector3 {
  return out.set(x, z, -y);
}

/** Scene Vector3 → ECI [x, y, z]. */
export function sceneToEci(v: Vector3): [number, number, number] {
  return [v.x, -v.z, v.y];
}

/** Right ascension / declination (degrees) at radius r → scene position. */
export function raDecToScene(raDeg: number, decDeg: number, r: number, out = new Vector3()): Vector3 {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cd = Math.cos(dec);
  return eciToScene(r * cd * Math.cos(ra), r * cd * Math.sin(ra), r * Math.sin(dec), out);
}

/**
 * Spherical lat/lon (degrees) of a scene-space point expressed in the Earth-fixed frame,
 * i.e. after removing the Earth's rotation. Good enough for the camera readout; satellites
 * use the proper WGS84 conversion below.
 */
export function sceneEarthFixedToLatLon(p: Vector3): { latDeg: number; lonDeg: number; rKm: number } {
  const r = p.length();
  const latDeg = Math.asin(p.y / r) * RAD2DEG;
  const lonDeg = Math.atan2(-p.z, p.x) * RAD2DEG;
  return { latDeg, lonDeg, rKm: r };
}

/** ECI → Earth-fixed (ECEF) by the sidereal angle. Plain ECI axes in and out (x, y, z km), not scene. */
export function eciToEcef(x: number, y: number, z: number, gmstRad: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const c = Math.cos(gmstRad);
  const s = Math.sin(gmstRad);
  out[0] = c * x + s * y;
  out[1] = -s * x + c * y;
  out[2] = z;
  return out;
}

export interface Geodetic {
  latDeg: number;
  lonDeg: number;
  /** Height above the WGS84 ellipsoid, km. */
  heightKm: number;
}

/**
 * WGS84 geodetic latitude, longitude and ellipsoidal height of an Earth-fixed point.
 * Iterates the standard fixed-point form; converges to double precision in 3–4 rounds.
 */
export function ecefToGeodetic(x: number, y: number, z: number): Geodetic {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - WGS84_E2));
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const sl = Math.sin(lat);
    const n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sl * sl);
    // Near the poles p/cos(lat) is ill-conditioned; the z form is exact there.
    h = Math.abs(lat) < Math.PI / 4 ? p / Math.cos(lat) - n : z / sl - n * (1 - WGS84_E2);
    const next = Math.atan2(z, p * (1 - (WGS84_E2 * n) / (n + h)));
    const done = Math.abs(next - lat) < 1e-12;
    lat = next;
    if (done) break;
  }
  return { latDeg: lat * RAD2DEG, lonDeg: lon * RAD2DEG, heightKm: h };
}
