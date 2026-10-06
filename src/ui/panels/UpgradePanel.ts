import Phaser from 'phaser';

import { SPACING } from '@/core/constants/Layout';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import { formatCompactNumber } from '@/core/events/EventBus';
import { formatClock } from '@/core/utils/TimeUtils';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import type { UiServices } from '@/ui/UiServices';
import { Button } from '@/ui/components/Button';
import { Panel } from '@/ui/components/Panel';
import { ProgressBar } from '@/ui/components/ProgressBar';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';

/**
 * UPGRADE PANEL
 * =============
 * Lists the upgrades of the selected building with their live state, and exposes the
 * opt-in actions that cost gems (instant finish) or watch an ad (time skip).
 *
 * Everything it shows comes from `UpgradeSystem` / content - the panel never computes a
 * cost or a timer itself, so there is no second source of truth for progression.
 */
export interface UpgradePanelOptions {
  readonly services: UiServices;
  readonly onAccelerate?: (upgradeId: string) => void;
  readonly onWatchAd?: (upgradeId: string) => void;
}

interface RowView {
  readonly root: Phaser.GameObjects.Container;
  readonly name: Phaser.GameObjects.Text;
  readonly detail: Phaser.GameObjects.Text;
  readonly bar: ProgressBar;
  readonly accelerate: Button;
  readonly watchAd: Button | null;
}

export class UpgradePanel {
  readonly panel: Panel;
  private readonly services: UiServices;
  private readonly rows: RowView[] = [];
  private readonly emptyText: Phaser.GameObjects.Text;
  private currentBuildingId: string | null = null;

  constructor(scene: Phaser.Scene, private readonly options: UpgradePanelOptions) {
    this.services = options.services;

    this.panel = new Panel(scene, {
      width: 660,
      height: 360,
      anchorX: 'center',
      anchorY: 'middle',
      depth: UI_DEPTH.panels,
      title: 'Restoration steps',
    });

    this.emptyText = makeText(scene, 'No upgrades available yet.\nPhase 0 intentionally ships none.', {
      size: 'tiny',
      align: 'center',
      color: UI_THEME.css.textMuted,
      wordWrapWidth: 520,
    });
    this.emptyText.setOrigin(0.5, 0.5);
    this.panel.container.add(this.emptyText);
  }

  get container(): Phaser.GameObjects.Container {
    return this.panel.container;
  }

  /** Rebuilds the rows for a building (called on selection change, not per frame). */
  setBuilding(buildingId: string | null): void {
    this.currentBuildingId = buildingId;
    for (const row of this.rows) row.root.destroy();
    this.rows.length = 0;

    if (!buildingId) {
      this.emptyText.setVisible(true);
      return;
    }

    const definition = this.services.systems.content.tryGetBuilding(buildingId as never);
    const upgrades = definition ? this.services.systems.content.getBuildingUpgrades(definition.id) : [];

    if (upgrades.length === 0) {
      this.emptyText.setVisible(true);
      return;
    }

    this.emptyText.setVisible(false);
    for (const upgrade of upgrades) {
      const root = this.scene.add.container(0, 0);
      const name = makeText(this.scene, upgrade.displayName, { size: 'small', bold: true });
      name.setOrigin(0, 0.5);
      const detail = makeText(this.scene, '', { size: 'micro', color: UI_THEME.css.textMuted });
      detail.setOrigin(0, 0.5);
      const bar = new ProgressBar(this.scene, { width: 560, height: 12 });

      const accelerate = new Button(this.scene, {
        label: 'Gems',
        variant: 'secondary',
        width: 150,
        height: 88,
        onClick: () => this.options.onAccelerate?.(upgrade.id),
      });

      const watchAd = this.options.onWatchAd
        ? new Button(this.scene, {
            label: 'Watch ad',
            variant: 'ghost',
            width: 190,
            height: 88,
            onClick: () => this.options.onWatchAd?.(upgrade.id),
          })
        : null;

      root.add([name, detail, bar.container, accelerate.container]);
      if (watchAd) root.add(watchAd.container);
      this.panel.container.add(root);
      this.rows.push({ root, name, detail, bar, accelerate, watchAd });
    }
  }

  applyLayout(handle: LayoutHandle): void {
    this.panel.applyLayout(handle);
    this.emptyText.setPosition(0, 0);

    const rowHeight = 130;
    const top = this.panel.contentTop + SPACING.sm + rowHeight / 2;
    this.rows.forEach((row, index) => {
      const y = top + index * rowHeight;
      row.root.setPosition(0, y);
      row.name.setPosition(-this.panel.contentWidth / 2, -34);
      row.detail.setPosition(-this.panel.contentWidth / 2, -8);
      row.bar.container.setPosition(0, 22);
      row.bar.applyChildLayout(handle);
      row.accelerate.container.setPosition(this.panel.contentWidth / 2 - 90, 60);
      row.accelerate.applyChildLayout(handle);
      row.watchAd?.container.setPosition(this.panel.contentWidth / 2 - 300, 60);
      row.watchAd?.applyChildLayout(handle);
    });
  }

  /** Refreshes live values for the visible rows only. */
  update(): void {
    if (!this.currentBuildingId || this.rows.length === 0) return;
    const upgrades = this.services.systems.content.getBuildingUpgrades(this.currentBuildingId as never);

    this.rows.forEach((row, index) => {
      const definition = upgrades[index];
      if (!definition) return;

      const status = this.services.systems.upgrades.getStatus(definition.id);
      const remaining = this.services.systems.upgrades.getRemainingMs(definition.id);

      switch (status) {
        case 'completed':
          row.detail.setText('Completed');
          row.bar.setProgress(1);
          row.accelerate.setEnabled(false);
          row.watchAd?.setEnabled(false);
          break;
        case 'running':
          row.detail.setText(`${formatClock(remaining)} remaining`);
          row.bar.setProgress(this.services.systems.upgrades.getProgress(definition.id));
          row.accelerate.setEnabled(true);
          row.watchAd?.setEnabled(true);
          break;
        case 'available':
          row.detail.setText(`${formatCompactNumber(definition.cost.amount)} ${definition.cost.currency}`);
          row.bar.setProgress(0);
          row.accelerate.setEnabled(false);
          row.watchAd?.setEnabled(false);
          break;
        default:
          row.detail.setText('Locked');
          row.bar.setProgress(0);
          row.accelerate.setEnabled(false);
          row.watchAd?.setEnabled(false);
          break;
      }
    });
  }

  destroy(): void {
    for (const row of this.rows) {
      row.bar.destroy();
      row.accelerate.destroy();
      row.watchAd?.destroy();
      row.root.destroy();
    }
    this.rows.length = 0;
    this.panel.destroy();
  }

  private get scene(): Phaser.Scene {
    return this.panel.container.scene;
  }
}
