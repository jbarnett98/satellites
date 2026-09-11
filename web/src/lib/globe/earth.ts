/**
 * The Earth: a WGS84 ellipsoid with a custom shader that blends NASA's Blue Marble (day)
 * and Black Marble (night lights) across a soft terminator, adds a Lambert falloff, a
 * specular glint on water, a blue in-scattering tint toward the limb, and lets the cloud
 * layer hide city lights and cast a faint shadow on the ground.
 *
 * All lighting is computed in the shader from a single sun-direction uniform; there are
 * no Three.js lights in the scene. Textures arrive in two tiers: a 2048-wide set that
 * paints within a second, then the full-resolution set swapped in when it has loaded.
 */

import {
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RepeatWrapping,
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

export type TextureTier = 'low' | 'high';
export const TIER_WIDTHS: Record<TextureTier, { day: number; night: number; clouds: number }> = {
  low: { day: 2048, night: 2048, clouds: 2048 },
  high: { day: 8192, night: 8192, clouds: 4096 },
};

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
  uniform sampler2D uClouds;
  uniform vec3 uSunDir;       // unit, scene space
  uniform vec3 uCameraPos;    // scene space
  uniform float uNightLights; // 0..1 layer weight
  uniform float uDayNight;    // 1 = shade by sun, 0 = fully lit
  uniform float uCloudShadow; // 0..1 how much clouds darken the ground / hide lights
  uniform float uCloudOffset; // cloud sheet drift, fraction of a turn

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
    float cloud = texture2D(uClouds, vec2(fract(vUv.x - uCloudOffset), vUv.y)).r * uCloudShadow;

    // Gentle Lambert on the day side, never fully black at the terminator.
    float diffuse = mix(1.0, clamp(ndl, 0.0, 1.0) * 0.9 + 0.10, uDayNight);
    vec3 dayCol = day * diffuse;

    // Long-wavelength light survives the low sun: warm the band near the terminator.
    float twilight = (1.0 - smoothstep(0.0, 0.25, abs(ndl))) * uDayNight;
    dayCol = mix(dayCol, dayCol * vec3(1.18, 0.92, 0.72), twilight * 0.6);

    // Soft shadow on the ground beneath cloud.
    dayCol *= 1.0 - cloud * 0.22;

    // Night: faint moonlit texture plus city lights, tinted sodium-lamp warm, dimmed by cloud.
    vec3 lights = night * vec3(1.0, 0.86, 0.62) * 1.7 * uNightLights * (1.0 - cloud * 0.8);
    vec3 nightCol = day * 0.035 + lights;

    vec3 col = mix(nightCol, dayCol, lit);

    // Specular glint on water — the Blue Marble's oceans are where blue beats red.
    float ocean = clamp((day.b - day.r) * 3.0, 0.0, 1.0);
    vec3 h = normalize(uSunDir + v);
    float spec = pow(max(dot(n, h), 0.0), 48.0) * ocean * lit * 0.35 * uDayNight * (1.0 - cloud);
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

function prepColor(t: Texture, maxAniso: number): Texture {
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = maxAniso;
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

export async function loadEarthTextures(
  renderer: WebGLRenderer,
  tier: TextureTier,
  onProgress?: (label: string) => void,
): Promise<EarthTextures> {
  const loader = new TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const w = TIER_WIDTHS[tier];
  const label = tier === 'low' ? '2k' : '8k';

  onProgress?.(`Loading Blue Marble ${label}`);
  const day = prepColor(await loader.loadAsync(`/textures/earth/day-${w.day}.webp`), maxAniso);
  onProgress?.(`Loading Black Marble ${label}`);
  const night = prepColor(await loader.loadAsync(`/textures/earth/night-${w.night}.webp`), maxAniso);
  return { day, night };
}

export class Earth {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly uniforms;

  constructor(textures: EarthTextures, clouds: Texture) {
    this.uniforms = {
      uDay: { value: textures.day },
      uNight: { value: textures.night },
      uClouds: { value: clouds },
      uSunDir: { value: new Vector3(1, 0, 0) },
      uCameraPos: { value: new Vector3() },
      uNightLights: { value: 1 },
      uDayNight: { value: 1 },
      uCloudShadow: { value: 1 },
      uCloudOffset: { value: 0 },
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

  update(sunDirScene: Vector3, cameraPosScene: Vector3, cloudOffset: number): void {
    this.uniforms.uSunDir.value.copy(sunDirScene);
    this.uniforms.uCameraPos.value.copy(cameraPosScene);
    this.uniforms.uCloudOffset.value = cloudOffset;
  }

  /** Swap in a higher tier; the previous textures are released. */
  setTextures(textures: EarthTextures): void {
    const oldDay = this.uniforms.uDay.value as Texture;
    const oldNight = this.uniforms.uNight.value as Texture;
    this.uniforms.uDay.value = textures.day;
    this.uniforms.uNight.value = textures.night;
    if (oldDay !== textures.day) oldDay.dispose();
    if (oldNight !== textures.night) oldNight.dispose();
  }

  /** The cloud texture is shared with the cloud shell; the shell owns and disposes it. */
  setCloudTexture(clouds: Texture): void {
    this.uniforms.uClouds.value = clouds;
  }

  setNightLights(on: boolean): void {
    this.uniforms.uNightLights.value = on ? 1 : 0;
  }

  setDayNight(on: boolean): void {
    this.uniforms.uDayNight.value = on ? 1 : 0;
  }

  setCloudShadow(on: boolean): void {
    this.uniforms.uCloudShadow.value = on ? 1 : 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    (this.uniforms.uDay.value as Texture).dispose();
    (this.uniforms.uNight.value as Texture).dispose();
  }
}
