/**
 * The satellite layer: every catalogued object as one GPU point, plus the orbit of the
 * selected object. Lives under the `world` group (ECI), so it is correct in both the
 * inertial and the Earth-fixed views without any per-object work.
 *
 * How positions move between propagation ticks. The worker delivers position p₀ and
 * velocity v₀ for every object at one instant t₀. The vertex shader receives the
 * simulation offset Δt = t − t₀ as a uniform and draws each point at
 *
 *     p = p₀ + v₀·Δt + ½·a·Δt²,     a = −μ·p₀ / |p₀|³
 *
 * i.e. the object coasts along its velocity with point-mass gravity bending the path.
 * Δt is at most a few simulation seconds at normal rates (see PropagationEngine), so
 * this is accurate to well under a metre; at 3600× it is a few hundred metres — still
 * far below one pixel at globe scale. Only two small buffers change per tick, and the
 * per-frame cost on the main thread is one uniform.
 *
 * The same formula is evaluated on the CPU for picking and for the selected object's
 * live readout, so what the mouse hits is exactly what is drawn.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Matrix4,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { EARTH_MU_KM3_S2, WGS84_A_KM } from '../astro/frames';
import type { SatelliteCatalog } from '../orbits/SatelliteCatalog';
import type { PropagationEngine, PropagationFrame } from '../orbits/PropagationEngine';
import { OrbitPath } from './orbitPath';

export type SatelliteColorMode = 'type' | 'regime';

/**
 * Colours by SATCAT object type: payload, rocket body, debris, unknown. sRGB hex; Three converts.
 * Nothing here is white: the stars behind the layer are white, and the two must stay tellable apart.
 */
export const TYPE_COLORS = ['#7fdbe8', '#f4b860', '#a99ccf', '#ee8fc6'] as const;
/** Colours by regime: LEO, MEO, GEO, HEO, beyond GEO. */
export const REGIME_COLORS = ['#5fd9e4', '#7fe08a', '#f4b860', '#e48bc8', '#b9c2d3'] as const;
/** Base point diameter in CSS pixels by object type, at the reference viewing depth. */
const TYPE_SIZES = [3.4, 3.4, 2.5, 3.0];
/** View depth (km) at which points draw at their base size — the default camera's near LEO shell. */
const REFERENCE_DEPTH_KM = 17000;

const vertexShader = /* glsl */ `
  attribute vec3 velocity;
  attribute float aType;
  attribute float aRegime;
  attribute float aVisible;
  attribute float aEmphasis;    // 1 = member of the selected group, 0 = dimmed
  attribute float aIndex;

  uniform float uDt;            // simulation seconds since the positions were exact
  uniform float uMu;            // km^3/s^2
  uniform vec3 uSunDir;         // unit, world space (includes the world-group rotation)
  uniform float uEarthRadius;   // km
  uniform float uEarthShadow;   // 0/1
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uReferenceDepth;
  uniform int uColorMode;       // 0 type, 1 regime
  uniform vec3 uTypeColors[4];
  uniform vec3 uRegimeColors[5];
  uniform float uTypeSizes[4];
  uniform float uSelected;
  uniform float uHovered;
  uniform float uDimming;       // 1 while a group is picked out, else 0

  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;          // 0 plain, 1 hovered, 2 selected

  void main() {
    float r2 = dot(position, position);
    float r = sqrt(r2);
    vec3 acc = -uMu * position / (r2 * r);
    vec3 p = position + velocity * uDt + 0.5 * acc * uDt * uDt;

    vec4 wp = modelMatrix * vec4(p, 1.0);
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;

    int t = int(aType + 0.5);
    int g = int(aRegime + 0.5);
    vec3 col = uColorMode == 0 ? uTypeColors[t] : uRegimeColors[g];
    // Depth attenuation, gentler than 1/z: a satellite 17,000 km away draws at base size,
    // one 1,000 km away about 4× bigger, and far out the shell tapers rather than fusing.
    float atten = clamp(pow(uReferenceDepth / max(-mv.z, 1.0), 0.6), 0.6, 4.0);
    float size = uTypeSizes[t] * uSizeScale * atten;
    float alpha = 1.0;

    // Earth's shadow: the cylinder behind the planet, edge softened over ~150 km.
    float along = dot(wp.xyz, uSunDir);
    vec3 perp = wp.xyz - along * uSunDir;
    float shade = along < 0.0 ? 1.0 - smoothstep(uEarthRadius - 60.0, uEarthRadius + 90.0, length(perp)) : 0.0;
    shade *= uEarthShadow;
    alpha *= mix(1.0, 0.30, shade);
    col = mix(col, col * vec3(0.55, 0.65, 0.95), shade);

    // A picked-out group: everything else recedes to a faint, smaller dot.
    float dim = uDimming * (1.0 - aEmphasis);
    alpha *= mix(1.0, 0.10, dim);
    size *= mix(1.0, 0.7, dim);

    float kind = 0.0;
    if (abs(aIndex - uHovered) < 0.5) { size = max(size * 1.6, 7.0); kind = 1.0; alpha = 1.0; col = vec3(1.0); }
    if (abs(aIndex - uSelected) < 0.5) { size = max(size * 3.0, 18.0); kind = 2.0; alpha = 1.0; }

    vColor = col;
    vKind = kind;
    vAlpha = alpha * aVisible;
    gl_PointSize = size * uPixelRatio;
    // Filtered-out objects: move outside clip space so the rasteriser never sees them.
    if (aVisible < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;

  void main() {
    if (vAlpha <= 0.002) discard;
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;

    vec3 col;
    float a;
    if (vKind > 1.5) {
      // Selected: bright core and a thin ring, in the object's own colour lifted toward white.
      float core = 1.0 - smoothstep(0.16, 0.28, r);
      float ring = smoothstep(0.66, 0.74, r) * (1.0 - smoothstep(0.86, 0.96, r));
      col = mix(vColor, vec3(1.0), 0.65);
      a = max(core, ring * 0.9);
    } else {
      // Plain: anti-aliased disc, bright centre fading to a dark rim so the dot reads on
      // black space and on sunlit cloud alike.
      float edge = 1.0 - smoothstep(0.70, 1.0, r);
      float core = 1.0 - smoothstep(0.26, 0.68, r);
      col = mix(vec3(0.02, 0.03, 0.06), vColor, core);
      a = edge;
    }
    gl_FragColor = vec4(col, a * vAlpha);
    #include <colorspace_fragment>
  }
`;

export interface SatelliteLayerStatus {
  total: number;
  shown: number;
  hasFrame: boolean;
  /** Simulation seconds the current frame has been extrapolated by. */
  frameAgeS: number;
  hz: number;
  computeMs: number;
  roundTripMs: number;
  errors: number;
}

const _mvp = new Matrix4();
const _inv = new Matrix4();
const _cam = new Vector3();

export class SatelliteLayer {
  readonly root = new Group();
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  readonly orbit = new OrbitPath();
  readonly catalog: SatelliteCatalog;
  readonly engine: PropagationEngine;

  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly visible: Uint8Array;
  private readonly emphasis: Uint8Array;
  /** Members of the picked-out group (null = no pick) and objects above the observer's horizon (null = no observer). */
  private groupEmphasis: Uint8Array | null = null;
  private horizonEmphasis: Uint8Array | null = null;
  private dimming = false;
  private readonly posAttr: BufferAttribute;
  private readonly velAttr: BufferAttribute;
  private readonly visAttr: BufferAttribute;
  private readonly emphAttr: BufferAttribute;
  private readonly uniforms;

  private epochSimMs = NaN;
  private hasFrame = false;
  /** Increments each time new positions land; observers of the layer use it to know when to rescan. */
  private frameSeq = 0;
  private shown = 0;
  private selected = -1;
  private hovered = -1;
  private orbitPathOn = true;
  private orbitPathSimMs = NaN;
  private orbitPathPending = false;

  /** Recompute the selected orbit when the simulation has moved this far from where it was drawn. */
  private static readonly ORBIT_REFRESH_MS = 20 * 60_000;

  constructor(catalog: SatelliteCatalog, engine: PropagationEngine, pixelRatio: number) {
    this.catalog = catalog;
    this.engine = engine;
    const n = catalog.count;

    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.visible = new Uint8Array(n).fill(1);
    this.emphasis = new Uint8Array(n).fill(1);
    const index = new Float32Array(n);
    for (let i = 0; i < n; i++) index[i] = i;

    const geometry = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.velAttr = new BufferAttribute(this.vel, 3).setUsage(DynamicDrawUsage);
    this.visAttr = new BufferAttribute(this.visible, 1).setUsage(DynamicDrawUsage);
    this.emphAttr = new BufferAttribute(this.emphasis, 1).setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.posAttr);
    geometry.setAttribute('velocity', this.velAttr);
    geometry.setAttribute('aVisible', this.visAttr);
    geometry.setAttribute('aEmphasis', this.emphAttr);
    geometry.setAttribute('aType', new BufferAttribute(catalog.typeCode, 1));
    geometry.setAttribute('aRegime', new BufferAttribute(catalog.regimeCode, 1));
    geometry.setAttribute('aIndex', new BufferAttribute(index, 1));
    // Nothing to draw until the first frame lands; also keeps the frustum cull honest.
    geometry.setDrawRange(0, 0);
    geometry.boundingSphere = null;

    this.uniforms = {
      uDt: { value: 0 },
      uMu: { value: EARTH_MU_KM3_S2 },
      uSunDir: { value: new Vector3(1, 0, 0) },
      uEarthRadius: { value: WGS84_A_KM },
      uEarthShadow: { value: 1 },
      uPixelRatio: { value: pixelRatio },
      uSizeScale: { value: 1 },
      uReferenceDepth: { value: REFERENCE_DEPTH_KM },
      uColorMode: { value: 0 },
      uTypeColors: { value: TYPE_COLORS.map((c) => new Color(c)) },
      uRegimeColors: { value: REGIME_COLORS.map((c) => new Color(c)) },
      uTypeSizes: { value: TYPE_SIZES.slice() },
      uSelected: { value: -1 },
      uHovered: { value: -1 },
      uDimming: { value: 0 },
    };
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.name = 'satellites';

    this.root.name = 'satelliteLayer';
    this.root.add(this.points, this.orbit.line);
    this.shown = n;
  }

  get count(): number {
    return this.catalog.count;
  }

  // ---------------------------------------------------------------- per frame

  /** Poll the engine, apply any new positions, and set this frame's extrapolation offset. */
  update(simMs: number, rate: number, sunDirWorld: Vector3): void {
    const frame = this.engine.update(simMs, rate);
    if (frame) this.applyFrame(frame);
    if (this.hasFrame) this.uniforms.uDt.value = (simMs - this.epochSimMs) / 1000;
    this.uniforms.uSunDir.value.copy(sunDirWorld);

    if (this.selected >= 0 && this.orbitPathOn) {
      this.orbit.update(simMs);
      if (!this.orbitPathPending && (!Number.isFinite(this.orbitPathSimMs) || Math.abs(simMs - this.orbitPathSimMs) > SatelliteLayer.ORBIT_REFRESH_MS)) {
        this.refreshOrbitPath(simMs);
      }
    }
  }

  private applyFrame(frame: PropagationFrame): void {
    this.pos.set(frame.pos);
    this.vel.set(frame.vel);
    this.posAttr.needsUpdate = true;
    this.velAttr.needsUpdate = true;
    this.epochSimMs = frame.simMs;
    this.frameSeq++;
    if (!this.hasFrame) {
      this.hasFrame = true;
      this.points.geometry.setDrawRange(0, this.count);
    }
    this.engine.recycle(frame);
  }

  status(simMs: number): SatelliteLayerStatus {
    const s = this.engine.stats;
    return {
      total: this.count,
      shown: this.shown,
      hasFrame: this.hasFrame,
      frameAgeS: this.hasFrame ? (simMs - this.epochSimMs) / 1000 : 0,
      hz: s.hz,
      computeMs: s.computeMs,
      roundTripMs: s.roundTripMs,
      errors: s.errors,
    };
  }

  // ---------------------------------------------------------------- settings

  setVisibleMask(mask: Uint8Array): void {
    this.visible.set(mask);
    this.visAttr.needsUpdate = true;
    let shown = 0;
    for (let i = 0; i < mask.length; i++) shown += mask[i];
    this.shown = shown;
  }

  setVisible(on: boolean): void {
    this.root.visible = on;
  }

  /** Pick out a set of objects: members draw normally, the rest recede. `null` clears it. */
  setEmphasisMask(mask: Uint8Array | null): void {
    this.groupEmphasis = mask ? Uint8Array.from(mask) : null;
    this.rebuildEmphasis();
  }

  /** Objects above an observer's horizon draw normally, the rest recede. `null` clears it. Combines with the group pick. */
  setHorizonMask(mask: Uint8Array | null): void {
    this.horizonEmphasis = mask ? Uint8Array.from(mask) : null;
    this.rebuildEmphasis();
  }

  private rebuildEmphasis(): void {
    const g = this.groupEmphasis;
    const h = this.horizonEmphasis;
    const e = this.emphasis;
    if (!g && !h) e.fill(1);
    else if (g && h) for (let i = 0; i < e.length; i++) e[i] = g[i] & h[i];
    else e.set((g ?? h)!);
    this.emphAttr.needsUpdate = true;
    this.dimming = !!(g || h);
    this.uniforms.uDimming.value = this.dimming ? 1 : 0;
  }

  // ---------------------------------------------------------------- read access for scans

  /** Scene-frame positions (km, ×3) as of `frameSimMs` — the raw tick, before extrapolation. */
  get framePositions(): Float32Array {
    return this.pos;
  }

  get frameSimMs(): number {
    return this.epochSimMs;
  }

  /** Bumped whenever new positions arrive. */
  get frameSequence(): number {
    return this.frameSeq;
  }

  /** The current visibility mask (1 = drawn). Read only. */
  get visibleMask(): Uint8Array {
    return this.visible;
  }

  /** Extrapolated position of object `i` in the world (scene) frame — for the camera to aim at. */
  worldPosition(i: number, simMs: number, out: Vector3): boolean {
    if (!this.sample(i, simMs, out)) return false;
    out.applyMatrix4(this.points.matrixWorld);
    return true;
  }

  setPixelRatio(pr: number): void {
    this.uniforms.uPixelRatio.value = pr;
  }

  setSizeScale(s: number): void {
    this.uniforms.uSizeScale.value = s;
  }

  setColorMode(mode: SatelliteColorMode): void {
    this.uniforms.uColorMode.value = mode === 'regime' ? 1 : 0;
    this.applyOrbitColor();
  }

  setEarthShadow(on: boolean): void {
    this.uniforms.uEarthShadow.value = on ? 1 : 0;
  }

  setOrbitPathVisible(on: boolean): void {
    this.orbitPathOn = on;
    this.orbit.setVisible(on && this.selected >= 0);
  }

  setHovered(i: number): void {
    this.hovered = i;
    this.uniforms.uHovered.value = i;
  }

  get selectedIndex(): number {
    return this.selected;
  }

  setSelected(i: number): void {
    if (i === this.selected) return;
    this.selected = i;
    this.uniforms.uSelected.value = i;
    this.orbitPathSimMs = NaN;
    this.orbit.clear();
    this.orbit.setVisible(this.orbitPathOn && i >= 0);
    this.applyOrbitColor();
  }

  private applyOrbitColor(): void {
    if (this.selected < 0) return;
    const mode = this.uniforms.uColorMode.value;
    const c = mode === 1 ? REGIME_COLORS[this.catalog.regimeCode[this.selected]] : TYPE_COLORS[this.catalog.typeCode[this.selected]];
    this.orbit.setColor(c);
  }

  private refreshOrbitPath(simMs: number): void {
    const i = this.selected;
    const periodMs = this.catalog.data.PERIOD_MIN[i] * 60_000;
    if (!(periodMs > 0)) return;
    this.orbitPathPending = true;
    this.orbitPathSimMs = simMs;
    void this.engine.requestOrbitPath(i, simMs, periodMs, 360).then((pts) => {
      this.orbitPathPending = false;
      if (this.selected !== i) return;
      this.orbit.setPath(pts, simMs, periodMs);
    });
  }

  // ---------------------------------------------------------------- queries

  /**
   * Position (km, scene frame) and velocity (km/s) of object `i` at `simMs`, extrapolated
   * exactly as the shader does. Returns false before the first frame.
   */
  sample(i: number, simMs: number, outPos: Vector3, outVel?: Vector3): boolean {
    if (!this.hasFrame || i < 0 || i >= this.count) return false;
    const dt = (simMs - this.epochSimMs) / 1000;
    const o = i * 3;
    const x = this.pos[o];
    const y = this.pos[o + 1];
    const z = this.pos[o + 2];
    const r2 = x * x + y * y + z * z;
    if (r2 === 0) return false;
    const k = -EARTH_MU_KM3_S2 / (r2 * Math.sqrt(r2));
    const h = 0.5 * dt * dt;
    const vx = this.vel[o];
    const vy = this.vel[o + 1];
    const vz = this.vel[o + 2];
    outPos.set(x + vx * dt + k * x * h, y + vy * dt + k * y * h, z + vz * dt + k * z * h);
    outVel?.set(vx + k * x * dt, vy + k * y * dt, vz + k * z * dt);
    return true;
  }

  /**
   * Index of the nearest shown object within `radiusPx` of a pointer position (NDC), or −1.
   * Objects behind the Earth are ignored, so the hit matches what is drawn.
   */
  pick(ndcX: number, ndcY: number, camera: PerspectiveCamera, widthPx: number, heightPx: number, simMs: number, radiusPx = 9): number {
    if (!this.hasFrame || !this.root.visible) return -1;
    _mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.points.matrixWorld);
    const e = _mvp.elements;
    _cam.copy(camera.position).applyMatrix4(_inv.copy(this.points.matrixWorld).invert());
    const dt = (simMs - this.epochSimMs) / 1000;
    const h = 0.5 * dt * dt;
    const halfW = widthPx / 2;
    const halfH = heightPx / 2;
    const r2max = radiusPx * radiusPx;
    const earthR2 = WGS84_A_KM * WGS84_A_KM * 0.995;

    let best = -1;
    let bestD2 = r2max;
    const dimming = this.dimming;
    for (let i = 0; i < this.count; i++) {
      if (!this.visible[i] || (dimming && !this.emphasis[i])) continue;
      const o = i * 3;
      const x0 = this.pos[o];
      const y0 = this.pos[o + 1];
      const z0 = this.pos[o + 2];
      const rr = x0 * x0 + y0 * y0 + z0 * z0;
      if (rr === 0) continue;
      const k = -EARTH_MU_KM3_S2 / (rr * Math.sqrt(rr));
      const x = x0 + this.vel[o] * dt + k * x0 * h;
      const y = y0 + this.vel[o + 1] * dt + k * y0 * h;
      const z = z0 + this.vel[o + 2] * dt + k * z0 * h;

      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0) continue;
      const cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      const dx = (cx - ndcX) * halfW;
      const dy = (cy - ndcY) * halfH;
      const d2 = dx * dx + dy * dy;
      if (d2 >= bestD2) continue;

      // Occlusion: does the camera→object segment pass through the Earth?
      const sx = x - _cam.x;
      const sy = y - _cam.y;
      const sz = z - _cam.z;
      const len2 = sx * sx + sy * sy + sz * sz;
      let t = -(_cam.x * sx + _cam.y * sy + _cam.z * sz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = _cam.x + sx * t;
      const qy = _cam.y + sy * t;
      const qz = _cam.z + sz * t;
      if (qx * qx + qy * qy + qz * qz < earthR2) continue;

      best = i;
      bestD2 = d2;
    }
    return best;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.orbit.dispose();
    this.engine.dispose();
  }
}
