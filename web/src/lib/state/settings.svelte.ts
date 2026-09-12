import type { FrameMode, LayerName } from '../globe/Globe';
import type { SatelliteColorMode } from '../globe/satellites';

export type { FrameMode, LayerName, SatelliteColorMode };

export interface SatelliteSettings {
  /** Master switch for the whole layer. */
  on: boolean;
  /** The active catalogue: active, stations, last-30-days groups. */
  active: boolean;
  /** The three fragmentation clouds (Fengyun-1C, Iridium 33, Cosmos 2251). */
  debrisClouds: boolean;
  colorBy: SatelliteColorMode;
  /** Multiplier on point size; 1 = calibrated default. */
  sizeScale: number;
  /** Dim objects inside the Earth's shadow. */
  earthShadow: boolean;
  /** Draw one revolution of the selected object's orbit. */
  orbitPath: boolean;
  /** Per OBJECT_TYPES code: payload, rocket body, debris, unknown. */
  types: boolean[];
}

/** A group or owner the visitor has picked out of the catalogue. */
export interface GroupPick {
  /** Index into GROUPS (constellations.ts), or −1. */
  group: number;
  /** SATCAT owner code, or null. */
  owner: string | null;
  /** Dim everything else, or hide it. */
  mode: 'dim' | 'hide';
}

export const LAYER_LABELS: Record<LayerName, { label: string; hint: string }> = {
  dayNight: { label: 'Day / night', hint: 'Shade the planet by the Sun; off = fully lit' },
  nightLights: { label: 'City lights', hint: 'NASA Black Marble on the night side' },
  clouds: { label: 'Clouds', hint: 'NASA cloud composite, ~25 km up, drifting 0.25°/h' },
  atmosphere: { label: 'Atmosphere', hint: 'Limb glow and twilight' },
  stars: { label: 'Stars', hint: '119,613 stars from the HYG catalogue' },
  graticule: { label: 'Graticule', hint: '15° latitude / longitude grid' },
};

class Settings {
  frame = $state<FrameMode>('eci');
  layers = $state<Record<LayerName, boolean>>({
    dayNight: true,
    nightLights: true,
    clouds: true,
    atmosphere: true,
    stars: true,
    graticule: false,
  });
  /** Multiplier on plotted-star brightness; 1 = calibrated default. */
  starBrightness = $state(1);
  layersOpen = $state(false);
  satellites = $state<SatelliteSettings>({
    on: true,
    active: true,
    debrisClouds: false,
    colorBy: 'type',
    sizeScale: 1,
    earthShadow: true,
    orbitPath: true,
    types: [true, true, true, true],
  });
  pick = $state<GroupPick>({ group: -1, owner: null, mode: 'dim' });
  groupsOpen = $state(false);

  get hasPick(): boolean {
    return this.pick.group >= 0 || this.pick.owner !== null;
  }

  clearPick(): void {
    this.pick.group = -1;
    this.pick.owner = null;
  }
}

export const settings = new Settings();
