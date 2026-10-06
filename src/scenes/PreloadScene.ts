import Phaser from 'phaser';

import { logger } from '@/core/Logger';
import { FONT_SIZE, PALETTE, RADIUS, SPACING } from '@/core/constants/Layout';
import { SCENE_KEYS } from '@/core/constants/GameConstants';
import { getGameContext } from '@/core/GameContext';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import { setTextIfChanged } from '@/ui/utils/TextUtils';

/**
 * PRELOAD SCENE
 * =============
 * Asset loading, with a progress readout.
 *
 * Phase 0 has no art or audio files, so this scene does something more useful than
 * nothing: it *generates* the placeholder textures at runtime with Phaser's graphics API.
 * That proves the texture pipeline works on the real renderer, keeps the repository free
 * of binary assets and demonstrates texture reuse (one 32x32 tile is shared by the whole
 * placeholder world instead of drawing thousands of individual shapes).
 *
 * Loading is event driven (`Phaser.Loader.Events.PROGRESS`), never polled.
 */
export class PreloadScene extends Phaser.Scene {
  private progressBar!: Phaser.GameObjects.Graphics;
  private progressText!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private handle!: LayoutHandle;

  constructor() {
    super(SCENE_KEYS.preload);
  }

  preload(): void {
    const context = getGameContext(this);
    this.handle = context.layout.handle;

    this.drawBackdrop();

    // No network assets in Phase 0. Placeholder textures are generated instead, which
    // also means a cold start works offline - a real constraint for mobile builds.
    this.generatePlaceholderTextures();

    // The loader block below stays as the single place real assets are declared later:
    //   this.load.image('building/cafe/facade_1', 'assets/images/cafe_facade_1.png');
    //   this.load.audio('sfx/upgrade_complete', 'assets/audio/upgrade_complete.ogg');
    // Progress/complete callbacks drive the same UI, so adding assets needs no new code.

    const unsubscribe = context.layout.onChange((handle) => {
      this.handle = handle;
      this.layoutUi();
    });
    // Layout listeners must be released with the scene, otherwise a scene restart re-registers
    // a callback that closes over destroyed display objects.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  }

  create(): void {
    this.layoutUi();
    logger.info('scene', 'preload complete');
    this.scene.start(SCENE_KEYS.loading);
  }

  // --- placeholder content -------------------------------------------------

  /**
   * Generates textures used by the placeholder world. Keeping them tiny and reusable is
   * deliberate: mobile GPUs are fill-rate bound, and one shared tile beats many sprites.
   */
  private generatePlaceholderTextures(): void {
    if (this.textures.exists(PLACEHOLDER_TEXTURES.tile)) return;

    const size = 64;
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(PALETTE.surfaceAlt, 1);
    graphics.fillRect(0, 0, size, size);
    graphics.lineStyle(2, PALETTE.outline, 0.5);
    graphics.strokeRect(0, 0, size, size);
    graphics.generateTexture(PLACEHOLDER_TEXTURES.tile, size, size);
    graphics.destroy();
  }

  private drawBackdrop(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(PALETTE.background);

    this.progressBar = this.add.graphics();
    this.progressText = makeText(this, 'Preparing…', { size: 'small', color: UI_THEME.css.textMuted, align: 'center' });
    this.progressText.setOrigin(0.5, 0.5);
    this.titleText = makeText(this, 'RESTORE IT!', { size: 'display', bold: true, color: UI_THEME.css.accent, align: 'center' });
    this.titleText.setOrigin(0.5, 0.5);

    // Progress events drive the bar; no polling.
    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      setTextIfChanged(this.progressText, `Preparing… ${Math.round(value * 100)}%`);
      this.drawProgress(value);
    });
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      setTextIfChanged(this.progressText, 'Ready');
      this.drawProgress(1);
    });

    void width;
    void height;
    this.layoutUi();
  }

  private layoutUi(): void {
    const handle = this.handle;
    if (!handle || !this.progressBar) return;

    const frame = handle.metrics.frame;
    const barWidth = Math.min(frame.width * 0.7, handle.px(560));
    const barHeight = handle.px(18);
    const centerX = frame.x + frame.width / 2;
    const centerY = frame.y + frame.height * 0.62;

    this.titleText.setPosition(centerX, frame.y + frame.height * 0.45);
    this.titleText.setFontSize(handle.px(FONT_SIZE.display));
    this.progressText.setPosition(centerX, centerY + handle.px(SPACING.xxxl));
    this.progressText.setFontSize(handle.px(FONT_SIZE.small));

    this.progressBar.clear();
    this.progressBar.fillStyle(PALETTE.surfaceAlt, 1);
    this.progressBar.fillRoundedRect(
      centerX - barWidth / 2,
      centerY - barHeight / 2,
      barWidth,
      barHeight,
      handle.px(RADIUS.sm),
    );
    this.progressBar.setData('geometry', { centerX, centerY, barWidth, barHeight });
    this.drawProgress(0);
  }

  private drawProgress(value: number): void {
    const geometry = this.progressBar?.getData('geometry') as
      | { centerX: number; centerY: number; barWidth: number; barHeight: number }
      | undefined;
    if (!geometry) return;

    const radius = this.handle.px(RADIUS.sm);
    this.progressBar.clear();
    this.progressBar.fillStyle(PALETTE.surfaceAlt, 1);
    this.progressBar.fillRoundedRect(
      geometry.centerX - geometry.barWidth / 2,
      geometry.centerY - geometry.barHeight / 2,
      geometry.barWidth,
      geometry.barHeight,
      radius,
    );
    const filled = Math.max(radius * 2, geometry.barWidth * Math.min(1, Math.max(0, value)));
    this.progressBar.fillStyle(PALETTE.accent, 1);
    this.progressBar.fillRoundedRect(
      geometry.centerX - geometry.barWidth / 2,
      geometry.centerY - geometry.barHeight / 2,
      filled,
      geometry.barHeight,
      radius,
    );
  }
}

/** Texture keys generated at runtime (kept here so scenes share one naming scheme). */
export const PLACEHOLDER_TEXTURES = {
  tile: 'placeholder/tile',
} as const;
