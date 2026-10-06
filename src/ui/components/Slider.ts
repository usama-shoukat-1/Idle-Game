import Phaser from 'phaser';

import { MIN_TOUCH_TARGET, RADIUS } from '@/core/constants/Layout';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import { Widget, type WidgetOptions } from './Widget';

/**
 * Pointer-friendly slider used for volume and any future 0..1 tuning control.
 *
 * Implementation notes:
 * - Drag handling is local to the slider (Phaser input on a UI object). *World* gestures
 *   go through InputSystem instead - UI controls are allowed to own their own pointers.
 * - A tap anywhere on the track jumps to that value, which is far easier with a thumb
 *   than grabbing a small handle.
 * - The container lives inside the scaled UI root, so pointer pixels are converted to
 *   design units through the container's world transform - never with a magic factor.
 */
export interface SliderOptions extends WidgetOptions {
  readonly width?: number;
  readonly initial?: number;
  readonly label?: string;
  readonly onChange: (value: number) => void;
}

export class Slider extends Widget {
  private readonly trackWidth: number;
  private readonly trackHeight = 14;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly hitArea: Phaser.GameObjects.Rectangle;
  private readonly valueLabel: Phaser.GameObjects.Text | null;
  private value = 0;

  constructor(scene: Phaser.Scene, private readonly sliderOptions: SliderOptions) {
    super(scene, sliderOptions);
    this.trackWidth = sliderOptions.width ?? 320;

    this.graphics = this.addToWidget(scene.add.graphics());

    this.hitArea = this.addToWidget(
      scene.add
        .rectangle(0, 0, this.trackWidth, Math.max(MIN_TOUCH_TARGET, this.trackHeight * 3), 0x000000, 0)
        .setOrigin(0.5, 0.5),
    );
    this.hitArea.setInteractive({ useHandCursor: true });

    this.hitArea.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.setValue(this.pointerRatio(pointer.x));
    });
    this.hitArea.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      this.setValue(this.pointerRatio(pointer.x));
    });

    this.valueLabel = sliderOptions.label
      ? makeText(scene, sliderOptions.label, { size: 'small', color: UI_THEME.css.textMuted, align: 'center' })
      : null;
    if (this.valueLabel) {
      this.valueLabel.setOrigin(0.5, 1);
      this.container.add(this.valueLabel);
    }

    this.value = clamp01(sliderOptions.initial ?? 0);
    this.redraw();
  }

  get currentValue(): number {
    return this.value;
  }

  /** @param silent when true, `onChange` is not invoked (used for programmatic sync). */
  setValue(value: number, silent = false): this {
    const next = clamp01(value);
    const changed = Math.abs(next - this.value) > 0.002;
    this.value = next;
    this.redraw();
    if (!silent && changed) this.sliderOptions.onChange(this.value);
    return this;
  }

  protected override layout(): void {
    if (!this.valueLabel) return;
    this.valueLabel.setPosition(0, -this.trackHeight - 16);
    this.valueLabel.setText(
      `${this.sliderOptions.label ?? ''} ${Math.round(this.value * 100)}%`.trim(),
    );
  }

  /** Converts a pointer x (device pixels) into a 0..1 ratio along the track. */
  private pointerRatio(pointerX: number): number {
    const matrix = this.container.getWorldTransformMatrix();
    const scale = matrix.scaleX || 1;
    const localDesignUnits = (pointerX - matrix.tx) / scale;
    return clamp01((localDesignUnits + this.trackWidth / 2) / this.trackWidth);
  }

  private redraw(): void {
    const width = this.trackWidth;
    const height = this.trackHeight;
    const radius = Math.min(RADIUS.sm, height / 2);
    this.graphics.clear();

    this.graphics.fillStyle(UI_THEME.colors.surfaceAlt, 1);
    this.graphics.fillRoundedRect(-width / 2, -height / 2, width, height, radius);

    const filled = Math.max(radius * 2, width * this.value);
    this.graphics.fillStyle(UI_THEME.colors.accent, 1);
    this.graphics.fillRoundedRect(-width / 2, -height / 2, filled, height, radius);

    const thumbX = -width / 2 + width * this.value;
    this.graphics.fillStyle(UI_THEME.colors.text, 1);
    this.graphics.fillCircle(thumbX, 0, height * 1.05);
  }

  override destroy(): void {
    this.hitArea.removeAllListeners();
    super.destroy();
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
