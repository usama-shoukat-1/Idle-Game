import Phaser from 'phaser';

import { UI_DEPTH } from '@/core/constants/GameConstants';
import { COLORS_CSS, FONT_FAMILY, FONT_SIZE, PALETTE } from '@/core/constants/Layout';

/**
 * INCOME FEEDBACK (pooled, restrained)
 * ====================================
 * A tiny floating "+coins" pop with a coin dot, reused from a fixed pool so income
 * feedback never allocates during play and can never flood the screen.
 *
 * Deliberately understated: one pop per collection tick (at most ~1/second, driven by the
 * caller's throttle), no particles, no screen shake. Object pooling + tweens mean the cost
 * per pop is one text texture update and one tween.
 */
export interface CoinFeedbackOptions {
  readonly scene: Phaser.Scene;
  readonly depth?: number;
  /** Pool size - the number of simultaneous pops on screen. */
  readonly size?: number;
}

interface PooledPop {
  readonly container: Phaser.GameObjects.Container;
  readonly text: Phaser.GameObjects.Text;
  readonly coin: Phaser.GameObjects.Arc;
  tween: Phaser.Tweens.Tween | null;
}

export class CoinFeedback {
  private readonly scene: Phaser.Scene;
  private readonly pool: PooledPop[] = [];
  private cursor = 0;

  constructor(options: CoinFeedbackOptions) {
    this.scene = options.scene;
    const size = Math.max(1, options.size ?? 4);
    const depth = options.depth ?? UI_DEPTH.worldOverlay;

    for (let i = 0; i < size; i += 1) {
      const coin = options.scene.add.circle(0, 0, 9, PALETTE.coin, 1).setOrigin(0.5);
      const text = options.scene.add
        .text(14, 0, '', {
          fontFamily: FONT_FAMILY,
          fontSize: `${FONT_SIZE.tiny}px`,
          color: COLORS_CSS.accent,
          fontStyle: 'bold',
        })
        .setOrigin(0, 0.5);
      const container = options.scene.add
        .container(0, 0, [coin, text])
        .setDepth(depth)
        .setVisible(false);
      this.pool.push({ container, text, coin, tween: null });
    }
  }

  /** Floats `+amount` up from (x, y) in **pixels** (the world layer is not UI-scaled). */
  pop(x: number, y: number, amount: number, label = ''): void {
    const pop = this.pool[this.cursor % this.pool.length]!;
    this.cursor += 1;

    pop.tween?.remove();
    pop.text.setText(`${label}${amount > 0 ? '+' : ''}${amount}`);
    pop.container.setPosition(x, y).setVisible(true).setAlpha(1).setScale(0.9);

    pop.tween = this.scene.tweens.add({
      targets: pop.container,
      y: y - 64,
      alpha: 0,
      scale: 1.06,
      duration: 900,
      ease: 'Quad.easeOut',
      onComplete: () => {
        pop.container.setVisible(false);
        pop.tween = null;
      },
    });
  }

  destroy(): void {
    for (const pop of this.pool) {
      pop.tween?.remove();
      pop.container.destroy();
    }
    this.pool.length = 0;
  }
}
