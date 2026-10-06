import Phaser from 'phaser';

import { Rng } from '@/core/Rng';

/**
 * Placeholder customer entity.
 *
 * Phase 0 purpose: prove that pooled, timestamp-driven entity animation works on the
 * canvas (and give the game scene something visible to react to input). Real customer
 * behaviour - spawning rules, queues, satisfaction, spending - is Phase 2 content driven
 * by `CustomerDefinition` data, not by editing this class.
 *
 * Pooling matters on mobile: entities are reused from a free list, never allocated per
 * spawn, so the GC never spikes during play.
 */
export interface CustomerEntityOptions {
  readonly scene: Phaser.Scene;
  readonly radius?: number;
  readonly depth?: number;
}

export type CustomerState = 'idle' | 'walking' | 'leaving';

export class CustomerEntity {
  readonly sprite: Phaser.GameObjects.Arc;
  state: CustomerState = 'idle';

  private readonly ownerScene: Phaser.Scene;
  private readonly radius: number;
  private targetX = 0;
  private targetY = 0;
  private speedPxPerSecond = 60;
  private lifeRemainingMs = 0;
  private ageMs = 0;

  constructor(options: CustomerEntityOptions) {
    this.ownerScene = options.scene;
    this.radius = options.radius ?? 12;
    this.sprite = this.ownerScene.add
      .circle(0, 0, this.radius, 0xf2b544)
      .setDepth(options.depth ?? 50)
      .setVisible(false);
  }

  get isActive(): boolean {
    return this.sprite.visible;
  }

  /** Places the entity in the world and starts the simple walk-to-target routine. */
  spawn(x: number, y: number, targetX: number, targetY: number, lifetimeMs: number, rng?: Rng): void {
    this.sprite.setPosition(x, y).setVisible(true).setAlpha(1).setScale(1);
    this.targetX = targetX;
    this.targetY = targetY;
    this.lifeRemainingMs = Math.max(0, lifetimeMs);
    this.ageMs = 0;
    this.state = 'walking';
    // Deterministic jitter when a seeded Rng is provided (tests, replays).
    this.speedPxPerSecond = (rng ? rng.float(70, 110) : 70 + Math.random() * 40);
    this.sprite.setFillStyle(rng ? (rng.chance(0.5) ? 0xf2b544 : 0x5fd0ff) : 0xf2b544);
  }

  /**
   * Frame update.
   * @param deltaMs Real elapsed time from Phaser's loop (already timestamp based).
   */
  update(deltaMs: number): void {
    if (!this.sprite.visible) return;

    this.ageMs += deltaMs;
    const dt = deltaMs / 1000;
    const dx = this.targetX - this.sprite.x;
    const dy = this.targetY - this.sprite.y;
    const distance = Math.hypot(dx, dy);

    if (this.state === 'walking') {
      if (distance < 2) {
        this.state = 'idle';
      } else {
        const step = Math.min(distance, this.speedPxPerSecond * dt);
        this.sprite.x += (dx / distance) * step;
        this.sprite.y += (dy / distance) * step;
      }
    }

    if (this.ageMs >= this.lifeRemainingMs) {
      this.state = 'leaving';
      const fade = Math.max(0, 1 - (this.ageMs - this.lifeRemainingMs) / 400);
      this.sprite.setAlpha(fade);
      if (fade <= 0) this.despawn();
    }
  }

  despawn(): void {
    this.sprite.setVisible(false);
    this.state = 'idle';
    this.lifeRemainingMs = 0;
    this.ageMs = 0;
  }

  destroy(): void {
    this.sprite.destroy();
  }

}

/**
 * Fixed-capacity pool: no allocation during play, no unbounded growth.
 */
export class CustomerPool {
  private readonly entities: CustomerEntity[] = [];
  private readonly free: CustomerEntity[] = [];

  constructor(scene: Phaser.Scene, capacity = 24, options: CustomerEntityOptions | null = null) {
    this.entities = [];
    const entityOptions: CustomerEntityOptions = options ?? { scene };
    for (let i = 0; i < capacity; i += 1) {
      const entity = new CustomerEntity(entityOptions);
      this.entities.push(entity);
      this.free.push(entity);
    }
  }

  get size(): number {
    return this.entities.length;
  }

  get activeCount(): number {
    return this.entities.length - this.free.length;
  }

  spawn(x: number, y: number, targetX: number, targetY: number, lifetimeMs: number, rng?: Rng): CustomerEntity | null {
    const entity = this.free.pop();
    if (!entity) return null;
    entity.spawn(x, y, targetX, targetY, lifetimeMs, rng);
    return entity;
  }

  update(deltaMs: number): void {
    for (const entity of this.entities) {
      if (!entity.isActive) continue;
      entity.update(deltaMs);
      if (!entity.isActive) this.free.push(entity);
    }
  }

  releaseAll(): void {
    for (const entity of this.entities) {
      if (entity.isActive) {
        entity.despawn();
        this.free.push(entity);
      }
    }
  }

  dispose(): void {
    for (const entity of this.entities) entity.destroy();
    this.entities.length = 0;
    this.free.length = 0;
  }
}
