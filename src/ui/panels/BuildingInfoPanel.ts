import Phaser from 'phaser';

import { SPACING } from '@/core/constants/Layout';
import { formatCompactNumber } from '@/core/events/EventBus';
import { formatDuration } from '@/core/utils/TimeUtils';
import type { BuildingId } from '@/core/types/primitives';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import type { UiServices } from '@/ui/UiServices';
import { Button } from '@/ui/components/Button';
import { Panel } from '@/ui/components/Panel';
import { ProgressBar } from '@/ui/components/ProgressBar';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';

/**
 * BUILDING INFORMATION PANEL
 * ==========================
 * Shows whatever building the player selected, driven purely by content + runtime state:
 * name, tier, income, lock reason, and the next tier's cost/duration.
 *
 * It contains no building-specific knowledge, so the first real building (and every later
 * one) works without a line of changes here. Because Phase 0 registers no buildings, the
 * panel renders its empty state - which is itself the proof that the generic path works.
 *
 * Live values (timer countdown, income ring) are read in `update()` from the systems that
 * own them; the panel never caches state that could go stale.
 */
export interface BuildingInfoPanelOptions {
  readonly services: UiServices;
  readonly onUpgrade?: (buildingId: BuildingId) => void;
  readonly onAccelerate?: (buildingId: BuildingId) => void;
}

export class BuildingInfoPanel {
  readonly panel: Panel;
  private readonly services: UiServices;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly subtitleText: Phaser.GameObjects.Text;
  private readonly incomeText: Phaser.GameObjects.Text;
  private readonly timerText: Phaser.GameObjects.Text;
  private readonly progressBar: ProgressBar;
  private readonly upgradeButton: Button;
  private readonly accelerateButton: Button | null;
  private currentBuildingId: BuildingId | null = null;

  constructor(scene: Phaser.Scene, private readonly options: BuildingInfoPanelOptions) {
    this.services = options.services;

    this.panel = new Panel(scene, {
      width: 660,
      height: 420,
      anchorX: 'center',
      anchorY: 'bottom',
      offsetY: SPACING.lg,
      respectSafeArea: true,
      depth: UI_DEPTH.panels,
      title: 'Building',
    });

    this.nameText = makeText(scene, '—', { size: 'title', bold: true, align: 'center' });
    this.nameText.setOrigin(0.5, 0);
    this.subtitleText = makeText(scene, 'Select a building', {
      size: 'tiny',
      color: UI_THEME.css.textMuted,
      align: 'center',
    });
    this.subtitleText.setOrigin(0.5, 0);
    this.incomeText = makeText(scene, '', { size: 'small', color: UI_THEME.css.accent, align: 'center' });
    this.incomeText.setOrigin(0.5, 0);
    this.timerText = makeText(scene, '', { size: 'tiny', color: UI_THEME.css.textMuted, align: 'center' });
    this.timerText.setOrigin(0.5, 0);

    this.progressBar = new ProgressBar(scene, { width: 540, height: 16 });

    this.upgradeButton = new Button(scene, {
      label: 'Restore',
      width: 280,
      height: 96,
      variant: 'primary',
      onClick: () => {
        if (this.currentBuildingId) this.options.onUpgrade?.(this.currentBuildingId);
      },
    });

    this.accelerateButton = options.onAccelerate
      ? new Button(scene, {
          label: 'Speed up',
          width: 200,
          height: 96,
          variant: 'secondary',
          onClick: () => {
            if (this.currentBuildingId) this.options.onAccelerate?.(this.currentBuildingId);
          },
        })
      : null;

    this.panel.container.add([
      this.nameText,
      this.subtitleText,
      this.incomeText,
      this.timerText,
      this.progressBar.container,
      this.upgradeButton.container,
    ]);
    if (this.accelerateButton) this.panel.container.add(this.accelerateButton.container);

    this.setBuilding(null);
  }

  get container(): Phaser.GameObjects.Container {
    return this.panel.container;
  }

  setBuilding(buildingId: BuildingId | null): void {
    this.currentBuildingId = buildingId;
    if (!buildingId) {
      this.nameText.setText('No building selected');
      this.subtitleText.setText('Phase 0 ships no buildings yet');
      this.incomeText.setText('');
      this.timerText.setText('');
      this.progressBar.setProgress(0);
      this.upgradeButton.setEnabled(false);
      this.accelerateButton?.setEnabled(false);
      return;
    }

    const definition = this.services.systems.content.tryGetBuilding(buildingId);
    if (!definition) return;

    this.nameText.setText(definition.displayName);
    this.accelerateButton?.setEnabled(false);
  }

  applyLayout(handle: LayoutHandle): void {
    this.panel.applyLayout(handle);
    const top = this.panel.contentTop + SPACING.sm;
    const centerX = 0;

    this.nameText.setPosition(centerX, top);
    this.subtitleText.setPosition(centerX, top + UI_THEME.fontSize.title + SPACING.xs);
    this.incomeText.setPosition(centerX, top + UI_THEME.fontSize.title + UI_THEME.fontSize.tiny + SPACING.md);
    this.progressBar.container.setPosition(centerX, top + 150);
    this.progressBar.applyChildLayout(handle);
    this.timerText.setPosition(centerX, top + 180);
    this.upgradeButton.container.setPosition(centerX, top + 250);
    this.upgradeButton.applyChildLayout(handle);
    this.accelerateButton?.container.setPosition(centerX + 240, this.upgradeButton.container.y);
    this.accelerateButton?.applyChildLayout(handle);
  }

  /** Called every frame by the owning screen: re-reads live values from the systems. */
  update(): void {
    if (!this.currentBuildingId) return;
    const systems = this.services.systems;
    const buildingId = this.currentBuildingId;
    const definition = systems.content.tryGetBuilding(buildingId);
    if (!definition) return;

    const unlocked = systems.buildings.isUnlocked(buildingId);
    const tier = systems.buildings.getTier(buildingId);
    const incomePerSecond = systems.buildings.getIncomePerSecond(buildingId);

    this.subtitleText.setText(
      unlocked ? `${definition.type} · tier ${tier}/${systems.content.getMaxTier(buildingId)}` : systems.buildings.getLockDescription(buildingId),
    );
    this.incomeText.setText(`${formatCompactNumber(incomePerSecond * 60)} coins / min`);

    const job = systems.upgrades.getActiveJobForBuilding(buildingId);
    if (job) {
      const remaining = systems.upgrades.getRemainingMs(job.upgradeId);
      this.progressBar.setProgress(systems.upgrades.getProgress(job.upgradeId));
      this.timerText.setText(`${formatDuration(remaining)} remaining`);
      this.upgradeButton.setEnabled(false);
      this.upgradeButton.setLabel('In progress');
    } else {
      const nextTier = tier + 1;
      const tierDefinition = systems.content.getTier(buildingId, nextTier);
      if (tierDefinition) {
        this.progressBar.setProgress(0);
        this.timerText.setText(
          tierDefinition.cost.amount > 0
            ? `${tierDefinition.cost.amount} ${tierDefinition.cost.currency} · ${formatDuration(tierDefinition.durationMs)}`
            : 'Free',
        );
        this.upgradeButton.setLabel(`Restore to tier ${nextTier}`);
        this.upgradeButton.setEnabled(unlocked);
      } else {
        this.timerText.setText('Fully restored');
        this.upgradeButton.setLabel('Max tier');
        this.upgradeButton.setEnabled(false);
      }
    }
  }

  destroy(): void {
    this.progressBar.destroy();
    this.upgradeButton.destroy();
    this.accelerateButton?.destroy();
    this.panel.destroy();
  }
}
