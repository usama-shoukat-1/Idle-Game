/** Thin progress/timer bar used by upgrade timers and district progress rows. */

import Phaser from 'phaser';
import { COLORS } from '../UiTheme';
import type { Rect } from '../layout/Layout';
import { clamp01 } from '@/core/utils/numbers';

export class ProgressBar extends Phaser.GameObjects.Container {
  private readonly background: Phaser.GameObjects.Graphics;
  private readonly fill: Phaser.GameObjects.Graphics;
  private rectValue: Rect;
  private progress = 0;
  private color: number;

  constructor(scene: Phaser.Scene, rect: Rect, color: number = COLORS.accent) {
    super(scene, rect.x, rect.y);
    this.rectValue = { x: 0, y: 0, width: rect.width, height: rect.height };
    this.color = color;
    this.background = scene.add.graphics();
    this.fill = scene.add.graphics();
    this.add([this.background, this.fill]);
    this.redraw();
    scene.add.existing(this);
  }

  setProgress(value: number): this {
    const next = clamp01(value);
    if (Math.abs(next - this.progress) < 0.002) return this;
    this.progress = next;
    this.redraw();
    return this;
  }

  setColor(color: number): this {
    this.color = color;
    this.redraw();
    return this;
  }

  setRect(rect: Rect): this {
    this.rectValue = { x: 0, y: 0, width: rect.width, height: rect.height };
    this.setPosition(rect.x, rect.y);
    this.redraw();
    return this;
  }

  private redraw(): void {
    const radius = Math.min(this.rectValue.height / 2, 8);
    this.background.clear();
    this.background.fillStyle(0x000000, 0.35);
    this.background.fillRoundedRect(0, 0, this.rectValue.width, this.rectValue.height, radius);

    this.fill.clear();
    const width = Math.max(0, this.rectValue.width * this.progress);
    if (width <= 0) return;
    this.fill.fillStyle(this.color, 1);
    this.fill.fillRoundedRect(0, 0, Math.max(width, radius * 2), this.rectValue.height, radius);
  }
}
