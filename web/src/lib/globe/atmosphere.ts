/**
 * Atmosphere halo: a slightly larger shell drawn back-face only, additively. The Earth is
 * rendered first, so only the ring of shell that lies outside the Earth's disc survives the
 * depth test — that ring is the glow. Intensity rises toward the planet's limb and fades
 * outward; it dims (but never vanishes) on the night side and warms near the terminator.
 */

import { AdditiveBlending, BackSide, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { WGS84_A_KM } from '../astro/frames';
import { EARTH_SEGMENTS } from './earth';

/** Shell radius as a multiple of the Earth radius. ~290 km-equivalent: artistic, not physical. */
export const ATMOSPHERE_SCALE = 1.045;

const vertexShader = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uCameraPos;
  uniform float uIntensity;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(uCameraPos - vPosW);

    // On the far hemisphere -dot(n, v) is 0 at the shell's silhouette and grows toward the
    // part hidden behind the planet. For a shell 4.5% larger than the Earth, the planet's
    // own limb sits near 0.29 (for a distant camera) — so this ramps up toward the limb.
    float depth = -dot(n, v);
    float glow = pow(smoothstep(0.0, 0.30, depth), 1.4);

    float sunward = dot(n, uSunDir);
    float sun = smoothstep(-0.30, 0.35, sunward);
    float dusk = 1.0 - smoothstep(0.0, 0.40, abs(sunward));

    vec3 dayCol = vec3(0.35, 0.62, 1.00);
    vec3 duskCol = vec3(1.00, 0.55, 0.30);
    vec3 col = mix(dayCol, duskCol, dusk * 0.7);

    float a = glow * (0.12 + 0.88 * sun) * uIntensity;
    gl_FragColor = vec4(col * a, a);
    #include <colorspace_fragment>
  }
`;

export class Atmosphere {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly uniforms;

  constructor() {
    this.uniforms = {
      uSunDir: { value: new Vector3(1, 0, 0) },
      uCameraPos: { value: new Vector3() },
      uIntensity: { value: 1.0 },
    };
    const geometry = new SphereGeometry(WGS84_A_KM * ATMOSPHERE_SCALE, EARTH_SEGMENTS, EARTH_SEGMENTS / 2);
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: BackSide,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'atmosphere';
    this.mesh.renderOrder = 1;
  }

  update(sunDirScene: Vector3, cameraPosScene: Vector3): void {
    this.uniforms.uSunDir.value.copy(sunDirScene);
    this.uniforms.uCameraPos.value.copy(cameraPosScene);
  }

  setVisible(on: boolean): void {
    this.mesh.visible = on;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
