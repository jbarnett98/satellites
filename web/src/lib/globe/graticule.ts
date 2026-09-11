/**
 * Latitude/longitude grid every 15°, drawn a hair above the surface. The equator and the
 * prime meridian are brighter so the frame can be read at a glance. Lives inside the Earth
 * group, so it rotates with the planet.
 */

import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments } from 'three';
import { WGS84_A_KM } from '../astro/frames';
import { DEG2RAD } from '../astro/time';

const STEP_DEG = 15;
const SEGMENTS = 96;
const LIFT = 1.002;

function ringPositions(kind: 'lat' | 'lon', angleDeg: number, r: number): number[] {
  const out: number[] = [];
  const a = angleDeg * DEG2RAD;
  for (let i = 0; i < SEGMENTS; i++) {
    for (const k of [i, i + 1]) {
      const t = (k / SEGMENTS) * Math.PI * 2;
      if (kind === 'lat') {
        // circle of constant latitude: east longitude increases toward -z
        const c = Math.cos(a) * r;
        out.push(c * Math.cos(t), Math.sin(a) * r, -c * Math.sin(t));
      } else {
        // meridian: full circle through the poles at longitude `a`
        const lat = t - Math.PI / 2;
        const c = Math.cos(lat) * r;
        out.push(c * Math.cos(a), Math.sin(lat) * r, -c * Math.sin(a));
      }
    }
  }
  return out;
}

export class Graticule {
  readonly root = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: LineBasicMaterial[] = [];

  constructor() {
    const r = WGS84_A_KM * LIFT;
    const minor: number[] = [];
    const major: number[] = [];

    for (let lat = -90 + STEP_DEG; lat < 90; lat += STEP_DEG) {
      (lat === 0 ? major : minor).push(...ringPositions('lat', lat, r));
    }
    for (let lon = 0; lon < 180; lon += STEP_DEG) {
      (lon === 0 ? major : minor).push(...ringPositions('lon', lon, r));
    }

    this.root.add(this.makeLines(minor, 0.14));
    this.root.add(this.makeLines(major, 0.38));
    this.root.name = 'graticule';
  }

  private makeLines(positions: number[], opacity: number): LineSegments {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const material = new LineBasicMaterial({
      color: 0x9fd6dc,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    this.geometries.push(geometry);
    this.materials.push(material);
    return new LineSegments(geometry, material);
  }

  setVisible(on: boolean): void {
    this.root.visible = on;
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
