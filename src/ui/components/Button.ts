import Phaser from 'phaser';

import { MIN_TOUCH_TARGET, RADIUS, SPACING } from '@/core/constants/Layout';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import { Widget, type WidgetOptions } from './Widget';

/**
 * Reusable button.
 *
 * Mobile rules encoded here (not repeated per screen):
 * - minimum touch target of 44 CSS px (`MIN_TOUCH_TARGET` design units),
 * - press feedback that happens on pointer *down* (a tap must feel instant),
 * - `pointerup` outside the button cancels the action instead of firing it,
 * - input is ignored while `disabled`, with a visible disabled style.
 */
export interface ButtonOptions extends WidgetOptions {
  readonly label: string;
  readonly width?: number;
  readonly height?: number;
  readonly onClick: () => void;
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  readonly icon?: string;
  readonly disabled?: boolean;
}

const VARIANTS: Record<
  NonNullable<ButtonOptions['variant']>,
  { fill: number; stroke: number; text: string; alpha: number }
> = {
  primary: { fill: UI_THEME.colors.accent, stroke: UI_THEME.colors.accent, text: '#1a1206', alpha: 1 },
  secondary: { fill: UI_THEME.colors.surfaceAlt, stroke: UI_THEME.colors.outline, text: UI_THEME.css.text, alpha: 1 },
  ghost: { fill: UI_THEME.colors.surface, stroke: UI_THEME.colors.outline, text: UI_THEME.css.textMuted, alpha: 0.9 },
  danger: { fill: UI_THEME.colors.danger, stroke: UI_THEME.colors.danger, text: '#2a0d11', alpha: 1 },
};

export class Button extends Widget {
  private readonly background: Phaser.GameObjects.Graphics;
  private readonly labelText: Phaser.GameObjects.Text;
  private readonly hitArea: Phaser.GameObjects.Rectangle;
  private readonly variantStyle: (typeof VARIANTS)[NonNullable<ButtonOptions['variant']>];
  private readonly buttonWidth: number;
  private readonly buttonHeight: number;
  private enabled = true;

  constructor(scene: Phaser.Scene, private readonly buttonOptions: ButtonOptions) {
    const width = buttonOptions.width ?? 280;
    const height = Math.max(buttonOptions.height ?? MIN_TOUCH_TARGET, MIN_TOUCH_TARGET);
    super(scene, {
      ...buttonOptions,
      anchorY: buttonOptions.anchorY ?? 'middle',
      size: { width, height },
    });

    this.variantStyle = VARIANTS[buttonOptions.variant ?? 'primary'];
    this.buttonWidth = width;
    this.buttonHeight = height;

    this.background = this.addToWidget(scene.add.graphics());
    this.drawBackground(false);

    const label = buttonOptions.icon ? `${buttonOptions.icon}  ${buttonOptions.label}` : buttonOptions.label;
    this.labelText = this.addToWidget(
      makeText(scene, label, {
        size: 'small',
        bold: true,
        color: this.variantStyle.text,
        align: 'center',
      }),
    );
    this.labelText.setOrigin(0.5, 0.5);

    // A transparent rectangle provides a reliable hit area independent of the graphics.
    this.hitArea = this.addToWidget(
      scene.add
        .rectangle(0, 0, this.buttonWidth, this.buttonHeight, 0x000000, 0)
        .setOrigin(0.5, 0.5),
    );
    this.hitArea.setInteractive({ useHandCursor: true });

    this.hitArea.on('pointerdown', this.handleDown, this);
    this.hitArea.on('pointerup', this.handleUp, this);
    this.hitArea.on('pointerout', this.handleOut, this);
    this.hitArea.on('pointerover', this.handleOver, this);

    if (buttonOptions.disabled) this.setEnabled(false);
  }

  setLabel(label: string): this {
    this.labelText.setText(this.buttonOptions.icon ? `${this.buttonOptions.icon}  ${label}` : label);
    return this;
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.labelText.setAlpha(enabled ? 1 : 0.45);
    this.background.setAlpha(enabled ? this.variantStyle.alpha : 0.5);
    if (enabled) {
      this.hitArea.setInteractive({ useHandCursor: true });
    } else {
      this.hitArea.disableInteractive();
    }
    this.drawBackground(false);
    return this;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Press feedback uses a small scale nudge; the root owns the real device scale. */
  private setPressed(pressed: boolean): void {
    this.container.setScale(pressed ? 0.97 : 1);
  }

  private handleDown(): void {
    if (!this.enabled) return;
    this.drawBackground(true);
    this.setPressed(true);
  }

  private handleUp(): void {
    if (!this.enabled) return;
    this.setPressed(false);
    this.drawBackground(false);
    this.buttonOptions.onClick();
  }

  private handleOut(): void {
    this.setPressed(false);
    this.drawBackground(false);
  }

  private handleOver(): void {
    if (!this.enabled) return;
    this.drawBackground(true);
  }

  private drawBackground(pressed: boolean): void {
    const width = this.buttonWidth;
    const height = this.buttonHeight;
    this.background.clear();
    this.background.fillStyle(this.variantStyle.fill, pressed ? 1 : this.variantStyle.alpha);
    this.background.fillRoundedRect(-width / 2, -height / 2, width, height, RADIUS.md);
    this.background.lineStyle(2, this.variantStyle.stroke, pressed ? 1 : 0.7);
    this.background.strokeRoundedRect(-width / 2, -height / 2, width, height, RADIUS.md);
  }

  override destroy(): void {
    this.hitArea.removeAllListeners();
    super.destroy();
  }
}

/** Convenience sizing for full-width rows inside a panel (design units). */
export function fullWidthButtonWidth(panelContentWidth: number): number {
  return Math.max(MIN_TOUCH_TARGET, panelContentWidth - SPACING.sm);
}
