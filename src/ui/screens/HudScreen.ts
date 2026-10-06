import Phaser from 'phaser';

import { SPACING } from '@/core/constants/Layout';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import { formatCompactNumber } from '@/core/events/EventBus';
import { formatDuration } from '@/core/utils/TimeUtils';
import type { BuildingId } from '@/core/types/primitives';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import type { UiServices } from '@/ui/UiServices';
import { Screen } from '@/ui/components/Screen';
import { TopBar } from '@/ui/components/TopBar';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';

/**
 * IN-GAME HUD
 * ===========
 * Persistent overlay for the game scene: currency, income rate, offline status and the
 * pause/menu affordance. It is intentionally thin - it reads state and emits intents
 * (via callbacks) and contains no gameplay logic.
 *
 * `setIncomePerSecond` / `setSelectedBuilding` are called by the scene when something
 * changes; the HUD never polls systems in a frame loop except for its one live timer line.
 */
export interface HudScreenOptions {
  readonly services: UiServices;
  readonly onMenuPress: () => void;
  readonly onSelectBuilding?: (buildingId: BuildingId) => void;
}

export class HudScreen extends Screen {
  private readonly services: UiServices;
  private readonly topBar: TopBar;
  private readonly incomeText: Phaser.GameObjects.Text;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly hintText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, options: HudScreenOptions) {
    super(scene, { depth: UI_DEPTH.panels + 10 });
    this.services = options.services;

    this.topBar = new TopBar(scene, {
      events: options.services.events,
      onMenuPress: options.onMenuPress,
      menuIcon: '☰',
    });
    this.container.add(this.topBar.container);

    this.incomeText = makeText(scene, '', { size: 'tiny', color: UI_THEME.css.accent, align: 'center' });
    this.incomeText.setOrigin(0.5, 0);
    this.statusText = makeText(scene, '', { size: 'micro', color: UI_THEME.css.textMuted, align: 'center' });
    this.statusText.setOrigin(0.5, 0);
    this.hintText = makeText(scene, 'Tap anywhere to test input', {
      size: 'micro',
      color: UI_THEME.css.textMuted,
      align: 'center',
    });
    this.hintText.setOrigin(0.5, 1);

    this.container.add([this.incomeText, this.statusText, this.hintText]);

    this.topBar.coins.setValue(options.services.systems.economy.getCoins());
    this.topBar.gems.setValue(options.services.systems.economy.getGems());
  }

  protected override layout(handle: LayoutHandle): void {
    this.topBar.applyLayout(handle);
    // The top bar is placed by its own anchors; the labels follow beneath it.
    this.topBar.container.setPosition(this.centerX(), this.topBarContainerY());
    this.incomeText.setPosition(this.centerX(), this.top(SPACING.xxxl + SPACING.xxl + SPACING.xs));
    this.statusText.setPosition(this.centerX(), this.top(SPACING.xxxl + SPACING.xxl + SPACING.xxl));
    this.hintText.setPosition(this.centerX(), this.bottom(SPACING.xxl));
  }

  private topBarContainerY(): number {
    return this.top(SPACING.md + 31);
  }

  setIncomePerSecond(coinsPerSecond: number): void {
    this.incomeText.setText(
      coinsPerSecond > 0
        ? `${formatCompactNumber(coinsPerSecond * 60)} coins / min`
        : 'No income yet — Phase 0 ships no buildings',
    );
  }

  setStatus(text: string): void {
    this.statusText.setText(text);
  }

  setHint(text: string): void {
    this.hintText.setText(text);
  }

  /** Shows the running upgrade timer for the current selection, if any. */
  override update(): void {
    const systems = this.services.systems;
    const job = systems.upgrades.getPrimaryActiveJob();
    if (!job) {
      this.setStatus(`Save autosaves · ${formatCompactNumber(systems.economy.getCoins())} coins in wallet`);
      return;
    }
    this.setStatus(`${formatDuration(systems.upgrades.getRemainingMs(job.upgradeId))} until upgrade completes`);
  }

  override destroy(): void {
    this.topBar.destroy();
    super.destroy();
  }
}
