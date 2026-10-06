import Phaser from 'phaser';

import type { BuildingDefinition } from '@/core/types/content';
import { COLORS_CSS, FONT_FAMILY, FONT_SIZE, RADIUS } from '@/core/constants/Layout';

/**
 * Placeholder view for one building.
 *
 * Deliberately dumb: it renders a `BuildingDefinition` + the tier it is told about, and
 * knows nothing about economy, save data or other buildings. When real illustrated art
 * arrives, only this class is replaced - the systems that drive it stay identical.
 *
 * Phase 0 art direction: a flat tinted block with a tier badge and a name label, enough
 * to prove tier changes and income pulses are observable.
 */
export interface BuildingEntityOptions {
  readonly scene: Phaser.Scene;
  readonly definition: BuildingDefinition;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth?: number;
}

export class BuildingEntity {
  readonly definition: BuildingDefinition;
  readonly container: Phaser.GameObjects.Container;

  private readonly body: Phaser.GameObjects.Rectangle;
  private readonly badge: Phaser.GameObjects.Text;
  private readonly label: Phaser.GameObjects.Text;
  private tier = 0;
  private pulseTween: Phaser.Tweens.Tween | null = null;

  constructor(options: BuildingEntityOptions) {
    this.definition = options.definition;

    const tint = Phaser.Display.Color.HexStringToColor(
      options.definition.placeholder?.tint ?? '#5b6b7c',
    ).color;

    this.body = options.scene.add.rectangle(0, 0, options.width, options.height, tint).setOrigin(0.5);
    this.body.setStrokeStyle(3, 0x000000, 0.25);

    this.badge = options.scene.add
      .text(0, 0, '0', {
        fontFamily: FONT_FAMILY,
        fontSize: `${FONT_SIZE.small}px`,
        color: COLORS_CSS.text,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.label = options.scene.add
      .text(0, options.height / 2 + 18, options.definition.displayName, {
        fontFamily: FONT_FAMILY,
        fontSize: `${FONT_SIZE.tiny}px`,
        color: COLORS_CSS.textMuted,
      })
      .setOrigin(0.5, 0);

    this.container = options.scene.add.container(options.x, options.y, [this.body, this.badge, this.label]);
    this.container.setDepth(options.depth ?? 0);
    this.container.setSize(options.width, options.height);
    this.container.setInteractive({ useHandCursor: true });
  }

  get tierIndex(): number {
    return this.tier;
  }

  /** Applies the visual state for a tier (badge + tint). */
  setTier(tier: number, visualState?: string): void {
    this.tier = tier;

    // Placeholder "restoration" read: warmer, brighter fill as the building improves.
    const progress = Math.min(1, tier / 4);
    const base = Phaser.Display.Color.HexStringToColor(
      visualState ? tintForState(visualState) : (this.definition.placeholder?.tint ?? '#5b6b7c'),
    );
    const restored = Phaser.Display.Color.Interpolate.ColorWithColor(
      base,
      Phaser.Display.Color.HexStringToColor('#7fd8b0'),
      1,
      progress,
    );
    this.body.setFillStyle(
      Phaser.Display.Color.GetColor(restored.r, restored.g, restored.b),
    );
    this.badge.setText(String(tier));

    if (this.label.text !== this.definition.displayName) {
      this.label.setText(this.definition.displayName);
    }
  }

  /** Short scale pop when income is collected - the only "juice" in Phase 0. */
  pulse(): void {
    this.pulseTween?.stop();
    this.pulseTween = this.container.scene.tweens.add({
      targets: this.container,
      scale: { from: 1, to: 1.04 },
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  /** Resting scale, used by layout changes. */
  layout(x: number, y: number, width: number, height: number): void {
    this.container.setPosition(x, y);
    this.body.setSize(width, height);
    this.label.setPosition(0, height / 2 + 18);
  }

  destroy(): void {
    this.pulseTween?.stop();
    this.pulseTween = null;
    this.container.removeAll(true);
    this.container.destroy();
  }
}

/** Deterministic placeholder tinting per visual-state key (art comes later). */
export function tintForState(visualState: string): string {
  const palette = ['#4a4f57', '#5f6a63', '#71836f', '#7fa07c', '#7fd8b0'];
  let hash = 0;
  for (let i = 0; i < visualState.length; i += 1) {
    hash = (hash * 31 + visualState.charCodeAt(i)) % 997;
  }
  return palette[hash % palette.length] ?? '#5b6b7c';
}

/** Corner radius used by placeholder frames (kept here so entities stay self-contained). */
export const BUILDING_PLACEHOLDER_RADIUS = RADIUS.md;
