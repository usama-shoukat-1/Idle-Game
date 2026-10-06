/**
 * Toast notifications.
 *
 * Anything can publish `ui:toast` on the event bus and the toast appears; no
 * system needs a reference to the UI. Toasts are pooled-ish (a fixed small stack)
 * to keep the garbage collector quiet on mobile.
 */

import Phaser from 'phaser';
import { COLORS, HEX, textStyle } from '../UiTheme';
import { topBarRect } from '../layout/Layout';
import type { Subscription } from '@/systems/EventSystem';
import type { GameEventBus } from '@/systems/EventSystem';
import type { Viewport } from '../layout/Viewport';
import type { ToastTone } from '@/core/types/events';

const TONE_COLOR: Record<ToastTone, { fill: number; border: number; text: string }> = {
  info: { fill: COLORS.panelAlt, border: COLORS.border, text: HEX.text },
  success: { fill: 0x1c3324, border: COLORS.success, text: HEX.success },
  warning: { fill: 0x342b16, border: COLORS.warning, text: HEX.warning },
  error: { fill: 0x361a1c, border: COLORS.danger, text: HEX.danger },
};

interface ActiveToast {
  container: Phaser.GameObjects.Container;
  expiresAt: number;
}

export class ToastManager {
  private readonly active: ActiveToast[] = [];
  private readonly subscription: Subscription;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly events: GameEventBus,
    private readonly viewport: Viewport,
  ) {
    this.subscription = this.events.on('ui:toast', ({ message, tone, durationMs }) => {
      this.show(message, tone, durationMs);
    });
  }

  show(message: string, tone: ToastTone = 'info', durationMs = 2_400): void {
    const { width } = this.viewport.bounds;
    const bar = topBarRect(this.viewport);
    const fontSize = Math.max(12, Math.round(width * 0.032));
    const padding = Math.round(fontSize * 0.8);

    const text = this.scene.add.text(0, 0, message, {
      ...textStyle(this.viewport, { size: 'sm', color: TONE_COLOR[tone].text }),
      fontSize: `${fontSize}px`,
      wordWrap: { width: width * 0.78, useAdvancedWrap: true },
    });
    text.setOrigin(0.5, 0.5);

    const boxWidth = Math.min(width * 0.88, text.width + padding * 2);
    const boxHeight = text.height + padding * 1.4;

    const background = this.scene.add.graphics();
    background.fillStyle(TONE_COLOR[tone].fill, 0.96);
    background.fillRoundedRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, boxHeight / 3);
    background.lineStyle(2, TONE_COLOR[tone].border, 1);
    background.strokeRoundedRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, boxHeight / 3);

    const container = this.scene.add.container(width / 2, bar.y + bar.height + boxHeight, [background, text]);
    container.setDepth(9_000).setScrollFactor(0).setAlpha(0);

    this.scene.tweens.add({ targets: container, alpha: 1, y: bar.y + bar.height + boxHeight * 0.8, duration: 160 });

    this.active.push({ container, expiresAt: this.scene.time.now + durationMs });
    this.reflow();
    this.prune();
  }

  /** Called from the scene update loop (cheap: only the timestamp check). */
  update(): void {
    this.prune();
  }

  private prune(): void {
    const now = this.scene.time.now;
    for (let index = this.active.length - 1; index >= 0; index -= 1) {
      const entry = this.active[index];
      if (entry.expiresAt > now) continue;
      this.active.splice(index, 1);
      this.scene.tweens.add({
        targets: entry.container,
        alpha: 0,
        duration: 180,
        onComplete: () => entry.container.destroy(true),
      });
    }
  }

  private reflow(): void {
    const bar = topBarRect(this.viewport);
    let offset = bar.y + bar.height;
    for (const entry of this.active) {
      offset += entry.container.height * 0.9;
      entry.container.setPosition(this.viewport.width / 2, offset);
    }
  }

  /** Re-stack toasts after a resize/orientation change. */
  resize(): void {
    this.reflow();
  }

  destroy(): void {
    this.subscription.off();
    for (const entry of this.active) entry.container.destroy(true);
    this.active.length = 0;
  }
}
