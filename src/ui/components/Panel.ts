/**
 * Panel surface: a rounded, themed background drawn with Graphics so it can be
 * resized freely (no texture-size limits, no per-size texture duplication).
 */

import Phaser from 'phaser';
import { COLORS } from '../UiTheme';
import type { Rect } from '../layout/Layout';

export interface PanelStyle {
  fill?: number;
  fillAlpha?: number;
  border?: number;
  borderAlpha?: number;
  radius?: number;
  borderWidth?: number;
}

export class Panel extends Phaser.GameObjects.Container {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private rectValue: Rect;

  constructor(scene: Phaser.Scene, rect: Rect, private readonly style: PanelStyle = {}) {
    super(scene, rect.x, rect.y);
    this.rectValue = { x: 0, y: 0, width: rect.width, height: rect.height };
    this.graphics = scene.add.graphics();
    this.add(this.graphics);
    this.redraw();
    scene.add.existing(this);
  }

  get rect(): Rect {
    return { ...this.rectValue, x: this.x, y: this.y };
  }

  setRect(rect: Rect): this {
    this.rectValue = { x: 0, y: 0, width: rect.width, height: rect.height };
    this.setPosition(rect.x, rect.y);
    this.redraw();
    return this;
  }

  private redraw(): void {
    const radius = this.style.radius ?? Math.min(18, this.rectValue.height * 0.16);
    this.graphics.clear();
    this.graphics.fillStyle(this.style.fill ?? COLORS.panel, this.style.fillAlpha ?? 0.96);
    this.graphics.fillRoundedRect(0, 0, this.rectValue.width, this.rectValue.height, radius);
    this.graphics.lineStyle(this.style.borderWidth ?? 2, this.style.border ?? COLORS.border, this.style.borderAlpha ?? 1);
    this.graphics.strokeRoundedRect(0, 0, this.rectValue.width, this.rectValue.height, radius);
  }
}
