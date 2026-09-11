import type { FrameMode, LayerName } from '../globe/Globe';

export type { FrameMode, LayerName };

export const LAYER_LABELS: Record<LayerName, { label: string; hint: string }> = {
  dayNight: { label: 'Day / night', hint: 'Shade the planet by the Sun; off = fully lit' },
  nightLights: { label: 'City lights', hint: 'NASA Black Marble on the night side' },
  atmosphere: { label: 'Atmosphere', hint: 'Limb glow and twilight' },
  stars: { label: 'Stars', hint: '9,096 stars from the Yale Bright Star Catalogue' },
  graticule: { label: 'Graticule', hint: '15° latitude / longitude grid' },
};

class Settings {
  frame = $state<FrameMode>('eci');
  layers = $state<Record<LayerName, boolean>>({
    dayNight: true,
    nightLights: true,
    atmosphere: true,
    stars: true,
    graticule: false,
  });
  layersOpen = $state(false);
}

export const settings = new Settings();
