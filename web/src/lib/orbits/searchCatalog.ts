/**
 * Search the catalogue by name, catalogue number or international designator.
 *
 * A linear scan over 19k names is under two milliseconds, so there is no index: each
 * keystroke re-scans. Ranking, best first: exact catalogue number · name starts with the
 * query · designator starts with it · name contains it · number starts with it. Multi-word
 * queries must match every word somewhere in the name ("starlink 36802").
 */

import type { SatelliteCatalog } from './SatelliteCatalog';

export interface SearchHit {
  index: number;
  /** Lower is better. */
  rank: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Every match, not just the returned few — for "40 of 11,129". */
  total: number;
}

const EMPTY: SearchResult = { hits: [], total: 0 };

/** Names people use for objects the catalogue names differently. Whole-query matches only. */
const ALIASES: Record<string, string> = {
  HUBBLE: 'HST',
  'HUBBLE SPACE TELESCOPE': 'HST',
  TIANGONG: 'CSS',
  'CHINESE SPACE STATION': 'CSS',
  'SPACE STATION': 'ISS',
  'INTERNATIONAL SPACE STATION': 'ISS',
  ZARYA: 'ISS (ZARYA)',
  'JAMES WEBB': 'JWST',
  WEBB: 'JWST',
  ENVISAT: 'ENVISAT',
  VANGUARD: 'VANGUARD',
};

const normalise = (s: string) => {
  const q = s.trim().toUpperCase().replace(/\s+/g, ' ');
  return ALIASES[q] ?? q;
};

export function searchCatalog(catalog: SatelliteCatalog, query: string, limit = 40): SearchResult {
  const q = normalise(query);
  if (!q) return EMPTY;
  const d = catalog.data;
  const isNumber = /^\d+$/.test(q);
  const words = q.split(' ');
  const hits: SearchHit[] = [];

  for (let i = 0; i < catalog.count; i++) {
    const name = d.OBJECT_NAME[i].toUpperCase();
    let rank = -1;
    if (isNumber) {
      const id = String(d.NORAD_CAT_ID[i]);
      if (id === q) rank = 0;
      else if (id.startsWith(q)) rank = 4;
      else if (name.includes(q)) rank = 3;
    } else if (words.length === 1) {
      if (name.startsWith(q)) rank = 1;
      else if (d.OBJECT_ID[i].toUpperCase().startsWith(q)) rank = 2;
      else if (name.includes(q)) rank = 3;
    } else {
      let all = true;
      for (const w of words) {
        if (!name.includes(w)) {
          all = false;
          break;
        }
      }
      if (all) rank = name.startsWith(words[0]) ? 1 : 3;
    }
    if (rank >= 0) hits.push({ index: i, rank });
  }

  // Best ranks first, catalogue (launch) order within a rank; only the returned few get name-sorted.
  const out: SearchHit[] = [];
  for (let rank = 0; rank <= 4 && out.length < limit; rank++) {
    for (const h of hits) {
      if (h.rank === rank) {
        out.push(h);
        if (out.length >= limit) break;
      }
    }
  }
  out.sort((a, b) => a.rank - b.rank || d.OBJECT_NAME[a.index].localeCompare(d.OBJECT_NAME[b.index], 'en', { numeric: true }));
  return { hits: out, total: hits.length };
}
