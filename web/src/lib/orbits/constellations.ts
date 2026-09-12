/**
 * Named groups of objects a visitor can pick out of the catalogue: constellations and
 * fleets recognised by name, plus the pipeline's own groups (stations, recent launches,
 * the three debris clouds). Membership is decided once per snapshot and stored as one
 * small integer per object.
 *
 * The name rules were written against the real snapshot (2026-09-11), not guessed — see
 * the counts in the Stage 5 brief. A constellation rule applies to payloads only, so
 * "IRIDIUM 33 DEB" stays in the Iridium 33 debris cloud, not in the Iridium fleet.
 */

import type { SatelliteCatalog } from './SatelliteCatalog';

export type GroupCategory = 'broadband' | 'navigation' | 'observation' | 'communications' | 'stations' | 'debris';

export const GROUP_CATEGORY_LABELS: Record<GroupCategory, string> = {
  broadband: 'Broadband megaconstellations',
  communications: 'Communications and IoT',
  navigation: 'Navigation',
  observation: 'Earth observation and weather',
  stations: 'Stations and recent launches',
  debris: 'Debris clouds',
};

export interface GroupDefinition {
  id: string;
  label: string;
  operator: string;
  category: GroupCategory;
  /** Name pattern (payloads only), or … */
  name?: RegExp;
  /** … a pipeline group the object appeared in (any type). */
  pipelineGroup?: string;
}

/** Order matters: the first matching rule wins. */
export const GROUPS: GroupDefinition[] = [
  { id: 'starlink', label: 'Starlink', operator: 'SpaceX', category: 'broadband', name: /^STARLINK/ },
  { id: 'oneweb', label: 'OneWeb', operator: 'Eutelsat OneWeb', category: 'broadband', name: /^ONEWEB/ },
  { id: 'kuiper', label: 'Kuiper', operator: 'Amazon', category: 'broadband', name: /^KUIPER/ },
  { id: 'qianfan', label: 'Qianfan (Thousand Sails)', operator: 'SSST', category: 'broadband', name: /^QIANFAN/ },
  { id: 'guowang', label: 'Guowang', operator: 'China SatNet', category: 'broadband', name: /^(HULIANWANG|GUOWANG)/ },
  { id: 'spacemobile', label: 'BlueBird', operator: 'AST SpaceMobile', category: 'broadband', name: /^(SPACEMOBILE|BLUEBIRD)/ },

  { id: 'iridium', label: 'Iridium NEXT', operator: 'Iridium', category: 'communications', name: /^IRIDIUM/ },
  { id: 'globalstar', label: 'Globalstar', operator: 'Globalstar', category: 'communications', name: /^GLOBALSTAR/ },
  { id: 'orbcomm', label: 'Orbcomm', operator: 'Orbcomm', category: 'communications', name: /^ORBCOMM/ },
  { id: 'o3b', label: 'O3b', operator: 'SES', category: 'communications', name: /^O3B/ },
  { id: 'lemur', label: 'Lemur', operator: 'Spire', category: 'communications', name: /^LEMUR/ },
  { id: 'kineis', label: 'Kinéis', operator: 'Kinéis', category: 'communications', name: /^KINEIS/ },
  { id: 'gonets', label: 'Gonets', operator: 'Gonets Satellite System', category: 'communications', name: /^GONETS/ },
  { id: 'tianqi', label: 'Tianqi', operator: 'Guodian Gaoke', category: 'communications', name: /^TIANQI/ },
  { id: 'centispace', label: 'Centispace', operator: 'Future Navigation', category: 'communications', name: /^CENTISPACE/ },
  { id: 'lynk', label: 'Lynk', operator: 'Lynk Global', category: 'communications', name: /^LYNK/ },
  { id: 'intelsat', label: 'Intelsat', operator: 'Intelsat', category: 'communications', name: /^INTELSAT/ },
  { id: 'ses', label: 'SES', operator: 'SES', category: 'communications', name: /^SES[ -]/ },
  { id: 'eutelsat', label: 'Eutelsat', operator: 'Eutelsat', category: 'communications', name: /^EUTELSAT/ },
  { id: 'inmarsat', label: 'Inmarsat', operator: 'Viasat', category: 'communications', name: /^INMARSAT/ },
  { id: 'zhongxing', label: 'Zhongxing (ChinaSat)', operator: 'China Satcom', category: 'communications', name: /^ZHONGXING/ },

  { id: 'gps', label: 'GPS', operator: 'US Space Force', category: 'navigation', name: /^NAVSTAR/ },
  { id: 'galileo', label: 'Galileo', operator: 'EUSPA', category: 'navigation', name: /GALILEO/ },
  { id: 'glonass', label: 'GLONASS', operator: 'Roscosmos', category: 'navigation', name: /GLONASS/ },
  { id: 'beidou', label: 'BeiDou', operator: 'CNSA', category: 'navigation', name: /^BEIDOU/ },

  { id: 'planet', label: 'Flock / SkySat / Pelican', operator: 'Planet Labs', category: 'observation', name: /^(FLOCK|SKYSAT|PELICAN|TANAGER)/ },
  { id: 'iceye', label: 'ICEYE', operator: 'ICEYE', category: 'observation', name: /^ICEYE/ },
  { id: 'capella', label: 'Capella', operator: 'Capella Space', category: 'observation', name: /^CAPELLA/ },
  { id: 'hawkeye', label: 'Hawk', operator: 'HawkEye 360', category: 'observation', name: /^HAWK[ -]/ },
  { id: 'jilin', label: 'Jilin-1', operator: 'Chang Guang', category: 'observation', name: /^JILIN/ },
  { id: 'yaogan', label: 'Yaogan', operator: 'PLA', category: 'observation', name: /^YAOGAN/ },
  { id: 'geesat', label: 'Geesat', operator: 'Geely', category: 'observation', name: /^GEESAT/ },
  { id: 'tianmu', label: 'Tianmu', operator: 'CASIC', category: 'observation', name: /^TIANMU/ },
  { id: 'nusat', label: 'NuSat', operator: 'Satellogic', category: 'observation', name: /^NUSAT/ },
  { id: 'sentinel', label: 'Sentinel', operator: 'ESA / Copernicus', category: 'observation', name: /^SENTINEL/ },
  { id: 'fengyun', label: 'Fengyun', operator: 'CMA', category: 'observation', name: /^FENGYUN/ },
  { id: 'weather-geo', label: 'Geostationary weather', operator: 'NOAA · EUMETSAT · JMA · Roshydromet', category: 'observation', name: /^(GOES|METEOSAT|HIMAWARI|ELEKTRO-L|GK-2A|INSAT-3D)/ },
  { id: 'noaa', label: 'NOAA · Metop · Suomi · JPSS', operator: 'NOAA / EUMETSAT', category: 'observation', name: /^(NOAA|METOP|SUOMI|JPSS)/ },

  { id: 'stations', label: 'Stations and visiting vehicles', operator: 'ISS · Tiangong', category: 'stations', pipelineGroup: 'stations' },
  { id: 'recent', label: 'Launched in the last 30 days', operator: '', category: 'stations', pipelineGroup: 'last-30-days' },

  { id: 'fengyun-1c-debris', label: 'Fengyun-1C debris', operator: '2007 anti-satellite test', category: 'debris', pipelineGroup: 'fengyun-1c-debris' },
  { id: 'iridium-33-debris', label: 'Iridium 33 debris', operator: '2009 collision', category: 'debris', pipelineGroup: 'iridium-33-debris' },
  { id: 'cosmos-2251-debris', label: 'Cosmos 2251 debris', operator: '2009 collision', category: 'debris', pipelineGroup: 'cosmos-2251-debris' },
];

export const GROUP_BY_ID = new Map(GROUPS.map((g, i) => [g.id, i]));

/**
 * One small integer per object: the index into GROUPS of the first rule that matches, or −1.
 * Pipeline-group rules are checked for every object; name rules for payloads only.
 */
export function assignGroups(catalog: SatelliteCatalog): Int16Array {
  const out = new Int16Array(catalog.count).fill(-1);
  const d = catalog.data;
  for (let i = 0; i < catalog.count; i++) {
    const name = d.OBJECT_NAME[i];
    const groups = d.GROUPS[i] ?? [];
    const payload = catalog.typeCode[i] === 0;
    for (let g = 0; g < GROUPS.length; g++) {
      const rule = GROUPS[g];
      if (rule.pipelineGroup) {
        // Stations and recent launches are payload groups too; debris clouds take everything.
        if (groups.includes(rule.pipelineGroup) && (rule.category === 'debris' || payload)) {
          out[i] = g;
          break;
        }
      } else if (rule.name && payload && rule.name.test(name)) {
        out[i] = g;
        break;
      }
    }
  }
  return out;
}

export interface GroupSummary {
  count: number;
  byType: number[];
  /** Inclination clusters, most populated first: [degrees, objects]. */
  inclinations: [number, number][];
  /** Median perigee and apogee altitude, km. */
  perigeeKm: number;
  apogeeKm: number;
  /** Regime counts in REGIMES order. */
  byRegime: number[];
  oldestLaunch: string;
  newestLaunch: string;
  launchedLast30Days: number;
  /** Top owners as [code, count]. */
  owners: [string, number][];
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Describe any set of object indices — a constellation, an owner, a search result. */
export function summariseObjects(catalog: SatelliteCatalog, indices: ArrayLike<number>): GroupSummary {
  const d = catalog.data;
  const byType = [0, 0, 0, 0];
  const byRegime = [0, 0, 0, 0, 0];
  const inc = new Map<number, number>();
  const owners = new Map<string, number>();
  const peri: number[] = [];
  const apo: number[] = [];
  let oldest = '';
  let newest = '';
  let recent = 0;
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    byType[catalog.typeCode[i]]++;
    byRegime[catalog.regimeCode[i]]++;
    const bin = Math.round(d.INCLINATION[i] * 2) / 2;
    inc.set(bin, (inc.get(bin) ?? 0) + 1);
    const owner = d.OWNER[i] || '?';
    owners.set(owner, (owners.get(owner) ?? 0) + 1);
    peri.push(d.PERIGEE_KM[i]);
    apo.push(d.APOGEE_KM[i]);
    const launch = d.LAUNCH_DATE[i];
    if (launch) {
      if (!oldest || launch < oldest) oldest = launch;
      if (!newest || launch > newest) newest = launch;
    }
    if ((d.GROUPS[i] ?? []).includes('last-30-days')) recent++;
  }
  return {
    count: indices.length,
    byType,
    byRegime,
    inclinations: [...inc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    perigeeKm: median(peri),
    apogeeKm: median(apo),
    oldestLaunch: oldest,
    newestLaunch: newest,
    launchedLast30Days: recent,
    owners: [...owners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
  };
}
