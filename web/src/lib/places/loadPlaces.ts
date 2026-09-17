/**
 * Named places, so the observer can be set by typing a city and a picked point can be
 * described as "near somewhere". Natural Earth's 7,342 populated places (public domain),
 * built by the pipeline into one 325 KB file; fetched once, the first time it is needed.
 */

import { greatCircleKm } from '../astro/topocentric';

export interface Place {
  name: string;
  country: string;
  latDeg: number;
  lonDeg: number;
  population: number;
}

interface PlacesFile {
  source: string;
  columns: string[];
  count: number;
  rows: [string, string, number, number, number][];
}

export const PLACES_URL = '/data/places/places-ne10m.json';

let places: Place[] | null = null;
let loading: Promise<Place[]> | null = null;
let folded: string[] = [];

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function loadPlaces(): Promise<Place[]> {
  if (places) return Promise.resolve(places);
  if (!loading) {
    loading = fetch(PLACES_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`${PLACES_URL}: HTTP ${r.status}`);
        return r.json() as Promise<PlacesFile>;
      })
      .then((doc) => {
        places = doc.rows.map(([name, country, latDeg, lonDeg, population]) => ({ name, country, latDeg, lonDeg, population }));
        folded = places.map((p) => `${fold(p.name)}|${fold(p.country)}`);
        return places;
      })
      .catch((err) => {
        loading = null;
        throw err;
      });
  }
  return loading;
}

export function placesLoaded(): boolean {
  return places !== null;
}

/** Places whose name starts with (rank 0) or contains (rank 1) the query; biggest first within a rank. */
export function searchPlaces(query: string, limit = 8): Place[] {
  if (!places) return [];
  const q = fold(query.trim());
  if (!q) return [];
  const starts: Place[] = [];
  const contains: Place[] = [];
  for (let i = 0; i < places.length && starts.length < limit; i++) {
    const f = folded[i];
    if (f.startsWith(q)) starts.push(places[i]);
    else if (contains.length < limit && f.includes(q)) contains.push(places[i]);
  }
  return starts.concat(contains).slice(0, limit);
}

/** The nearest listed place within `withinKm`, or null. */
export function nearestPlace(latDeg: number, lonDeg: number, withinKm = 150): { place: Place; distanceKm: number } | null {
  if (!places) return null;
  let best: Place | null = null;
  let bestKm = withinKm;
  for (const p of places) {
    // Cheap reject before the trigonometry: one degree of latitude is 111 km.
    if (Math.abs(p.latDeg - latDeg) * 111 > bestKm) continue;
    const d = greatCircleKm(latDeg, lonDeg, p.latDeg, p.lonDeg);
    if (d < bestKm) {
      bestKm = d;
      best = p;
    }
  }
  return best ? { place: best, distanceKm: bestKm } : null;
}
