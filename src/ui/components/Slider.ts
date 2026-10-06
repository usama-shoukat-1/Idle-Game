/**
 * Volume slider (settings screen).
 *
 * Dragging is handled by the slider itself so the settings UI stays declarative;
 * world gestures (pan/swipe) go through the InputManager layer instead.
 */

import Phaser from 'phaser';
import { COLORS } from '../UiTheme';
import { ProgressBar } from './ProgressBar';
import { createLabel } from './Label';
import type { Rect } from '../layout/Layout';
import type { Viewport } from '../layout/Viewport';
import { clamp01 } from '@/core/utils/numbers';

export interface SliderOptions {
  rect: Rect;
  viewport: Viewport;
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** Called once when a drag finishes (use for persisting, not every frame). */
  onChangeEnd?: (value: number) => void;
}

export class Slider extends Phaser.GameObjects.Container {
  private readonly bar: ProgressBar;
  private readonly title: Phaser.GameObjects.Text;
  private readonly valueLabel: Phaser.GameObjects.Text;
  private readonly track: Phaser.GameObjects.Rectangle;
  private readonly knob: Phaser.GameObjects.Arc;
  private value: number;
  private readonly onChange: (value: number) => void;
  private readonly onChangeEnd?: (value: number) => void;
  private trackRect: Rect;

  constructor(scene: Phaser.Scene, options: SliderOptions) {
    super(scene, options.rect.x, options.rect.y);
    this.value = clamp01(options.value);
    this.onChange = options.onChange;
    this.onChangeEnd = options.onChangeEnd;

    this.trackRect = {
      x: 0,
      y: options.rect.height - Math.round(options.rect.height * 0.22),
      width: options.rect.width,
      height: Math.max(10, Math.round(options.rect.height * 0.22)),
    };

    this.title = createLabel(scene, options.viewport, options.label, { size: 'sm', color: '#9aa7b4' });
    this.valueLabel = createLabel(scene, options.viewport, `${Math.round(this.value * 100)}%`, {
      size: 'sm',
      origin: { x: 1, y: 0 },
    });

    this.track = scene.add
      .rectangle(this.trackRect.x, this.trackRect.y, this.trackRect.width, this.trackRect.height, 0x000000, 0.4)
      .setOrigin(0, 0)
      .setInteractive({ draggable: false });

    this.bar = new ProgressBar(scene, this.trackRect, COLORS.accent);
    this.knob = scene.add.circle(0, this.trackRect.y + this.trackRect.height / 2, this.trackRect.height * 0.85, COLORS.accent);

    this.title.setPosition(0, 0);
    this.valueLabel.setPosition(options.rect.width, 0);

    this.add([this.track, this.bar, this.knob, this.title, this.valueLabel]);
    this.setSize(options.rect.width, options.rect.height);
    this.setInteractive(new Phaser.Geom.Rectangle(0, 0, options.rect.width, options.rect.height), Phaser.Geom.Rectangle.Contains);

    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.handlePointer(pointer, true);
    });
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown) this.handlePointer(pointer, false);
    });
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.onChangeEnd?.(this.value));

    this.apply();
    scene.add.existing(this);
  }

  get current(): number {
    return this.value;
  }

  setValue(value: number, notify = false): void {
    this.value = clamp01(value);
    this.apply();
    if (notify) this.onChange(this.value);
  }

  private handlePointer(pointer: Phaser.Input.Pointer, isPress: boolean): void {
    const parentX = this.parentContainer?.x ?? 0;
    const localX = pointer.x - this.x - parentX;
    const normalized = clamp01(localX / Math.max(1, this.trackRect.width));
    this.value = normalized;
    this.apply();
    this.onChange(this.value);
    if (isPress) this.scene.tweens.add({ targets: this.knob, scale: { from: 1.15, to: 1 }, duration: 120 });
  }

  private apply(): void {
    this.bar.setProgress(this.value);
    this.knob.setPosition(this.trackRect.x + this.trackRect.width * this.value, this.trackRect.y + this.trackRect.height / 2);
    this.valueLabel.setText(`${Math.round(this.value * 100)}%`);
  }
}
