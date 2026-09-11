/**
 * The Earth: a WGS84 ellipsoid with a custom shader that blends NASA's Blue Marble (day)
 * and Black Marble (night lights) across a soft terminator, adds a Lambert falloff, a
 * specular glint on water, and a blue in-scattering tint toward the limb.
 *
 * All lighting is computed in the shader from a single sun-direction uniform; there are
 * no Three.js lights in the scene.
 */

import {
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { WGS84_A_KM } from '../astro/frames';

export const EARTH_SEGMENTS = 128;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vUv = uv;
    // The ellipsoid scale is 0.3%, so the plain model-matrix normal is close enough.
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec3 uSunDir;      // unit, scene space
  uniform vec3 uCameraPos;   // scene space
  uniform float uNightLights; // 0..1 layer weight
  uniform float uDayNight;    // 1 = shade by sun, 0 = fully lit

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(uCameraPos - vPosW);
    float ndl = dot(n, uSunDir);

    // Terminator: ±0.10 in cos-space ≈ ±6°, a soft twilight band.
    float lit = mix(1.0, smoothstep(-0.10, 0.10, ndl), uDayNight);

    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 night = texture2D(uNight, vUv).rgb;

    // Gentle Lambert on the day side, never fully black at the terminator.
    float diffuse = mix(1.0, clamp(ndl, 0.0, 1.0) * 0.9 + 0.10, uDayNight);
    vec3 dayCol = day * diffuse;

    // Long-wavelength light survives the low sun: warm the band near the terminator.
    float twilight = (1.0 - smoothstep(0.0, 0.25, abs(ndl))) * uDayNight;
    dayCol = mix(dayCol, dayCol * vec3(1.18, 0.92, 0.72), twilight * 0.6);

    // Night: faint moonlit texture plus city lights, tinted sodium-lamp warm.
    vec3 lights = night * vec3(1.0, 0.86, 0.62) * 1.7 * uNightLights;
    vec3 nightCol = day * 0.035 + lights;

    vec3 col = mix(nightCol, dayCol, lit);

    // Specular glint on water — the Blue Marble's oceans are where blue beats red.
    float ocean = clamp((day.b - day.r) * 3.0, 0.0, 1.0);
    vec3 h = normalize(uSunDir + v);
    float spec = pow(max(dot(n, h), 0.0), 48.0) * ocean * lit * 0.35 * uDayNight;
    col += spec * vec3(1.0, 0.95, 0.85);

    // In-scattering: the atmosphere brightens the disc toward the limb on the day side.
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col += vec3(0.30, 0.55, 1.0) * rim * 0.45 * lit;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface EarthTextures {
  day: Texture;
  night: Texture;
}

export async function loadEarthTextures(
  renderer: WebGLRenderer,
  onProgress?: (label: string) => void,
): Promise<EarthTextures> {
  const loader = new TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const prep = (t: Texture) => {
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  };

  onProgress?.('Loading Blue Marble (day)');
  const day = prep(await loader.loadAsync('/textures/earth-day-blue-marble-5400.jpg'));
  onProgress?.('Loading Black Marble (night lights)');
  const night = prep(await loader.loadAsync('/textures/earth-night-black-marble-3600.jpg'));

  return { day, night };
}

export class Earth {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly uniforms;

  constructor(textures: EarthTextures) {
    this.uniforms = {
      uDay: { value: textures.day },
      uNight: { value: textures.night },
      uSunDir: { value: new Vector3(1, 0, 0) },
      uCameraPos: { value: new Vector3() },
      uNightLights: { value: 1 },
      uDayNight: { value: 1 },
    };

    const geometry = new SphereGeometry(WGS84_A_KM, EARTH_SEGMENTS, EARTH_SEGMENTS / 2);
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
    });

    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'earth';
  }

  update(sunDirScene: Vector3, cameraPosScene: Vector3): void {
    this.uniforms.uSunDir.value.copy(sunDirScene);
    this.uniforms.uCameraPos.value.copy(cameraPosScene);
  }

  setNightLights(on: boolean): void {
    this.uniforms.uNightLights.value = on ? 1 : 0;
  }

  setDayNight(on: boolean): void {
    this.uniforms.uDayNight.value = on ? 1 : 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
