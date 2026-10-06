import Phaser from 'phaser';

import { logger } from '@/core/Logger';
import { PALETTE, SPACING } from '@/core/constants/Layout';
import { REGISTRY_KEYS, SCENE_KEYS } from '@/core/constants/GameConstants';
import { getGameContext } from '@/core/GameContext';
import type { OfflineSummary } from '@/systems/OfflineIncomeSystem/OfflineIncomeSystem';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';

/**
 * LOADING SCENE
 * =============
 * The one place where "the game just opened" work happens, in a deliberate order:
 *
 *   1. rehydrate persisted upgrade jobs (and complete any that finished while away),
 *   2. settle offline progression (timestamp math + guard rails live in the system),
 *   3. refresh content-driven unlocks,
 *   4. show a short, bounded loading state, then continue to the main menu.
 *
 * The scene is intentionally separable from PreloadScene: loading order and post-load
 * reconciliation are different concerns, and keeping them apart means no gameplay logic
 * ever ends up inside an asset loader.
 */
export class LoadingScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private spinner!: Phaser.GameObjects.Arc;
  private minimumDisplayElapsed = 0;
  private readonly minimumDisplayMs = 450;
  private finished = false;

  constructor() {
    super(SCENE_KEYS.loading);
  }

  create(): void {
    const context = getGameContext(this);
    this.cameras.main.setBackgroundColor(PALETTE.background);

    const frame = context.layout.metrics.frame;
    this.spinner = this.add
      .circle(frame.x + frame.width / 2, frame.y + frame.height * 0.48, context.layout.metrics.scale * 26, PALETTE.accent)
      .setAlpha(0.9);
    this.statusText = makeText(this, 'Restoring the district…', {
      size: 'small',
      color: UI_THEME.css.textMuted,
      align: 'center',
    });
    this.statusText.setOrigin(0.5, 0.5);
    this.statusText.setPosition(frame.x + frame.width / 2, frame.y + frame.height * 0.48 + context.layout.metrics.scale * SPACING.xxl);

    // 1. Resume persisted work. Jobs that completed while the game was closed are applied
    //    here, which is why an upgrade can be finished the moment the player returns.
    const rehydrated = context.systems.upgrades.rehydrate();
    if (rehydrated.completedOffline > 0) {
      logger.info('scene', `${rehydrated.completedOffline} upgrade(s) completed while away`);
    }

    // 2. Offline progression. Phase 0 records the elapsed time and (because efficiency is
    //    0) awards nothing; the summary is kept so the UI can show it once tuned.
    const summary = context.systems.offline.settle();
    this.registry.set(REGISTRY_KEYS.offlineSummary, summary);
    this.registry.set(REGISTRY_KEYS.gameReady, true);

    // 3. Progression/unlock refresh so the menu reflects the latest save.
    context.systems.progression.refreshUnlocks('loading');

    this.statusText.setText(this.describe(summary));
  }

  override update(_time: number, delta: number): void {
    if (this.finished) return;

    // Rotation-safe: keep the spinner centred from the live metrics.
    const context = getGameContext(this);
    const frame = context.layout.metrics.frame;
    const centerX = frame.x + frame.width / 2;
    const centerY = frame.y + frame.height * 0.48;
    this.spinner.setPosition(centerX, centerY);
    this.spinner.setRotation(this.spinner.rotation + delta / 400);

    this.minimumDisplayElapsed += delta;
    if (this.minimumDisplayElapsed < this.minimumDisplayMs) return;

    this.finished = true;
    this.scene.start(SCENE_KEYS.mainMenu);
  }

  private describe(summary: OfflineSummary): string {
    if (summary.skipped) {
      return 'Restoring the district…';
    }
    const minutes = Math.round(summary.effectiveElapsedMs / 60_000);
    if (summary.coins > 0) {
      return `You were away ${minutes}m — ${summary.coins} coins earned`;
    }
    return `You were away ${minutes}m`;
  }
}
