import Phaser from 'phaser';

import { SPACING } from '@/core/constants/Layout';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import type { GameClock } from '@/core/Time';
import type { EventBus } from '@/core/events/EventBus';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import { Screen } from './Screen';

/**
 * Toast / notification layer.
 *
 * Subscribes to `ui:toast`, so *any* system can notify the player without knowing that UI
 * exists (`events.emit('ui:toast', { message: 'Upgrade complete' })`).
 *
 * Expiry is timestamp based (a deadline per toast, checked in `update`) instead of
 * `setTimeout` per toast, so toasts cannot pile up while the tab is throttled, and the
 * layer costs one comparison per frame.
 */
interface ToastEntry {
  readonly container: Phaser.GameObjects.Container;
  readonly deadline: number;
  dismissing: boolean;
}

export interface ToastLayerOptions {
  readonly events: EventBus;
  readonly clock: GameClock;
  readonly maxVisible?: number;
  readonly lifetimeMs?: number;
}

type ToastVariant = 'info' | 'success' | 'warning' | 'error';

const VARIANT_COLOURS: Record<ToastVariant, number> = {
  info: UI_THEME.colors.surfaceAlt,
  success: UI_THEME.colors.success,
  warning: UI_THEME.colors.warning,
  error: UI_THEME.colors.danger,
};

export class ToastLayer extends Screen {
  private readonly toasts: ToastEntry[] = [];
  private readonly toastOptions: ToastLayerOptions;
  private readonly unsubscribe: () => void;

  constructor(scene: Phaser.Scene, options: ToastLayerOptions) {
    super(scene, { depth: UI_DEPTH.toasts });
    this.toastOptions = options;

    this.unsubscribe = options.events.on('ui:toast', ({ message, variant }) => {
      this.push(message, variant ?? 'info');
    });
  }

  push(message: string, variant: ToastVariant = 'info'): void {
    const maxVisible = this.toastOptions.maxVisible ?? 3;
    while (this.toasts.length >= maxVisible) {
      const oldest = this.toasts.shift();
      oldest?.container.destroy();
    }

    const width = Math.min(this.contentWidth, 620);
    const height = Math.max(84, SPACING.xxxl + SPACING.md);
    const fill = VARIANT_COLOURS[variant] ?? UI_THEME.colors.surfaceAlt;

    const background = this.scene.add.graphics();
    background.fillStyle(fill, 0.96);
    background.fillRoundedRect(-width / 2, -height / 2, width, height, SPACING.md);
    background.lineStyle(2, UI_THEME.colors.outline, 0.9);
    background.strokeRoundedRect(-width / 2, -height / 2, width, height, SPACING.md);

    const text = makeText(this.scene, message, {
      size: 'small',
      align: 'center',
      wordWrapWidth: width - SPACING.xl,
    });
    text.setOrigin(0.5, 0.5);

    const container = this.scene.add.container(0, 0, [background, text]);
    this.container.add(container);

    this.toasts.push({
      container,
      deadline: this.toastOptions.clock.now() + (this.toastOptions.lifetimeMs ?? 3200),
      dismissing: false,
    });

    this.reflow();
  }

  override update(_time: number, _delta: number): void {
    const now = this.toastOptions.clock.now();
    for (const toast of this.toasts) {
      if (toast.dismissing) continue;
      if (now >= toast.deadline) {
        toast.dismissing = true;
        this.scene.tweens.add({
          targets: toast.container,
          alpha: 0,
          duration: 260,
          onComplete: () => this.remove(toast),
        });
      }
    }
  }

  protected override layout(_handle: LayoutHandle): void {
    this.reflow();
  }

  /** Stacks toasts upwards from the bottom of the frame, newest closest to the edge. */
  private reflow(): void {
    const spacing = SPACING.sm;
    const rowHeight = SPACING.xxxl + SPACING.md;
    const baseY = this.bottom(SPACING.xxl);
    this.toasts.forEach((toast, index) => {
      const y = baseY - (this.toasts.length - 1 - index) * (rowHeight + spacing) - rowHeight / 2;
      toast.container.setPosition(this.centerX(), y);
    });
  }

  private remove(toast: ToastEntry): void {
    const index = this.toasts.indexOf(toast);
    if (index >= 0) this.toasts.splice(index, 1);
    toast.container.removeAll(true);
    toast.container.destroy();
    this.reflow();
  }

  override destroy(): void {
    this.unsubscribe();
    for (const toast of this.toasts) toast.container.destroy();
    this.toasts.length = 0;
    super.destroy();
  }
}
