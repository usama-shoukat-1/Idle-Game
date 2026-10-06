/**
 * Procedural placeholder art.
 *
 * Phase 0 ships ZERO binary assets on purpose: real illustrated art (the long-term
 * visual target) comes after the foundation. These helpers generate simple, clean
 * textures at boot so the engine, scenes and UI can be verified visually - and so
 * nothing has to be redrawn when real art arrives.
 */

import Phaser from 'phaser';
import { PLACEHOLDER_PALETTE } from '@/config/content';

export const TEXTURE_KEYS = {
  tile: 'placeholder-tile',
  panel: 'placeholder-panel',
  button: 'placeholder-button',
  coin: 'placeholder-coin',
  gem: 'placeholder-gem',
  buildingBlocked: 'placeholder-building-blocked',
  buildingRestored: 'placeholder-building-restored',
  glow: 'placeholder-glow',
  pixel: 'placeholder-pixel',
} as const;

export interface PlaceholderArtOptions {
  /** Pixels-per-point of the generated textures (crispness on high-DPI screens). */
  resolution?: number;
}

/**
 * Generate every placeholder texture. Idempotent: textures are only created once,
 * so scene restarts do not leak GPU memory.
 */
export function generatePlaceholderTextures(scene: Phaser.Scene, options: PlaceholderArtOptions = {}): void {
  const resolution = options.resolution ?? 2;
  const textures = scene.textures;

  const ensure = (key: string, draw: (graphics: Phaser.GameObjects.Graphics) => void, width: number, height: number): void => {
    if (textures.exists(key)) return;
    const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
    graphics.setScale(1);
    draw(graphics);
    graphics.generateTexture(key, width * resolution, height * resolution);
    graphics.destroy();
  };

  // 1x1 white pixel - the workhorse for bars/rects (cheap texture reuse).
  ensure(
    TEXTURE_KEYS.pixel,
    (g) => {
      g.fillStyle(0xffffff, 1).fillRect(0, 0, 1, 1);
    },
    1,
    1,
  );

  // Rounded panel (used by every UI surface).
  ensure(
    TEXTURE_KEYS.panel,
    (g) => {
      g.fillStyle(0x161b22, 0.96).fillRoundedRect(0, 0, 48 * resolution, 48 * resolution, 10 * resolution);
      g.lineStyle(2 * resolution, 0x2b3444, 1).strokeRoundedRect(0, 0, 48 * resolution, 48 * resolution, 10 * resolution);
    },
    48,
    48,
  );

  // Button plate.
  ensure(
    TEXTURE_KEYS.button,
    (g) => {
      g.fillStyle(PLACEHOLDER_PALETTE.accent, 1).fillRoundedRect(0, 0, 32 * resolution, 32 * resolution, 12 * resolution);
    },
    32,
    32,
  );

  // Coin / gem chips for the currency bar.
  ensure(
    TEXTURE_KEYS.coin,
    (g) => {
      g.fillStyle(PLACEHOLDER_PALETTE.coin, 1).fillCircle(16 * resolution, 16 * resolution, 14 * resolution);
      g.lineStyle(2 * resolution, 0x8a6a12, 1).strokeCircle(16 * resolution, 16 * resolution, 14 * resolution);
    },
    32,
    32,
  );

  ensure(
    TEXTURE_KEYS.gem,
    (g) => {
      g.fillStyle(PLACEHOLDER_PALETTE.gem, 1).fillTriangle(
        16 * resolution,
        2 * resolution,
        30 * resolution,
        18 * resolution,
        2 * resolution,
        18 * resolution,
      );
      g.fillTriangle(16 * resolution, 30 * resolution, 30 * resolution, 18 * resolution, 2 * resolution, 18 * resolution);
    },
    32,
    32,
  );

  // Building placeholders: a "derelict" and a "restored" silhouette.
  ensure(
    TEXTURE_KEYS.buildingBlocked,
    (g) => {
      const size = 64 * resolution;
      g.fillStyle(PLACEHOLDER_PALETTE.facade, 1).fillRect(0, size * 0.25, size, size * 0.75);
      g.fillStyle(0x232b36, 1).fillRect(size * 0.15, size * 0.4, size * 0.2, size * 0.2);
      g.fillStyle(0x232b36, 1).fillRect(size * 0.65, size * 0.4, size * 0.2, size * 0.2);
      g.fillStyle(0x232b36, 1).fillRect(size * 0.4, size * 0.7, size * 0.2, size * 0.3);
      g.lineStyle(2 * resolution, 0x10151c, 1).strokeRect(0, size * 0.25, size, size * 0.75);
    },
    64,
    64,
  );

  ensure(
    TEXTURE_KEYS.buildingRestored,
    (g) => {
      const size = 64 * resolution;
      g.fillStyle(PLACEHOLDER_PALETTE.facadeRestored, 1).fillRect(0, size * 0.25, size, size * 0.75);
      g.fillStyle(PLACEHOLDER_PALETTE.coin, 0.9).fillRect(size * 0.15, size * 0.4, size * 0.2, size * 0.2);
      g.fillStyle(PLACEHOLDER_PALETTE.coin, 0.9).fillRect(size * 0.65, size * 0.4, size * 0.2, size * 0.2);
      g.fillStyle(0x2a2f38, 1).fillRect(size * 0.4, size * 0.7, size * 0.2, size * 0.3);
      g.lineStyle(2 * resolution, 0x2c5445, 1).strokeRect(0, size * 0.25, size, size * 0.75);
    },
    64,
    64,
  );

  // Soft glow for highlights/pulses.
  ensure(
    TEXTURE_KEYS.glow,
    (g) => {
      g.fillStyle(0xffffff, 0.16).fillCircle(32 * resolution, 32 * resolution, 30 * resolution);
      g.fillStyle(0xffffff, 0.12).fillCircle(32 * resolution, 32 * resolution, 22 * resolution);
      g.fillStyle(0xffffff, 0.1).fillCircle(32 * resolution, 32 * resolution, 12 * resolution);
    },
    64,
    64,
  );
}

/** Ground tile placeholder for the (currently empty) world scene. */
export function drawGroundTile(scene: Phaser.Scene, key = TEXTURE_KEYS.tile, size = 64): void {
  if (scene.textures.exists(key)) return;
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  graphics.fillStyle(PLACEHOLDER_PALETTE.asphalt, 1).fillRect(0, 0, size, size);
  graphics.lineStyle(1, 0x2a3240, 1).strokeRect(0.5, 0.5, size - 1, size - 1);
  graphics.generateTexture(key, size, size);
  graphics.destroy();
}
