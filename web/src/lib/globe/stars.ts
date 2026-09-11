/**
 * The night sky: 119,613 real stars from the HYG database (Hipparcos + Yale + Gliese), placed
 * at their J2000 right ascension and declination in the inertial frame. They stay fixed while
 * the Earth turns beneath them — which is what the sky actually does.
 *
 * Rendered in a separate scene with a camera that copies only the main camera's rotation,
 * so the stars are infinitely far away regardless of zoom and never fight the depth buffer.
 *
 * Point size and alpha follow visual magnitude; colour follows the B−V index through a
 * small black-body ramp. The catalogue arrives as a compact Int16 binary written by
 * pipeline/ap_pipeline/sky/build_star_catalog_from_hyg.py.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { raDecToScene } from '../astro/frames';

export interface StarCatalogMeta {
  source: string;
  license: string;
  epoch: string;
  count: number;
  layout: string;
  magnitude_range: [number, number];
  /** Row index (as a string) → name, for proper-named and bright stars. */
  names: Record<string, string>;
}

export interface StarCatalog {
  meta: StarCatalogMeta;
  /** Int16 quadruples: ra*100-18000, dec*100, mag*100, bv*100. */
  data: Int16Array;
}

/** Radius of the celestial sphere in the sky scene's own units (arbitrary). */
export const SKY_RADIUS = 10;

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uPixelRatio;
  uniform float uBrightness;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha * uBrightness;
    gl_PointSize = max(aSize * uPixelRatio, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    // Bright Gaussian core with a soft outer clip: reads as a star, not a square. The core
    // is pushed past 1.0 on purpose — additive blending turns the excess into a small glow.
    float falloff = exp(-r * r * 3.0) * (1.0 - smoothstep(0.7, 1.0, r));
    gl_FragColor = vec4(vColor * vAlpha * falloff * 1.5, vAlpha * falloff);
    #include <colorspace_fragment>
  }
`;

/** B−V colour index → approximate linear RGB of a star of that colour. */
export function bvToRgb(bv: number): [number, number, number] {
  // [B−V, r, g, b] — a hand-fit ramp through black-body colours from ~30,000 K to ~3,000 K.
  const stops: [number, number, number, number][] = [
    [-0.4, 0.60, 0.70, 1.00],
    [0.0, 0.78, 0.86, 1.00],
    [0.4, 0.96, 0.96, 1.00],
    [0.65, 1.00, 0.97, 0.90],
    [1.0, 1.00, 0.87, 0.70],
    [1.5, 1.00, 0.72, 0.48],
    [2.0, 1.00, 0.60, 0.34],
  ];
  const x = Math.min(Math.max(bv, stops[0][0]), stops[stops.length - 1][0]);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (x <= b[0]) {
      const t = (x - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

/** Visual magnitude → point diameter in CSS pixels. Sirius ≈ 7.5 px, mag 5 and fainter 1 px. */
function magToSize(mag: number): number {
  const t = Math.min(Math.max((5.0 - mag) / 6.5, 0), 1);
  return 1.25 + 6.25 * Math.pow(t, 1.6);
}

/** Visual magnitude → opacity. The faint tail stays dim individually but adds up in dense fields. */
function magToAlpha(mag: number): number {
  const t = Math.min(Math.max((7.5 - mag) / 9.0, 0), 1);
  return 0.10 + 0.90 * Math.pow(t, 1.2);
}

export async function loadStarCatalog(): Promise<StarCatalog> {
  const [metaRes, binRes] = await Promise.all([fetch('/data/sky/stars-hyg.json'), fetch('/data/sky/stars-hyg.bin')]);
  if (!metaRes.ok) throw new Error(`stars-hyg.json: HTTP ${metaRes.status}`);
  if (!binRes.ok) throw new Error(`stars-hyg.bin: HTTP ${binRes.status}`);
  const meta = (await metaRes.json()) as StarCatalogMeta;
  const data = new Int16Array(await binRes.arrayBuffer());
  if (data.length !== meta.count * 4) throw new Error(`stars-hyg.bin: expected ${meta.count * 4} values, got ${data.length}`);
  return { meta, data };
}

export class StarField {
  readonly root = new Group();
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  readonly count: number;
  private readonly uniforms;

  constructor(catalog: StarCatalog, pixelRatio: number) {
    const n = catalog.meta.count;
    const d = catalog.data;
    this.count = n;

    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const alphas = new Float32Array(n);
    const v = new Vector3();

    for (let i = 0; i < n; i++) {
      const ra = d[i * 4] / 100 + 180;
      const dec = d[i * 4 + 1] / 100;
      const mag = d[i * 4 + 2] / 100;
      const bv = d[i * 4 + 3] / 100;
      raDecToScene(ra, dec, SKY_RADIUS, v);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
      const [r, g, b] = bvToRgb(bv);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      sizes[i] = magToSize(mag);
      alphas[i] = magToAlpha(mag);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new BufferAttribute(alphas, 1));

    this.uniforms = { uPixelRatio: { value: pixelRatio }, uBrightness: { value: 1 } };
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
    this.points.name = 'stars';
    this.root.add(this.points);
  }

  setPixelRatio(pr: number): void {
    this.uniforms.uPixelRatio.value = pr;
  }

  /** 1 = calibrated default; 0.5–2 is the useful range. */
  setBrightness(b: number): void {
    this.uniforms.uBrightness.value = b;
  }

  setVisible(on: boolean): void {
    this.root.visible = on;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
