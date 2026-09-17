/**
 * The Earth's figure and gravity, as constants. Kept apart from frames.ts (which imports
 * Three.js) so the propagation worker can use them without pulling the renderer in.
 */

export const WGS84_A_KM = 6378.137; // equatorial radius
export const WGS84_F = 1 / 298.257223563; // flattening
export const WGS84_B_KM = WGS84_A_KM * (1 - WGS84_F); // polar radius ≈ 6356.752
export const WGS84_E2 = WGS84_F * (2 - WGS84_F); // first eccentricity squared
export const EARTH_MEAN_RADIUS_KM = 6371.0088;
/** Earth's gravitational parameter, km³/s² — used for the short between-tick extrapolation of satellites. */
export const EARTH_MU_KM3_S2 = 398600.4418;
