import Phaser from 'phaser';

import { RADIUS } from '@/core/constants/Layout';
import { UI_THEME } from '@/ui/theme/UiTheme';
import { Widget, type WidgetOptions } from './Widget';

/**
 * Placeholder-friendly progress bar used for upgrade timers, restoration progress and
 * offline-reward previews. Progress is set from a value in 0..1 - never from a frame
 * count - so the caller can feed it straight from TimerSystem/UpgradeSystem.
 */
export interface ProgressBarOptions extends WidgetOptions {
  readonly width: number;
  readonly height?: number;
  readonly initial?: number;
  readonly color?: number;
  readonly trackColor?: number;
}

export class ProgressBar extends Widget {
  private readonly barWidth: number;
  private readonly barHeight: number;
  private fillColor: number;
  private readonly trackColor: number;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private progress = 0;

  constructor(scene: Phaser.Scene, options: ProgressBarOptions) {
    const height = options.height ?? 18;
    super(scene, { ...options, size: options.size ?? { width: options.width, height } });
    this.barWidth = options.width;
    this.barHeight = height;
    this.fillColor = options.color ?? UI_THEME.colors.accent;
    this.trackColor = options.trackColor ?? UI_THEME.colors.surfaceAlt;
    this.graphics = this.addToWidget(scene.add.graphics());
    this.setProgress(options.initial ?? 0);
  }

  get value(): number {
    return this.progress;
  }

  setProgress(value: number): this {
    this.progress = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
    this.redraw();
    return this;
  }

  setColor(color: number): this {
    this.fillColor = color;
    this.redraw();
    return this;
  }

  private redraw(): void {
    const height = this.barHeight;
    const width = this.barWidth;
    const radius = Math.min(RADIUS.sm, height / 2);
    this.graphics.clear();
    this.graphics.fillStyle(this.trackColor, 1);
    this.graphics.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    if (this.progress > 0) {
      const filled = Math.max(radius * 2, width * this.progress);
      this.graphics.fillStyle(this.fillColor, 1);
      this.graphics.fillRoundedRect(-width / 2, -height / 2, filled, height, radius);
    }
  }
}
