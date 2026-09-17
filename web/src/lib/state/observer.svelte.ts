/**
 * The observer: where the visitor is standing, and what the sky above them holds. The
 * location is remembered in localStorage; everything else is derived live by the globe
 * (the sky scan) and the propagation worker (pass predictions).
 */

import type { ObserverGeodetic } from '../astro/topocentric';
import type { OverheadScan } from '../orbits/scanOverhead';
import type { Pass } from '../orbits/predictPasses';
import { loadPlaces, nearestPlace, placesLoaded } from '../places/loadPlaces';
import { formatLatLon } from '../format';

export type LocationSource = 'geolocation' | 'globe' | 'place' | 'manual' | 'url';

export interface ObserverLocation extends ObserverGeodetic {
  /** What to call the place: a city name, or a formatted coordinate. */
  label: string;
  source: LocationSource;
}

export interface PassSet {
  /** Where and when the predictions were made for. */
  location: ObserverLocation;
  startMs: number;
  endMs: number;
  minElevationDeg: number;
  /** Object indices the passes were computed for. */
  indices: number[];
  passes: Pass[];
  computeMs: number;
  evaluations: number;
}

const STORAGE_KEY = 'ap.observer';

function restore(): ObserverLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as ObserverLocation;
    if (typeof o.latDeg !== 'number' || typeof o.lonDeg !== 'number') return null;
    return { latDeg: o.latDeg, lonDeg: o.lonDeg, heightKm: o.heightKm ?? 0, label: o.label ?? '', source: o.source ?? 'manual' };
  } catch {
    return null;
  }
}

class ObserverState {
  location = $state<ObserverLocation | null>(restore());
  /** The panel is open. */
  open = $state(false);
  /** The next click on the globe sets the location. */
  picking = $state(false);
  /** Passes below this peak elevation are not worth listing. Degrees. */
  minElevationDeg = $state(10);
  /** Dim everything below the observer's horizon. */
  highlight = $state(true);
  /** Show pass times in the browser's local zone, or UTC. */
  timeZone = $state<'local' | 'utc'>('local');
  /** Geolocation in flight / failed. */
  locating = $state(false);
  locateError = $state<string | null>(null);

  /** The latest sky scan from the globe (status cadence, 5 Hz). */
  scan = $state.raw<OverheadScan | null>(null);
  sunElevationDeg = $state(0);

  /** The latest pass predictions, and whether a request is in flight. */
  passes = $state.raw<PassSet | null>(null);
  passesBusy = $state(false);
  /** Bumped by the scheduler when the prediction window should move on. */
  windowStartMs = $state(0);

  /** Object index the pointer is over in the panel's lists — highlighted on the sky chart. */
  hoveredIndex = $state(-1);
  /** Bumped to ask the globe to swing round to the observer's location. */
  flyRequest = $state(0);

  /** Set the observer at a point, naming it after the nearest listed place once the place list is in. */
  setAt(latDeg: number, lonDeg: number, source: LocationSource, heightKm = 0): void {
    const describe = (): string => {
      const near = placesLoaded() ? nearestPlace(latDeg, lonDeg) : null;
      if (!near) return formatLatLon(latDeg, lonDeg);
      return near.distanceKm < 25 ? near.place.name : `near ${near.place.name}`;
    };
    this.setLocation({ latDeg, lonDeg, heightKm, label: describe(), source });
    if (!placesLoaded()) {
      void loadPlaces()
        .then(() => {
          const cur = this.location;
          if (cur && cur.latDeg === latDeg && cur.lonDeg === lonDeg && cur.source === source) this.setLocation({ ...cur, label: describe() });
        })
        .catch(() => undefined);
    }
  }

  /** Ask the browser where we are. */
  locate(): void {
    if (!('geolocation' in navigator)) {
      this.locateError = 'This browser has no geolocation.';
      return;
    }
    this.locating = true;
    this.locateError = null;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.locating = false;
        // Rounded to ~1 km: enough for the sky, and not a street address.
        this.setAt(Math.round(pos.coords.latitude * 100) / 100, Math.round(pos.coords.longitude * 100) / 100, 'geolocation', Math.max(0, (pos.coords.altitude ?? 0) / 1000));
      },
      (err) => {
        this.locating = false;
        this.locateError = err.code === err.PERMISSION_DENIED ? 'Location permission was refused — pick a place instead.' : `Could not get a location (${err.message}).`;
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 600_000 },
    );
  }

  setLocation(loc: ObserverLocation | null): void {
    this.location = loc;
    this.picking = false;
    this.locateError = null;
    try {
      if (loc) localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // private mode or storage disabled: the location just doesn't persist
    }
  }
}

export const observer = new ObserverState();
