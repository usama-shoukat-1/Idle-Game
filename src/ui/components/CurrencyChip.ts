import Phaser from 'phaser';

import type { EventBus } from '@/core/events/EventBus';
import { RADIUS, SPACING } from '@/core/constants/Layout';
import { formatCompactNumber } from '@/core/events/EventBus';
import { Widget, type WidgetOptions } from './Widget';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';

/**
 * Currency readout for the top bar.
 *
 * It is event driven: it subscribes to `economy:*` and animates the displayed number
 * towards the real one, so gameplay systems never call into UI and the UI never polls
 * game state in an update loop. The tween is delta-based (no per-frame allocation).
 */
export type CurrencyKind = 'coins' | 'gems';

export interface CurrencyChipOptions extends WidgetOptions {
  readonly kind: CurrencyKind;
  readonly events: EventBus;
  readonly width?: number;
  readonly height?: number;
  /**
   * Optional tap handler. Used by the gem counter to open the shop, which is why the chip
   * owns its own hit area instead of requiring a separate "+" button next to it.
   */
  readonly onPress?: () => void;
}

export class CurrencyChip extends Widget {
  private readonly kind: CurrencyKind;
  private readonly chipWidth: number;
  private readonly chipHeight: number;
  private readonly background: Phaser.GameObjects.Graphics;
  private readonly valueText: Phaser.GameObjects.Text;
  private readonly icon: Phaser.GameObjects.Arc;
  private displayedValue = 0;
  private targetValue = 0;
  private readonly unsubscribes: Array<() => void> = [];

  constructor(scene: Phaser.Scene, options: CurrencyChipOptions) {
    const chipWidth = options.width ?? 190;
    const chipHeight = options.height ?? 62;
    super(scene, {
      ...options,
      anchorY: options.anchorY ?? 'middle',
      size: { width: chipWidth, height: chipHeight },
    });
    this.kind = options.kind;
    this.chipWidth = chipWidth;
    this.chipHeight = chipHeight;

    this.background = this.addToWidget(scene.add.graphics());
    this.background.fillStyle(UI_THEME.colors.surfaceAlt, 0.95);
    this.background.fillRoundedRect(-this.chipWidth / 2, -this.chipHeight / 2, this.chipWidth, this.chipHeight, RADIUS.pill);
    this.background.lineStyle(2, UI_THEME.colors.outline, 1);
    this.background.strokeRoundedRect(-this.chipWidth / 2, -this.chipHeight / 2, this.chipWidth, this.chipHeight, RADIUS.pill);

    const iconColour = this.kind === 'coins' ? UI_THEME.colors.coin : UI_THEME.colors.gem;
    this.icon = this.addToWidget(
      scene.add.circle(-this.chipWidth / 2 + this.chipHeight / 2, 0, this.chipHeight * 0.28, iconColour),
    );

    this.valueText = this.addToWidget(
      makeText(scene, '0', {
        size: 'small',
        bold: true,
        color: this.kind === 'coins' ? UI_THEME.css.accent : UI_THEME.css.gem,
      }),
    );
    this.valueText.setOrigin(0, 0.5);
    this.valueText.setPosition(-this.chipWidth / 2 + this.chipHeight + SPACING.xs, 0);

    const event = this.kind === 'coins' ? 'economy:coins-changed' : 'economy:gems-changed';
    this.unsubscribes.push(
      options.events.on(event, ({ balance }) => {
        this.targetValue = balance;
      }),
      options.events.on('ads:reward-granted', () => this.flash()),
      options.events.on('purchase:completed', () => this.flash()),
    );

    if (options.onPress) {
      // A transparent hit rectangle: reliable touch target independent of the drawn shape.
      const hitArea = this.addToWidget(
        scene.add.rectangle(0, 0, this.chipWidth, this.chipHeight, 0x000000, 0).setOrigin(0.5, 0.5),
      );
      hitArea.setInteractive({ useHandCursor: true });
      hitArea.on('pointerup', () => options.onPress?.());
    }

    scene.events.on('update', this.step, this);
    this.unsubscribes.push(() => scene.events.off('update', this.step, this));
  }

  /** Immediately adopts a value (used on mount, before any economy event arrives). */
  setValue(value: number, instant = true): this {
    this.targetValue = value;
    if (instant) {
      this.displayedValue = value;
      this.render();
    }
    return this;
  }

  private step(_time: number, deltaMs: number): void {
    if (this.displayedValue === this.targetValue) return;
    const difference = this.targetValue - this.displayedValue;
    // Exponential approach: fast at first, settles smoothly, frame-rate independent.
    const step = difference * Math.min(1, deltaMs / 140);
    this.displayedValue += Math.abs(step) < 1 ? difference : step;
    this.render();
  }

  private render(): void {
    this.valueText.setText(formatCompactNumber(Math.floor(this.displayedValue)));
  }

  private flash(): void {
    this.scene.tweens.add({
      targets: this.icon,
      scale: { from: 1.25, to: 1 },
      duration: 260,
      ease: 'Back.easeOut',
    });
  }

  override destroy(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    super.destroy();
  }
}
