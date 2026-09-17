/**
 * Which objects get pass predictions. Predicting for the whole catalogue would be tens of
 * millions of SGP4 evaluations a day; a watchlist of a few dozen is a few tens of
 * milliseconds. The list is: the objects people actually look up to see — the stations
 * and the vehicles docked to them, Hubble — plus whatever the visitor has selected, and
 * the picked-out group when it is small enough (GPS, Galileo, the ISS group…).
 */

import type { SatelliteCatalog, CatalogSelection } from './SatelliteCatalog';

/** Always on the list: Hubble. The stations come from the pipeline's `stations` group. */
const ALWAYS_NORAD = [20580];
/** A picked-out group larger than this is not predicted (yet) — see the brief's next avenues. */
export const MAX_GROUP_PASSES = 200;

export interface Watchlist {
  indices: number[];
  /** The picked group was too big to include. */
  groupSkipped: boolean;
}

export function passWatchlist(cat: SatelliteCatalog, selected: number, pick: CatalogSelection): Watchlist {
  const set = new Set<number>();
  const d = cat.data;
  for (let i = 0; i < cat.count; i++) {
    if (!(d.GROUPS[i] ?? []).includes('stations')) continue;
    // CelesTrak's stations group also lists debris shed from the ISS and spent stages: payloads only.
    if (cat.typeCode[i] !== 0) continue;
    // Everything released from the ISS carries its designator, 1998-067; the cubesats it deploys are
    // not what people mean by "the station" and are too small to see. The station itself is 1998-067A.
    const id = d.OBJECT_ID[i];
    if (id.startsWith('1998-067') && id !== '1998-067A') continue;
    set.add(i);
  }
  for (const norad of ALWAYS_NORAD) {
    const i = cat.indexOfNorad(norad);
    if (i >= 0) set.add(i);
  }
  if (selected >= 0) set.add(selected);

  let groupSkipped = false;
  const members = cat.membershipMask(pick);
  if (members) {
    const idx = cat.indicesOf(members);
    if (idx.length <= MAX_GROUP_PASSES) for (const i of idx) set.add(i);
    else groupSkipped = true;
  }
  return { indices: [...set].sort((a, b) => a - b), groupSkipped };
}
