/**
 * The observer's pin: a ring on the ground at their location, drawn as one screen-sized
 * point so it reads the same at every zoom. It lives under `earthGroup`, so it turns with
 * the Earth in both view frames for free. Hidden by the Earth itself when on the far side
 * (ordinary depth testing; it sits a little above the surface to avoid z-fighting).
 */

import { BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from 'three';
import { WGS84_A_KM, WGS84_B_KM } from '../astro/frames';
import { geodeticToEcef } from '../astro/topocentric';

const LIFT_KM = 12;
const SIZE_PX = 22;

const vertexShader = /* glsl */ `
  uniform float uPixelRatio;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = ${SIZE_PX.toFixed(1)} * uPixelRatio;
  }
`;

const fragmentShader = /* glsl */ `
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    // A ring with a dark rim on both edges, and a dot in the middle.
    float ring = smoothstep(0.62, 0.70, r) * (1.0 - smoothstep(0.86, 0.94, r));
    float rim = (smoothstep(0.54, 0.62, r) * (1.0 - smoothstep(0.62, 0.70, r))) + (smoothstep(0.86, 0.94, r) * (1.0 - smoothstep(0.94, 1.0, r)));
    float dot = 1.0 - smoothstep(0.16, 0.24, r);
    float dotRim = (1.0 - smoothstep(0.24, 0.34, r)) - dot;
    vec3 col = vec3(1.0) * (ring + dot) + vec3(0.0) * (rim + dotRim);
    float a = clamp(ring + dot + 0.85 * (rim + dotRim), 0.0, 1.0);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

export class ObserverMarker {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly uniforms = { uPixelRatio: { value: 1 } };

  constructor() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    this.points = new Points(
      geometry,
      new ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms, transparent: true, depthWrite: false }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
  }

  /** Place the pin. The Earth group is a unit sphere scaled to the ellipsoid, so local y is stretched back. */
  setLocation(latDeg: number, lonDeg: number, heightKm: number): void {
    const [x, y, z] = geodeticToEcef(latDeg, lonDeg, heightKm + LIFT_KM);
    const attr = this.points.geometry.getAttribute('position') as BufferAttribute;
    // ECEF (x, y, z) → scene (x, z, −y) → undo the group's polar scale on the y axis.
    attr.setXYZ(0, x, (z * WGS84_A_KM) / WGS84_B_KM, -y);
    attr.needsUpdate = true;
    this.points.visible = true;
  }

  clear(): void {
    this.points.visible = false;
  }

  setPixelRatio(pr: number): void {
    this.uniforms.uPixelRatio.value = pr;
  }

  /** World-space position of the pin (for the camera to aim at). */
  worldPosition(out: Vector3): Vector3 {
    const attr = this.points.geometry.getAttribute('position') as BufferAttribute;
    out.set(attr.getX(0), attr.getY(0), attr.getZ(0));
    return this.points.localToWorld(out);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
