import Phaser from 'phaser';

import { UI_DEPTH } from '@/core/constants/GameConstants';
import { PALETTE } from '@/core/constants/Layout';

/**
 * SCRIPTED CUSTOMER ACTIVITY (cosmetic only)
 * =========================================
 * Once the café is operational, a few simple figures walk in, stand for a moment and
 * leave. That is the entire system - by design:
 *
 *  - **It never touches the economy.** Income comes from `BuildingSystem`, so customer
 *    behaviour cannot change what the player earns (Phase 1 brief, rule 13).
 *  - **No navigation AI.** Each visitor follows one scripted tween chain.
 *  - **Pooled and capped.** At most `maxActive` figures exist, reused from a free list, so
 *    there is no per-spawn allocation and no unbounded object growth on a phone.
 *  - **Tween driven.** Phaser tweens are timestamp based, so a backgrounded tab simply
 *    resumes where it left off instead of fast-forwarding.
 */
export interface CustomerVisitorsOptions {
  readonly scene: Phaser.Scene;
  readonly depth?: number;
  readonly maxActive?: number;
}

interface Visitor {
  readonly container: Phaser.GameObjects.Container;
  active: boolean;
  timeline: Phaser.Tweens.TweenChain | null;
}

const SHIRT_COLOURS = [0xe4698a, 0x5fd0ff, 0xf2b544, 0x8fd18f, 0xc79bff];

export class CustomerVisitors {
  private readonly scene: Phaser.Scene;
  private readonly visitors: Visitor[] = [];
  private readonly depth: number;
  private spawnTimer = 0;
  private spawnIndex = 0;

  constructor(options: CustomerVisitorsOptions) {
    this.scene = options.scene;
    this.depth = options.depth ?? UI_DEPTH.worldOverlay - 10;
    const count = Math.max(1, options.maxActive ?? 3);
    for (let i = 0; i < count; i += 1) {
      this.visitors.push({ container: this.buildVisitor(i), active: false, timeline: null });
    }
  }

  /**
   * Frame hook. `deltaMs` only decides *when to spawn*; the walk itself is tween driven,
   * so this is not a frame-counting simulation.
   *
   * @param intensity 0..1 - how busy the café looks (tier driven): 0 means "no visitors".
   * @param anchors  pixel-space path: off-screen entry, standing spot and exit.
   */
  update(deltaMs: number, intensity: number, anchors: { entry: { x: number; y: number }; stand: { x: number; y: number }; exit: { x: number; y: number } }): void {
    if (intensity <= 0) return;

    const intervalMs = Phaser.Math.Linear(5_200, 2_400, Math.min(1, intensity));
    this.spawnTimer -= deltaMs;
    if (this.spawnTimer > 0) return;

    const visitor = this.visitors.find((entry) => !entry.active);
    if (!visitor) {
      // Everyone is busy: check again shortly rather than queueing work.
      this.spawnTimer = 600;
      return;
    }

    this.spawnTimer = intervalMs + Math.random() * 900;
    this.startVisit(visitor, anchors);
  }

  /** Immediately sends everyone home (used when the café closes / the scene shuts down). */
  clear(): void {
    for (const visitor of this.visitors) {
      visitor.timeline?.destroy();
      visitor.timeline = null;
      visitor.active = false;
      visitor.container.setVisible(false);
    }
  }

  private startVisit(
    visitor: Visitor,
    anchors: { entry: { x: number; y: number }; stand: { x: number; y: number }; exit: { x: number; y: number } },
  ): void {
    visitor.active = true;
    visitor.container.setVisible(true).setAlpha(1);
    // Slight per-visitor variation so they do not move like a chorus line.
    const offset = (this.spawnIndex % 3) * 14;
    this.spawnIndex += 1;
    const standX = anchors.stand.x + offset;
    const standY = anchors.stand.y + (offset % 2 === 0 ? 0 : -6);

    visitor.container.setPosition(anchors.entry.x, anchors.entry.y);
    visitor.container.setScale(1);

    // One chain, three steps: walk in -> wait at the counter (a small bob so they read as
    // "browsing", not frozen) -> walk off. Configs (not Tween instances) are what
    // `tweens.chain` expects.
    visitor.timeline = this.scene.tweens.chain({
      targets: visitor.container,
      tweens: [
        { x: standX, y: standY, duration: 1_400, ease: 'Sine.easeOut' },
        { y: standY - 4, duration: 700, yoyo: true, repeat: 2, ease: 'Sine.easeInOut' },
        {
          x: anchors.exit.x,
          y: anchors.exit.y,
          alpha: 0,
          duration: 1_600,
          ease: 'Sine.easeIn',
          onComplete: () => {
            visitor.active = false;
            visitor.container.setVisible(false);
            visitor.timeline = null;
          },
        },
      ],
    });
  }

  private buildVisitor(index: number): Phaser.GameObjects.Container {
    const body = this.scene.add.rectangle(0, 0, 22, 34, SHIRT_COLOURS[index % SHIRT_COLOURS.length]!, 1).setOrigin(0.5, 0.5);
    const head = this.scene.add.circle(0, -26, 12, 0xe3b48c, 1);
    const legs = this.scene.add.rectangle(0, 24, 16, 14, 0x35455c, 1).setOrigin(0.5, 0.5);
    return this.scene.add
      .container(0, 0, [legs, body, head])
      .setDepth(this.depth)
      .setVisible(false)
      .setAlpha(0.95)
      .setScale(1);
  }

  destroy(): void {
    this.clear();
    for (const visitor of this.visitors) visitor.container.destroy();
    this.visitors.length = 0;
  }
}

/** Shared palette reference so future visitor variants stay visually consistent. */
export const VISITOR_TINTS = PALETTE;
