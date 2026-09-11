/**
 * Cloud layer: NASA's Blue Marble cloud composite as a translucent shell ~25 km above the
 * surface, lit by the same sun vector as the ground so it shares the terminator and the
 * twilight warmth. Deliberately subtle. The layer drifts eastward at 0.25°/hour relative to
 * the ground — an artistic touch (real clouds don't move as one sheet) that is invisible at
 * 1× and gives the planet a little life under time-warp.
 */

import {
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { WGS84_A_KM } from '../astro/frames';
import { EARTH_SEGMENTS } from './earth';

export const CLOUD_ALTITUDE_KM = 25;
/** Eastward drift of the cloud sheet relative to the ground, degrees per simulated hour. */
export const CLOUD_DRIFT_DEG_PER_HOUR = 0.25;
const J2000_MS = 946_728_000_000;

/** Texture-space offset (fraction of a full turn) for a given simulation time. */
export function cloudOffset(simTimeMs: number): number {
  const hours = (simTimeMs - J2000_MS) / 3_600_000;
  const turns = (hours * CLOUD_DRIFT_DEG_PER_HOUR) / 360;
  return turns - Math.floor(turns);
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDir;
  uniform vec3 uCameraPos;
  uniform float uOpacity;
  uniform float uOffset;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(uCameraPos - vPosW);
    float cover = texture2D(uMap, vec2(fract(vUv.x - uOffset), vUv.y)).r;

    float ndl = dot(n, uSunDir);
    float lit = smoothstep(-0.10, 0.10, ndl);
    float diffuse = clamp(ndl, 0.0, 1.0) * 0.85 + 0.15;
    vec3 dayCol = vec3(1.0) * diffuse;
    float twilight = 1.0 - smoothstep(0.0, 0.25, abs(ndl));
    dayCol = mix(dayCol, dayCol * vec3(1.15, 0.85, 0.65), twilight * 0.7);
    vec3 nightCol = vec3(0.05, 0.06, 0.08);
    vec3 col = mix(nightCol, dayCol, lit);

    // Thin clouds seen edge-on look denser; a gentle limb boost sells the shell as 3-D.
    float limb = pow(1.0 - max(dot(n, v), 0.0), 2.0);
    float a = cover * uOpacity * (1.0 + 0.35 * limb);

    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

export async function loadCloudTexture(renderer: WebGLRenderer, width: 2048 | 4096): Promise<Texture> {
  const t = await new TextureLoader().loadAsync(`/textures/earth/clouds-${width}.webp`);
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

export class Clouds {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly uniforms;

  constructor(map: Texture) {
    this.uniforms = {
      uMap: { value: map },
      uSunDir: { value: new Vector3(1, 0, 0) },
      uCameraPos: { value: new Vector3() },
      uOpacity: { value: 0.42 },
      uOffset: { value: 0 },
    };
    const geometry = new SphereGeometry(WGS84_A_KM + CLOUD_ALTITUDE_KM, EARTH_SEGMENTS, EARTH_SEGMENTS / 2);
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.renderOrder = 1;
    this.mesh.name = 'clouds';
  }

  get map(): Texture {
    return this.uniforms.uMap.value as Texture;
  }

  update(sunDirScene: Vector3, cameraPosScene: Vector3, offset: number): void {
    this.uniforms.uSunDir.value.copy(sunDirScene);
    this.uniforms.uCameraPos.value.copy(cameraPosScene);
    this.uniforms.uOffset.value = offset;
  }

  setMap(map: Texture): void {
    const old = this.uniforms.uMap.value as Texture;
    this.uniforms.uMap.value = map;
    if (old !== map) old.dispose();
  }

  setOpacity(o: number): void {
    this.uniforms.uOpacity.value = o;
  }

  setVisible(on: boolean): void {
    this.mesh.visible = on;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.map.dispose();
  }
}
