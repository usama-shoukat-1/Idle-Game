import Phaser from 'phaser';

import { MIN_TOUCH_TARGET, SPACING } from '@/core/constants/Layout';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import { formatCompactNumber } from '@/core/events/EventBus';
import { formatDuration } from '@/core/utils/TimeUtils';
import { AD_PLACEMENTS } from '@/core/ServiceContainer';
import type { BuildingDefinition } from '@/core/types/content';
import type { UpgradeDefinition } from '@/core/types/content';
import { Button } from '@/ui/components/Button';
import { ProgressBar } from '@/ui/components/ProgressBar';
import { Widget } from '@/ui/components/Widget';
import { setTextIfChanged } from '@/ui/utils/TextUtils';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import type { LayoutHandle } from '@/ui/layout/LayoutService';

/**
 * RESTORE PANEL (the primary action surface)
 * =========================================
 * Everything the player needs to advance the building, in one bottom sheet:
 *
 *   Old Café · Tier 3 / 10 · 40 coins / min        <- current business state
 *   Clear the debris → cost, duration, +coins      <- what the next step gives
 *   [ RESTORE FOR 200 ]                            <- or a live progress + actions
 *   [ ⏱ 8s left ] [ 💎 FINISH · 1 ] [ AD → SPEED UP ]
 *
 * It is *presentational*: every action is a callback, every number comes from the
 * systems, and no currency is mutated here. That is what keeps the "UI never touches the
 * economy" rule intact while still giving the player a rich panel.
 */
export interface RestorePanelCallbacks {
  readonly onRestore: () => void;
  /** Gem finish for the running upgrade. */
  readonly onGemFinish: () => void;
  /** Opt-in rewarded ad that cuts the running timer. */
  readonly onSpeedUpAd: () => void;
  /** Opt-in rewarded ad for bonus coins. */
  readonly onBonusCoinsAd: () => void;
  /** Opt-in rewarded ad that doubles income for a while. */
  readonly onIncomeBoostAd: () => void;
}

export interface RestorePanelState {
  readonly building: BuildingDefinition;
  readonly tier: number;
  readonly maxTier: number;
  readonly incomePerMinute: number;
  readonly nextUpgrade: UpgradeDefinition | null;
  readonly nextIncomePerMinute: number;
  /** Populated only while an upgrade is running. */
  readonly activeJob: {
    readonly displayName: string;
    readonly remainingMs: number;
    readonly progress: number;
  } | null;
  readonly gemCost: number | null;
  readonly coins: number;
  readonly speedUpAd: { readonly label: string; readonly seconds: number; readonly enabled: boolean } | null;
  readonly bonusCoinsAd: { readonly label: string; readonly coins: number; readonly enabled: boolean } | null;
  readonly incomeBoostAd: { readonly label: string; readonly enabled: boolean } | null;
}

export class RestorePanel extends Widget {
  private readonly callbacks: RestorePanelCallbacks;

  private readonly card: Phaser.GameObjects.Graphics;
  private readonly buildingName: Phaser.GameObjects.Text;
  private readonly tierLabel: Phaser.GameObjects.Text;
  private readonly incomeLabel: Phaser.GameObjects.Text;
  private readonly stepLabel: Phaser.GameObjects.Text;
  private readonly detailLabel: Phaser.GameObjects.Text;
  private readonly progress: ProgressBar;
  private readonly timerLabel: Phaser.GameObjects.Text;
  private readonly restoreButton: Button;
  private readonly gemButton: Button;
  private readonly speedUpAdButton: Button;
  private readonly bonusCoinsAdButton: Button;
  private readonly boostAdButton: Button;
  private readonly hintLabel: Phaser.GameObjects.Text;

  private readonly panelWidth = 660;
  private readonly panelHeight = 330;

  constructor(
    scene: Phaser.Scene,
    options: {
      readonly callbacks: RestorePanelCallbacks;
    },
  ) {
    super(scene, {
      anchorX: 'center',
      anchorY: 'bottom',
      offsetY: SPACING.md,
      respectSafeArea: true,
      depth: UI_DEPTH.panels + 20,
      size: { width: 660, height: 330 },
    });
    this.callbacks = options.callbacks;

    this.card = this.addToWidget(scene.add.graphics());
    this.buildingName = this.text('Old Café', { size: 'title', bold: true });
    this.tierLabel = this.text('Tier 0 / 10', { size: 'small', color: UI_THEME.css.accent, bold: true });
    this.incomeLabel = this.text('0 coins / min', { size: 'small', color: UI_THEME.css.textMuted });
    this.stepLabel = this.text('', { size: 'small', bold: true });
    this.detailLabel = this.text('', { size: 'micro', color: UI_THEME.css.textMuted });

    this.progress = new ProgressBar(scene, { width: 600, height: 16 });
    this.container.add(this.progress.container);
    this.timerLabel = this.text('', { size: 'micro', color: UI_THEME.css.accent, bold: true });

    this.restoreButton = new Button(scene, {
      label: 'RESTORE',
      variant: 'primary',
      width: 600,
      height: 96,
      onClick: () => this.callbacks.onRestore(),
    });
    this.gemButton = new Button(scene, {
      label: 'FINISH',
      icon: '💎',
      variant: 'secondary',
      width: 194,
      height: MIN_TOUCH_TARGET,
      onClick: () => this.callbacks.onGemFinish(),
    });
    this.speedUpAdButton = new Button(scene, {
      label: 'SPEED UP',
      icon: '▶',
      variant: 'secondary',
      width: 194,
      height: MIN_TOUCH_TARGET,
      onClick: () => this.callbacks.onSpeedUpAd(),
    });
    this.bonusCoinsAdButton = new Button(scene, {
      label: 'BONUS COINS',
      icon: '▶',
      variant: 'secondary',
      width: 194,
      height: MIN_TOUCH_TARGET,
      onClick: () => this.callbacks.onBonusCoinsAd(),
    });
    this.boostAdButton = new Button(scene, {
      label: '2× INCOME',
      icon: '▶',
      variant: 'secondary',
      width: 194,
      height: MIN_TOUCH_TARGET,
      onClick: () => this.callbacks.onIncomeBoostAd(),
    });

    for (const button of [
      this.restoreButton,
      this.gemButton,
      this.speedUpAdButton,
      this.bonusCoinsAdButton,
      this.boostAdButton,
    ]) {
      this.container.add(button.container);
    }

    this.hintLabel = this.text('', { size: 'micro', color: UI_THEME.css.textMuted, align: 'center' });
    this.hintLabel.setOrigin(0.5, 0.5);
  }

  /** Refreshes every label from a snapshot (called ~4x/sec by the scene). */
  applyState(state: RestorePanelState): void {
    setTextIfChanged(this.buildingName, state.building.displayName);
    setTextIfChanged(this.tierLabel, `Tier ${state.tier} / ${state.maxTier}`);
    setTextIfChanged(
      this.incomeLabel,
      state.incomePerMinute > 0
        ? `${formatCompactNumber(state.incomePerMinute)} coins / min`
        : 'No income yet',
    );

    if (state.activeJob) {
      const job = state.activeJob;
      setTextIfChanged(this.stepLabel, job.displayName);
      setTextIfChanged(this.detailLabel, 'Work in progress — you can close the game and come back.');
      this.progress.setVisible(true);
      this.progress.setProgress(job.progress);
      setTextIfChanged(this.timerLabel, `${formatDuration(job.remainingMs)} remaining`);
      this.restoreButton.setVisible(false);
      this.gemButton.setVisible(true);
      this.gemButton.setLabel(
        state.gemCost !== null ? `FINISH · ${state.gemCost}` : 'FINISH',
      );
      this.gemButton.setEnabled(state.gemCost !== null && state.coins >= 0);
      this.speedUpAdButton.setVisible(Boolean(state.speedUpAd));
      if (state.speedUpAd) {
        this.speedUpAdButton.setLabel(`+${Math.max(1, Math.round(state.speedUpAd.seconds / 60) || 1)}m · AD`);
        this.speedUpAdButton.setEnabled(state.speedUpAd.enabled);
      }
    } else if (state.nextUpgrade) {
      const upgrade = state.nextUpgrade;
      const gain = state.nextIncomePerMinute - state.incomePerMinute;
      setTextIfChanged(this.stepLabel, `Next: ${upgrade.displayName}`);
      setTextIfChanged(
        this.detailLabel,
        [
          `${formatCompactNumber(upgrade.cost.amount)} coins`,
          upgrade.durationMs > 0 ? formatDuration(upgrade.durationMs) : 'instant',
          gain > 0 ? `+${formatCompactNumber(gain)} coins/min` : 'no income yet',
        ].join('  ·  '),
      );
      this.progress.setVisible(false);
      setTextIfChanged(this.timerLabel, '');
      this.restoreButton.setVisible(true);
      this.restoreButton.setLabel(`RESTORE FOR ${formatCompactNumber(upgrade.cost.amount)}`);
      this.restoreButton.setEnabled(state.coins >= upgrade.cost.amount);
      this.gemButton.setVisible(false);
      this.speedUpAdButton.setVisible(false);
    } else {
      setTextIfChanged(this.stepLabel, 'Fully restored');
      setTextIfChanged(this.detailLabel, 'The Old Café is back in business.');
      this.progress.setVisible(false);
      this.timerLabel.setText('');
      this.restoreButton.setVisible(false);
      this.gemButton.setVisible(false);
      this.speedUpAdButton.setVisible(false);
    }

    // Ad affordances: bonus coins while saving up, income boost always (when off cooldown).
    this.bonusCoinsAdButton.setVisible(Boolean(state.bonusCoinsAd));
    if (state.bonusCoinsAd) {
      this.bonusCoinsAdButton.setLabel(`+${formatCompactNumber(state.bonusCoinsAd.coins)} · AD`);
      this.bonusCoinsAdButton.setEnabled(state.bonusCoinsAd.enabled);
    }
    this.boostAdButton.setVisible(Boolean(state.incomeBoostAd));
    if (state.incomeBoostAd) {
      this.boostAdButton.setEnabled(state.incomeBoostAd.enabled);
    }

    setTextIfChanged(
      this.hintLabel,
      state.activeJob
        ? 'Ads are always optional — they only run when you tap.'
        : 'Upgrades keep running while the game is closed.',
    );
  }

  setHint(text: string): void {
    setTextIfChanged(this.hintLabel, text);
  }

  protected override layout(handle: LayoutHandle): void {
    const width = Math.min(this.panelWidth, handle.metrics.frameUnits.width - SPACING.md * 2);
    const left = -width / 2;
    const top = -this.panelHeight;

    this.card.clear();
    this.card.fillStyle(UI_THEME.colors.surface, 0.96);
    this.card.fillRoundedRect(left, top, width, this.panelHeight, UI_THEME.radius.lg);
    this.card.lineStyle(2, UI_THEME.colors.outline, 1);
    this.card.strokeRoundedRect(left, top, width, this.panelHeight, UI_THEME.radius.lg);

    // Header row: name + tier on one line, income on the next.
    this.buildingName.setPosition(left + SPACING.lg, top + SPACING.md);
    this.tierLabel.setPosition(left + width - SPACING.lg, top + SPACING.md + 8);
    this.tierLabel.setOrigin(1, 0);
    this.incomeLabel.setPosition(left + width - SPACING.lg, top + SPACING.md + 52);
    this.incomeLabel.setOrigin(1, 0);

    const bodyTop = top + 104;
    this.stepLabel.setPosition(left + SPACING.lg, bodyTop);
    this.detailLabel.setPosition(left + SPACING.lg, bodyTop + 34);
    this.detailLabel.setWordWrapWidth(width - SPACING.lg * 2);

    // Action area is always at the bottom of the card, so the panel height never jumps.
    const actionsTop = -this.panelHeight + this.panelHeight - 78;
    this.restoreButton.container.setPosition(0, actionsTop);
    this.restoreButton.applyChildLayout(handle);

    this.progress.container.setPosition(0, bodyTop + 92);
    this.progress.applyChildLayout(handle);
    this.timerLabel.setPosition(left + SPACING.lg, bodyTop + 108);

    const rowY = actionsTop;
    this.gemButton.container.setPosition(-208, rowY);
    this.gemButton.applyChildLayout(handle);
    this.speedUpAdButton.container.setPosition(0, rowY);
    this.speedUpAdButton.applyChildLayout(handle);
    this.bonusCoinsAdButton.container.setPosition(208, rowY);
    this.bonusCoinsAdButton.applyChildLayout(handle);
    this.boostAdButton.container.setPosition(0, rowY + 104);
    this.boostAdButton.applyChildLayout(handle);

    this.hintLabel.setPosition(0, top - SPACING.md);
  }

  private text(
    value: string,
    style: Parameters<typeof makeText>[2],
  ): Phaser.GameObjects.Text {
    const object = makeText(this.scene, value, style);
    this.container.add(object);
    return object;
  }

  override destroy(): void {
    this.restoreButton.destroy();
    this.gemButton.destroy();
    this.speedUpAdButton.destroy();
    this.bonusCoinsAdButton.destroy();
    this.boostAdButton.destroy();
    this.progress.destroy();
    super.destroy();
  }
}

/** Placement ids live in one place (shared with the scene that requests the ads). */
export const RESTORE_AD_PLACEMENTS = AD_PLACEMENTS;
