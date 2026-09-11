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
 *         ├─ Atmosphere shell (back-face, additive)
 *         └─ Graticule
 *
 *   starScene           rendered first with a camera that copies only the main camera's
 *   └─ starRoot         rotation.y follows `world` so the sky and the Earth stay consistent
 *      └─ StarField
 *
 * Satellites will later be added as children of `world` (they live in ECI), not earthGroup.
 */

import {
  Group,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { eciToScene, sceneEarthFixedToLatLon, WGS84_A_KM, WGS84_B_KM } from '../astro/frames';
import { gmst, julianDate } from '../astro/time';
import { sunState, type SunState } from '../astro/sun';
import { Atmosphere } from './atmosphere';
import { Earth, loadEarthTextures } from './earth';
import { Graticule } from './graticule';
import { loadStarCatalog, StarField } from './stars';

export type FrameMode = 'eci' | 'ecef';
export type LayerName = 'atmosphere' | 'nightLights' | 'stars' | 'graticule' | 'dayNight';

export interface GlobeStatus {
  fps: number;
  simTimeMs: number;
  gmstRad: number;
  sun: SunState;
  cameraAltitudeKm: number;
  cameraLatDeg: number;
  cameraLonDeg: number;
  starCount: number;
}

export interface GlobeOptions {
  /** Returns the simulation time (Unix ms) for this frame. Called once per frame. */
  timeSource: () => number;
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

  private readonly starScene = new Scene();
  private readonly starCamera: PerspectiveCamera;

  private earth?: Earth;
  private atmosphere = new Atmosphere();
  private graticule = new Graticule();
  private stars?: StarField;

  private frame: FrameMode = 'eci';
  private worldRotation = 0;
  private readonly layers: Record<LayerName, boolean> = {
    atmosphere: true,
    nightLights: true,
    stars: true,
    graticule: false,
    dayNight: true,
  };

  private readonly opts: GlobeOptions;
  private running = false;
  private frames = 0;
  private lastStatusAt = 0;
  private fps = 0;

  // scratch
  private readonly sunScene = new Vector3();
  private readonly camEarthFixed = new Vector3();

  constructor(canvas: HTMLCanvasElement, opts: GlobeOptions) {
    this.opts = opts;

    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClear = false;

    this.camera = new PerspectiveCamera(40, 1, 20, 600_000);
    this.starCamera = new PerspectiveCamera(40, 1, 0.1, 100);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = WGS84_A_KM + 250; // never below 250 km altitude
    this.controls.maxDistance = 140_000;

    this.earthGroup.scale.set(1, WGS84_B_KM / WGS84_A_KM, 1);
    this.earthGroup.add(this.atmosphere.mesh, this.graticule.root);
    this.world.add(this.earthGroup);
    this.scene.add(this.world);

    this.placeInitialCamera();
    this.applyLayers();
    this.resize();

    void this.load();
  }

  // ---------------------------------------------------------------- lifecycle

  private async load(): Promise<void> {
    try {
      const [textures, catalog] = await Promise.all([
        loadEarthTextures(this.renderer, this.opts.onProgress),
        (async () => {
          this.opts.onProgress?.('Loading star catalogue');
          return loadStarCatalog();
        })(),
      ]);

      this.stars = new StarField(catalog, this.renderer.getPixelRatio());
      this.starScene.add(this.stars.root);

      this.earth = new Earth(textures);
      this.earthGroup.add(this.earth.mesh);

      this.applyLayers();
      this.opts.onReady?.();
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
    this.atmosphere.dispose();
    this.graticule.dispose();
    this.stars?.dispose();
    this.renderer.dispose();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.starCamera.aspect = w / h;
    this.starCamera.updateProjectionMatrix();
    this.stars?.setPixelRatio(this.renderer.getPixelRatio());
  }

  // ---------------------------------------------------------------- controls from UI

  setFrame(mode: FrameMode): void {
    this.frame = mode;
  }

  setLayer(name: LayerName, on: boolean): void {
    this.layers[name] = on;
    this.applyLayers();
  }

  private applyLayers(): void {
    this.atmosphere.setVisible(this.layers.atmosphere);
    this.graticule.setVisible(this.layers.graticule);
    this.stars?.setVisible(this.layers.stars);
    this.earth?.setNightLights(this.layers.nightLights);
    this.earth?.setDayNight(this.layers.dayNight);
  }

  // ---------------------------------------------------------------- frame loop

  private readonly tick = (): void => {
    const nowReal = performance.now();
    const simMs = this.opts.timeSource();
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
    if (this.stars) this.stars.root.rotation.y = this.worldRotation;

    // Sun direction in scene space (rotate with `world` so shaders see a consistent frame).
    eciToScene(sun.dir[0], sun.dir[1], sun.dir[2], this.sunScene).applyAxisAngle(Y_AXIS, this.worldRotation);

    // Camera: slower orbiting when close to the surface.
    const dist = this.camera.position.length();
    this.controls.rotateSpeed = Math.min(1, Math.max(0.04, ((dist - WGS84_A_KM) / dist) * 1.3));
    this.controls.update();

    this.earth?.update(this.sunScene, this.camera.position);
    this.atmosphere.update(this.sunScene, this.camera.position);

    // Render: sky first (rotation-only camera), then the world on a fresh depth buffer.
    this.renderer.clear();
    if (this.stars) {
      this.starCamera.quaternion.copy(this.camera.quaternion);
      this.renderer.render(this.starScene, this.starCamera);
      this.renderer.clearDepth();
    }
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
      });
    }
  };

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
