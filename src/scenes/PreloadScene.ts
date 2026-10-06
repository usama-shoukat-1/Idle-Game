/**
 * PreloadScene.
 *
 * Loads the asset manifest (empty in Phase 0 - the manifest is the hook future art
 * plugs into) and shows a lightweight, viewport-relative progress bar. Asset groups
 * are supported so later stages can lazy-load their own art without changing this
 * flow.
 */

import Phaser from 'phaser';
import { SCENE_KEYS } from '@/core/constants';
import { ASSET_MANIFEST } from '@/config/content';
import { COLORS, HEX } from '@/ui/UiTheme';
import { createLabel } from '@/ui/components/Label';
import type { Viewport } from '@/ui/layout/Viewport';
import { getGameContext, attachViewport, logSceneTransition } from './sceneContext';

export class PreloadScene extends Phaser.Scene {
  private viewport!: Viewport;
  private progressBar!: Phaser.GameObjects.Graphics;
  private statusLabel!: Phaser.GameObjects.Text;
  private titleLabel!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: SCENE_KEYS.preload });
  }

  preload(): void {
    const context = getGameContext(this);
    const { viewport, dispose } = attachViewport(this);
    this.viewport = viewport;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, dispose);

    logSceneTransition(SCENE_KEYS.boot, SCENE_KEYS.preload, context);
    this.buildLoadingUi();
    this.registerManifest();

    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => this.drawProgress(value));
    this.load.on(Phaser.Loader.Events.COMPLETE, () => this.drawProgress(1));
  }

  create(): void {
    this.statusLabel.setText(ASSET_MANIFEST.length === 0 ? 'no assets to load (placeholder build)' : 'ready');
    // One frame of breathing room so the player never sees a hard cut.
    this.time.delayedCall(120, () => this.scene.start(SCENE_KEYS.loading, { from: SCENE_KEYS.preload }));
  }

  /** Register every manifest entry with Phaser's loader (grouped for lazy loading). */
  private registerManifest(): void {
    for (const asset of ASSET_MANIFEST) {
      switch (asset.type) {
        case 'image':
          this.load.image(asset.key, asset.url);
          break;
        case 'spritesheet':
          this.load.spritesheet(asset.key, asset.url, { frameWidth: 64, frameHeight: 64 });
          break;
        case 'atlas':
          this.load.atlas(asset.key, asset.url, `${asset.url}.json`);
          break;
        case 'audio':
          this.load.audio(asset.key, asset.url);
          break;
        case 'json':
          this.load.json(asset.key, asset.url);
          break;
      }
    }
  }

  private buildLoadingUi(): void {
    const viewport = this.viewport;

    this.titleLabel = createLabel(this, viewport, 'RESTORE IT!', {
      size: 'title',
      bold: true,
      color: HEX.accent,
      align: 'center',
      origin: { x: 0.5, y: 0 },
    });
    this.titleLabel.setPosition(viewport.width / 2, viewport.bounds.safeTop + viewport.bounds.usableHeight * 0.3);

    this.statusLabel = createLabel(this, viewport, 'loading…', {
      size: 'sm',
      color: HEX.textDim,
      align: 'center',
      origin: { x: 0.5, y: 0 },
    });
    this.statusLabel.setPosition(viewport.width / 2, this.titleLabel.y + this.titleLabel.height + viewport.font('sm'));

    this.progressBar = this.add.graphics();
    this.drawProgress(0);

    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.layout());
  }

  private layout(): void {
    const viewport = this.viewport;
    this.titleLabel?.setFontSize(viewport.font('title')).setPosition(viewport.width / 2, viewport.bounds.safeTop + viewport.bounds.usableHeight * 0.3);
    this.statusLabel?.setFontSize(viewport.font('sm')).setPosition(viewport.width / 2, this.titleLabel.y + this.titleLabel.height + viewport.font('sm'));
    this.drawProgress(0);
  }

  private drawProgress(value: number): void {
    if (!this.progressBar) return;
    const viewport = this.viewport;
    const width = Math.round(viewport.width * 0.6);
    const height = Math.max(6, Math.round(viewport.height * 0.008));
    const x = Math.round((viewport.width - width) / 2);
    const y = Math.round(viewport.height * 0.58);

    this.progressBar.clear();
    this.progressBar.fillStyle(COLORS.border, 1);
    this.progressBar.fillRoundedRect(x, y, width, height, height / 2);
    this.progressBar.fillStyle(COLORS.accent, 1);
    this.progressBar.fillRoundedRect(x, y, Math.max(height, width * Math.min(1, Math.max(0, value))), height, height / 2);
  }
}
