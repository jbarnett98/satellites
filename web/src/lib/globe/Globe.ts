/**
 * Globe — owns the WebGL renderer, the two scenes (sky and world), the camera, and the
 * frame loop. It knows nothing about Svelte; the UI talks to it through a handful of
 * methods and receives a throttled status object back.
 *
 * Scene graph (units: km, y-up, ECI unless the frame toggle rotates `world`):
 *
 *   scene
 *   └─ world            rotation.y = 0 (inertial view)  |  −GMST (Earth-fixed view)
 *      └─ earthGroup    rotation.y = GMST, scale.y = polar/equatorial radius (WGS84)
 *         ├─ Earth mesh (day/night shader)
 *         ├─ Clouds shell (translucent, drifts slowly)
 *         ├─ Atmosphere shell (back-face, additive)
 *         └─ Graticule
 *
 *      └─ satelliteLayer  (attached once the orbit snapshot has loaded — ECI, so never under earthGroup)
 *         ├─ Points: one vertex per catalogued object, extrapolated in the vertex shader
 *         └─ Orbit line of the selected object
 *
 *   skyScene            rendered first with a camera that copies only the main camera's rotation
 *   └─ skyRoot          rotation.y follows `world` so the sky and the Earth stay consistent
 *      ├─ MilkyWay dome (additive, under everything)
 *      ├─ StarField (119k points)
 *      └─ Sun sprite (true angular size, occluded by the Earth in the world pass)
 */

import { Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ecefToGeodetic, eciToEcef, eciToScene, sceneEarthFixedToLatLon, sceneToEci, WGS84_A_KM, WGS84_B_KM } from '../astro/frames';
import { gmst, julianDate } from '../astro/time';
import { sunState, type SunState } from '../astro/sun';
import { Atmosphere } from './atmosphere';
import { Clouds, cloudOffset, loadCloudTexture } from './clouds';
import { Earth, loadEarthTextures, type TextureTier } from './earth';
import { Graticule } from './graticule';
import { loadMilkyWayMap, MilkyWay } from './milkyWay';
import { loadStarCatalog, StarField } from './stars';
import { SunSprite } from './sun';
import type { SatelliteLayer, SatelliteLayerStatus } from './satellites';

export type FrameMode = 'eci' | 'ecef';
export type LayerName = 'atmosphere' | 'nightLights' | 'clouds' | 'stars' | 'milkyWay' | 'graticule' | 'dayNight';

/** Live numbers for the selected satellite, computed from the same extrapolation the shader draws. */
export interface SelectedReadout {
  index: number;
  latDeg: number;
  lonDeg: number;
  /** Height above the WGS84 ellipsoid, km. */
  altitudeKm: number;
  speedKmS: number;
  inShadow: boolean;
}

export interface GlobeStatus {
  fps: number;
  simTimeMs: number;
  gmstRad: number;
  sun: SunState;
  cameraAltitudeKm: number;
  cameraLatDeg: number;
  cameraLonDeg: number;
  starCount: number;
  textureTier: TextureTier;
  satellites: SatelliteLayerStatus | null;
  selected: SelectedReadout | null;
}

export interface GlobeOptions {
  /** Returns the simulation time (Unix ms) for this frame. Called once per frame. */
  timeSource: () => number;
  /** Returns the current time rate (0 = paused, 1 = real time, …). Drives propagation cadence. */
  rateSource: () => number;
  onStatus?: (status: GlobeStatus) => void;
  onProgress?: (label: string) => void;
  onReady?: () => void;
  onError?: (err: unknown) => void;
}

const Y_AXIS = new Vector3(0, 1, 0);
const STATUS_INTERVAL_MS = 200;

export class Globe {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly world = new Group();
  readonly earthGroup = new Group();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly skyScene = new Scene();
  private readonly skyRoot = new Group();
  private readonly skyCamera: PerspectiveCamera;

  private earth?: Earth;
  private clouds?: Clouds;
  private atmosphere = new Atmosphere();
  private graticule = new Graticule();
  private stars?: StarField;
  private milkyWay?: MilkyWay;
  private sun = new SunSprite();
  private satellites: SatelliteLayer | null = null;

  private frame: FrameMode = 'eci';
  private worldRotation = 0;
  private textureTier: TextureTier = 'low';
  private readonly layers: Record<LayerName, boolean> = {
    atmosphere: true,
    nightLights: true,
    clouds: true,
    stars: true,
    milkyWay: true,
    graticule: false,
    dayNight: true,
  };
  private starBrightness = 1;
  private milkyWayIntensity = 0.17;
  /** Slider 1.0 → this much linear light; keeps the band a glow rather than a fog. */
  private static readonly MILKY_WAY_MAX = 0.3;

  private readonly opts: GlobeOptions;
  private running = false;
  private frames = 0;
  private lastStatusAt = 0;
  private fps = 0;

  // scratch
  private readonly sunEciScene = new Vector3();
  private readonly sunScene = new Vector3();
  private readonly camEarthFixed = new Vector3();
  private readonly selPos = new Vector3();
  private readonly selVel = new Vector3();

  constructor(canvas: HTMLCanvasElement, opts: GlobeOptions) {
    this.opts = opts;

    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClear = false;

    this.camera = new PerspectiveCamera(40, 1, 20, 600_000);
    this.skyCamera = new PerspectiveCamera(40, 1, 0.1, 100);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.zoomSpeed = 0.7;
    this.controls.minDistance = WGS84_A_KM + 250; // never below 250 km altitude
    this.controls.maxDistance = 140_000;

    this.earthGroup.scale.set(1, WGS84_B_KM / WGS84_A_KM, 1);
    this.earthGroup.add(this.atmosphere.mesh, this.graticule.root);
    this.world.add(this.earthGroup);
    this.scene.add(this.world);

    this.skyRoot.add(this.sun.sprite);
    this.skyScene.add(this.skyRoot);

    this.placeInitialCamera();
    this.applyLayers();
    this.resize();

    void this.load();
  }

  // ---------------------------------------------------------------- lifecycle

  private async load(): Promise<void> {
    try {
      // Tier 1: everything needed for a first picture, in parallel.
      const [lowTex, lowClouds, catalog, milkyWayMap] = await Promise.all([
        loadEarthTextures(this.renderer, 'low', this.opts.onProgress),
        loadCloudTexture(this.renderer, 2048),
        (async () => {
          this.opts.onProgress?.('Loading 119,613 stars');
          return loadStarCatalog();
        })(),
        loadMilkyWayMap(),
      ]);

      this.milkyWay = new MilkyWay(milkyWayMap);
      this.stars = new StarField(catalog, this.renderer.getPixelRatio());
      this.skyRoot.add(this.milkyWay.mesh, this.stars.root);

      this.clouds = new Clouds(lowClouds);
      this.earth = new Earth(lowTex, lowClouds);
      this.earthGroup.add(this.earth.mesh, this.clouds.mesh);

      this.applyLayers();
      this.opts.onReady?.();

      // Tier 2: full resolution, swapped in when it arrives.
      const [highTex, highClouds] = await Promise.all([
        loadEarthTextures(this.renderer, 'high'),
        loadCloudTexture(this.renderer, 4096),
      ]);
      this.earth.setTextures(highTex);
      this.clouds.setMap(highClouds);
      this.earth.setCloudTexture(highClouds);
      this.textureTier = 'high';
    } catch (err) {
      this.opts.onError?.(err);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastStatusAt = performance.now();
    this.renderer.setAnimationLoop(this.tick);
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  dispose(): void {
    this.stop();
    this.controls.dispose();
    this.earth?.dispose();
    this.clouds?.dispose();
    this.atmosphere.dispose();
    this.graticule.dispose();
    this.stars?.dispose();
    this.milkyWay?.dispose();
    this.sun.dispose();
    this.satellites?.dispose();
    this.renderer.dispose();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.skyCamera.aspect = w / h;
    this.skyCamera.updateProjectionMatrix();
    this.stars?.setPixelRatio(this.renderer.getPixelRatio());
    this.satellites?.setPixelRatio(this.renderer.getPixelRatio());
  }

  // ---------------------------------------------------------------- satellites

  /** Attach (or replace, or remove with null) the satellite layer. The globe does not own it. */
  setSatellites(layer: SatelliteLayer | null): void {
    if (this.satellites) this.world.remove(this.satellites.root);
    this.satellites = layer;
    if (layer) {
      layer.setPixelRatio(this.renderer.getPixelRatio());
      this.world.add(layer.root);
    }
  }

  get satelliteLayer(): SatelliteLayer | null {
    return this.satellites;
  }

  /** Index of the satellite under a pointer position (CSS px within the canvas), or −1. */
  pickSatellite(clientX: number, clientY: number, radiusPx = 9): number {
    const layer = this.satellites;
    if (!layer) return -1;
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const ndcX = ((clientX - rect.left) / w) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / h) * 2 - 1);
    return layer.pick(ndcX, ndcY, this.camera, w, h, this.opts.timeSource(), radiusPx);
  }

  // ---------------------------------------------------------------- controls from UI

  setFrame(mode: FrameMode): void {
    this.frame = mode;
  }

  setLayer(name: LayerName, on: boolean): void {
    this.layers[name] = on;
    this.applyLayers();
  }

  setStarBrightness(b: number): void {
    this.starBrightness = b;
    this.stars?.setBrightness(b);
  }

  /** `v` is the UI slider, 0–1. */
  setMilkyWayIntensity(v: number): void {
    this.milkyWayIntensity = v;
    this.milkyWay?.setIntensity(v * Globe.MILKY_WAY_MAX);
  }

  private applyLayers(): void {
    this.atmosphere.setVisible(this.layers.atmosphere);
    this.graticule.setVisible(this.layers.graticule);
    this.stars?.setVisible(this.layers.stars);
    this.stars?.setBrightness(this.starBrightness);
    this.milkyWay?.setVisible(this.layers.milkyWay);
    this.milkyWay?.setIntensity(this.milkyWayIntensity * Globe.MILKY_WAY_MAX);
    this.clouds?.setVisible(this.layers.clouds);
    this.earth?.setNightLights(this.layers.nightLights);
    this.earth?.setDayNight(this.layers.dayNight);
    this.earth?.setCloudShadow(this.layers.clouds);
  }

  // ---------------------------------------------------------------- frame loop

  private readonly tick = (): void => {
    const nowReal = performance.now();
    const simMs = this.opts.timeSource();
    const rate = this.opts.rateSource();
    const jd = julianDate(simMs);
    const theta = gmst(jd);
    const sun = sunState(jd);

    // Frame handling. Switching frames rotates `world`; we rotate the camera by the same
    // amount so the view of the Earth is continuous and only the sky/satellites re-anchor.
    const targetWorldRotation = this.frame === 'ecef' ? -theta : 0;
    const delta = targetWorldRotation - this.worldRotation;
    if (delta !== 0) {
      this.camera.position.applyAxisAngle(Y_AXIS, delta);
      this.worldRotation = targetWorldRotation;
    }
    this.world.rotation.y = this.worldRotation;
    this.earthGroup.rotation.y = theta;
    this.skyRoot.rotation.y = this.worldRotation;

    // Sun direction: inertial scene coords for the sky (skyRoot carries the world rotation),
    // and world-rotated coords for the shaders, which see modelMatrix including `world`.
    eciToScene(sun.dir[0], sun.dir[1], sun.dir[2], this.sunEciScene);
    this.sunScene.copy(this.sunEciScene).applyAxisAngle(Y_AXIS, this.worldRotation);
    this.sun.update(this.sunEciScene);

    // Camera: slower orbiting when close to the surface.
    const dist = this.camera.position.length();
    this.controls.rotateSpeed = Math.min(0.6, Math.max(0.02, ((dist - WGS84_A_KM) / dist) * 0.55));
    this.controls.update();

    const drift = cloudOffset(simMs);
    this.earth?.update(this.sunScene, this.camera.position, drift);
    this.clouds?.update(this.sunScene, this.camera.position, drift);
    this.atmosphere.update(this.sunScene, this.camera.position);
    this.satellites?.update(simMs, rate, this.sunScene);

    // Render: sky first (rotation-only camera), then the world on a fresh depth buffer.
    this.renderer.clear();
    this.skyCamera.quaternion.copy(this.camera.quaternion);
    this.renderer.render(this.skyScene, this.skyCamera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);

    // Status, throttled.
    this.frames++;
    const elapsed = nowReal - this.lastStatusAt;
    if (elapsed >= STATUS_INTERVAL_MS) {
      this.fps = (this.frames * 1000) / elapsed;
      this.frames = 0;
      this.lastStatusAt = nowReal;

      this.camEarthFixed.copy(this.camera.position).applyAxisAngle(Y_AXIS, -(this.worldRotation + theta));
      const geo = sceneEarthFixedToLatLon(this.camEarthFixed);

      this.opts.onStatus?.({
        fps: this.fps,
        simTimeMs: simMs,
        gmstRad: theta,
        sun,
        cameraAltitudeKm: geo.rKm - WGS84_A_KM,
        cameraLatDeg: geo.latDeg,
        cameraLonDeg: geo.lonDeg,
        starCount: this.stars?.count ?? 0,
        textureTier: this.textureTier,
        satellites: this.satellites?.status(simMs) ?? null,
        selected: this.selectedReadout(simMs, theta, sun),
      });
    }
  };

  /** Where the selected satellite is right now, in terms a person reads: lat, lon, height, speed. */
  private selectedReadout(simMs: number, theta: number, sun: SunState): SelectedReadout | null {
    const layer = this.satellites;
    if (!layer || layer.selectedIndex < 0) return null;
    const i = layer.selectedIndex;
    if (!layer.sample(i, simMs, this.selPos, this.selVel)) return null;
    const [x, y, z] = sceneToEci(this.selPos);
    const [ex, ey, ez] = eciToEcef(x, y, z, theta);
    const geo = ecefToGeodetic(ex, ey, ez);
    const along = x * sun.dir[0] + y * sun.dir[1] + z * sun.dir[2];
    const px = x - along * sun.dir[0];
    const py = y - along * sun.dir[1];
    const pz = z - along * sun.dir[2];
    const inShadow = along < 0 && Math.hypot(px, py, pz) < WGS84_A_KM;
    return { index: i, latDeg: geo.latDeg, lonDeg: geo.lonDeg, altitudeKm: geo.heightKm, speedKmS: this.selVel.length(), inShadow };
  }

  // ---------------------------------------------------------------- helpers

  /** Start over the sunlit side with the terminator in view, ~3.4 Earth radii out. */
  private placeInitialCamera(): void {
    const jd = julianDate(this.opts.timeSource());
    const sun = sunState(jd);
    const dir = eciToScene(sun.dir[0], sun.dir[1], sun.dir[2]).applyAxisAngle(Y_AXIS, -0.85);
    dir.y += 0.45;
    dir.normalize();
    this.camera.position.copy(dir.multiplyScalar(WGS84_A_KM * 3.4));
    this.camera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
}
