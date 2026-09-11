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
export const EARTH_MEAN_RADIUS_KM = 6371.0088;

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
 * Geodetic-ish lat/lon (degrees, spherical) of a scene-space point expressed in the
 * Earth-fixed frame, i.e. after removing the Earth's rotation. Good enough for a status
 * readout; proper WGS84 geodetic conversion arrives with the satellite layer.
 */
export function sceneEarthFixedToLatLon(p: Vector3): { latDeg: number; lonDeg: number; rKm: number } {
  const r = p.length();
  const latDeg = Math.asin(p.y / r) * RAD2DEG;
  const lonDeg = Math.atan2(-p.z, p.x) * RAD2DEG;
  return { latDeg, lonDeg, rKm: r };
}
