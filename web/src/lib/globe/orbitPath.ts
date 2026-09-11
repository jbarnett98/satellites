/**
 * The orbit of the selected object: one full revolution as a closed polyline in ECI,
 * brightest at the object and fading toward the far side of the orbit. The geometry is
 * computed by the propagation worker (SGP4 sampled around one period) and stays valid for
 * many minutes; only a phase uniform moves the bright end along with the object.
 *
 * Depth-tested against the Earth like the points are, so the far-side arc is hidden.
 */

import { BufferAttribute, BufferGeometry, Color, Line, ShaderMaterial } from 'three';

const vertexShader = /* glsl */ `
  attribute float aT;         // 0..1 along the loop from the sample start
  uniform float uPhase;       // where the object is now, as a fraction of the loop
  varying float vDist;        // 0 at the object, 1 at the far side
  void main() {
    vDist = abs(fract(aT - uPhase + 0.5) - 0.5) * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vDist;
  void main() {
    float a = mix(0.95, 0.16, smoothstep(0.0, 1.0, vDist));
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

export class OrbitPath {
  readonly line: Line<BufferGeometry, ShaderMaterial>;
  private readonly uniforms;
  private startMs = NaN;
  private periodMs = NaN;
  private wanted = false;

  constructor() {
    this.uniforms = {
      uPhase: { value: 0 },
      uColor: { value: new Color('#4fc6d0') },
    };
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute('aT', new BufferAttribute(new Float32Array(0), 1));
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    this.line = new Line(geometry, material);
    this.line.frustumCulled = false;
    this.line.renderOrder = 2;
    this.line.visible = false;
    this.line.name = 'orbitPath';
  }

  /** `points`: scene-frame xyz triples for one revolution starting at `startMs`. */
  setPath(points: Float32Array, startMs: number, periodMs: number): void {
    const n = points.length / 3;
    const t = new Float32Array(n);
    for (let i = 0; i < n; i++) t[i] = i / (n - 1);
    const g = this.line.geometry;
    g.setAttribute('position', new BufferAttribute(points, 3));
    g.setAttribute('aT', new BufferAttribute(t, 1));
    g.setDrawRange(0, n);
    g.computeBoundingSphere();
    this.startMs = startMs;
    this.periodMs = periodMs;
    this.line.visible = this.wanted;
  }

  update(simMs: number): void {
    if (!Number.isFinite(this.startMs)) return;
    const phase = (simMs - this.startMs) / this.periodMs;
    this.uniforms.uPhase.value = phase - Math.floor(phase);
  }

  setColor(hex: string): void {
    this.uniforms.uColor.value.set(hex);
  }

  setVisible(on: boolean): void {
    this.wanted = on;
    this.line.visible = on && Number.isFinite(this.startMs);
  }

  clear(): void {
    this.line.geometry.setDrawRange(0, 0);
    this.startMs = NaN;
    this.line.visible = false;
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}
