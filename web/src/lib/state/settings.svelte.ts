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
}

export const LAYER_LABELS: Record<LayerName, { label: string; hint: string }> = {
  dayNight: { label: 'Day / night', hint: 'Shade the planet by the Sun; off = fully lit' },
  nightLights: { label: 'City lights', hint: 'NASA Black Marble on the night side' },
  clouds: { label: 'Clouds', hint: 'NASA cloud composite, ~25 km up, drifting 0.25°/h' },
  atmosphere: { label: 'Atmosphere', hint: 'Limb glow and twilight' },
  stars: { label: 'Stars', hint: '119,613 stars from the HYG catalogue' },
  milkyWay: { label: 'Milky Way', hint: 'Summed light of 2.5M Tycho-2 stars' },
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
    milkyWay: true,
    graticule: false,
  });
  /** Multiplier on plotted-star brightness; 1 = calibrated default. */
  starBrightness = $state(1);
  /** Slider 0–1; the globe maps it onto 0–0.3 linear light (see Globe.setMilkyWayIntensity). */
  milkyWayIntensity = $state(0.17);
  layersOpen = $state(false);
  satellites = $state<SatelliteSettings>({
    on: true,
    active: true,
    debrisClouds: false,
    colorBy: 'type',
    sizeScale: 1,
    earthShadow: true,
    orbitPath: true,
  });
}

export const settings = new Settings();
