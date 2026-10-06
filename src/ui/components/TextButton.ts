/**
 * Reusable button.
 *
 * Touch targets are sized from the viewport (never absolute pixels), pointer input
 * is scoped to the button itself, and disabled state is explicit so gameplay code
 * can bind availability without inventing its own widget.
 */

import Phaser from 'phaser';
import { COLORS, HEX, textStyle } from '../UiTheme';
import type { Viewport } from '../layout/Viewport';
import type { Rect } from '../layout/Layout';

export interface TextButtonOptions {
  rect: Rect;
  label: string;
  viewport: Viewport;
  tone?: 'primary' | 'secondary' | 'ghost' | 'danger';
  enabled?: boolean;
  fontSize?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

const TONE_COLORS: Record<NonNullable<TextButtonOptions['tone']>, { fill: number; border: number; text: string }> = {
  primary: { fill: COLORS.accent, border: COLORS.accentDark, text: HEX.dark },
  secondary: { fill: COLORS.panelAlt, border: COLORS.border, text: HEX.text },
  ghost: { fill: 0x000000, border: COLORS.border, text: HEX.textDim },
  danger: { fill: COLORS.danger, border: 0x8c1f23, text: HEX.text },
};

export class TextButton extends Phaser.GameObjects.Container {
  private readonly background: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly tone: NonNullable<TextButtonOptions['tone']>;
  private rectValue: Rect;
  private enabledValue: boolean;
  private handler: (() => void) | null;

  constructor(scene: Phaser.Scene, options: TextButtonOptions) {
    super(scene, options.rect.x, options.rect.y);
    this.rectValue = { x: 0, y: 0, width: options.rect.width, height: options.rect.height };
    this.tone = options.tone ?? 'primary';
    this.enabledValue = options.enabled ?? true;
    this.handler = options.onClick ?? null;

    this.background = scene.add.graphics();
    this.label = scene.add
      .text(this.rectValue.width / 2, this.rectValue.height / 2, options.label, textStyle(options.viewport, {
        size: options.fontSize ?? 'md',
        color: TONE_COLORS[this.tone].text,
        bold: true,
        align: 'center',
      }))
      .setOrigin(0.5, 0.5);

    this.add([this.background, this.label]);
    this.setSize(this.rectValue.width, this.rectValue.height);
    this.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, this.rectValue.width, this.rectValue.height),
      Phaser.Geom.Rectangle.Contains,
    );

    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.setScale(0.97));
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => this.setScale(1));
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
      this.setScale(1);
      if (this.enabledValue) this.handler?.();
    });

    this.redraw();
    scene.add.existing(this);
  }

  setLabel(text: string): this {
    this.label.setText(text);
    return this;
  }

  setEnabled(enabled: boolean): this {
    if (this.enabledValue === enabled) return this;
    this.enabledValue = enabled;
    this.redraw();
    return this;
  }

  get isEnabled(): boolean {
    return this.enabledValue;
  }

  onActivate(handler: () => void): this {
    this.handler = handler;
    return this;
  }

  toggleEnabled(): this {
    return this.setEnabled(!this.enabledValue);
  }

  setRect(rect: Rect): this {
    this.rectValue = { x: 0, y: 0, width: rect.width, height: rect.height };
    this.setPosition(rect.x, rect.y);
    this.setSize(rect.width, rect.height);
    this.label.setPosition(rect.width / 2, rect.height / 2);
    this.redraw();
    return this;
  }

  private redraw(): void {
    const colors = TONE_COLORS[this.tone];
    const alpha = this.enabledValue ? 1 : 0.45;
    const radius = Math.min(16, this.rectValue.height * 0.28);

    this.background.clear();
    this.background.fillStyle(colors.fill, this.tone === 'ghost' ? 0.25 * alpha : alpha);
    this.background.fillRoundedRect(0, 0, this.rectValue.width, this.rectValue.height, radius);
    this.background.lineStyle(2, colors.border, alpha);
    this.background.strokeRoundedRect(0, 0, this.rectValue.width, this.rectValue.height, radius);

    this.label.setAlpha(this.enabledValue ? 1 : 0.6);
  }
}
