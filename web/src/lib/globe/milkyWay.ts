/**
 * The Milky Way: the summed light of 2.5 million Tycho-2 stars too faint to plot one by one,
 * pre-computed by the pipeline into a small RGB sky-brightness map (equirectangular in RA/Dec)
 * and drawn on the inside of the celestial sphere, additively, underneath the plotted stars.
 *
 * The fragment shader derives RA/Dec from the view direction itself rather than trusting
 * sphere UVs, so the map lines up exactly with the star positions from the same frame maths.
 */

import {
  AdditiveBlending,
  BackSide,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import { SKY_RADIUS } from './stars';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uIntensity;
  varying vec3 vDir;
  const float PI = 3.141592653589793;

  void main() {
    // Scene (y-up) → ECI: x = d.x, y = -d.z, z = d.y — the inverse of frames.eciToScene.
    vec3 d = normalize(vDir);
    float ra = atan(-d.z, d.x);
    if (ra < 0.0) ra += 2.0 * PI;
    float dec = asin(clamp(d.y, -1.0, 1.0));
    vec2 uv = vec2(ra / (2.0 * PI), dec / PI + 0.5);
    vec3 c = texture2D(uMap, uv).rgb * uIntensity;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

export async function loadMilkyWayMap(): Promise<Texture> {
  const t = await new TextureLoader().loadAsync('/textures/sky/milky-way-glow-8192.webp');
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  return t;
}

export class MilkyWay {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly uniforms;

  constructor(map: Texture) {
    this.uniforms = { uMap: { value: map }, uIntensity: { value: 0.05 } };
    const geometry = new SphereGeometry(SKY_RADIUS * 0.9, 48, 24);
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: BackSide,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.mesh.name = 'milky-way';
  }

  /** Linear-light multiplier on the map. ~0.05 reads as a faint band; 0.3 is vivid. */
  setIntensity(v: number): void {
    this.uniforms.uIntensity.value = v;
  }

  setVisible(on: boolean): void {
    this.mesh.visible = on;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    (this.uniforms.uMap.value as Texture).dispose();
  }
}
