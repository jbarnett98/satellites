/**
 * The Sun, drawn where it really is. A billboard in the sky scene placed along the computed
 * sun vector: a disc of the Sun's true angular diameter (0.53°) inside a soft glare. Because
 * the sky scene is drawn before the world, the Earth naturally occludes it — the Sun sets
 * behind the limb exactly when it should.
 */

import { AdditiveBlending, CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace, Vector3 } from 'three';
import { SKY_RADIUS } from './stars';

/** Sprite edge length in sky units; 1.5 at radius 9.5 subtends ≈ 9°, so the glare is ~9° across. */
const SPRITE_SIZE = 1.5;
const SPRITE_DISTANCE = SKY_RADIUS * 0.95;

function makeSunTexture(size = 512): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  // The disc: 0.53° across ⇒ radius 0.265° of a 9° sprite ⇒ 2.9% of the radius.
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.029, 'rgba(255,255,255,1)');
  g.addColorStop(0.045, 'rgba(255,250,236,0.85)');
  g.addColorStop(0.09, 'rgba(255,238,205,0.32)');
  g.addColorStop(0.22, 'rgba(255,224,185,0.08)');
  g.addColorStop(0.55, 'rgba(255,214,175,0.012)');
  g.addColorStop(1.0, 'rgba(255,210,170,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class SunSprite {
  readonly sprite: Sprite;
  private readonly texture: CanvasTexture;

  constructor() {
    this.texture = makeSunTexture();
    const material = new SpriteMaterial({
      map: this.texture,
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.sprite = new Sprite(material);
    this.sprite.scale.set(SPRITE_SIZE, SPRITE_SIZE, 1);
    this.sprite.renderOrder = 2;
    this.sprite.name = 'sun';
  }

  /** `dirScene` is the unit sun vector in scene (inertial) coordinates. */
  update(dirScene: Vector3): void {
    this.sprite.position.copy(dirScene).multiplyScalar(SPRITE_DISTANCE);
  }

  dispose(): void {
    this.sprite.material.dispose();
    this.texture.dispose();
  }
}
