/**
 * Upgrade panel.
 *
 * Renders `UpgradeAvailability` rows for the selected building and starts upgrades
 * through the UpgradeSystem. It contains no upgrade knowledge of its own: labels,
 * costs and locks all come from content + system evaluation.
 */

import Phaser from 'phaser';
import type { GameContext } from '@/core/GameContext';
import type { BuildingId } from '@/core/types/ids';
import type { UpgradeAvailability } from '@/systems/UpgradeSystem';
import type { Subscription } from '@/systems/EventSystem';
import type { Viewport } from '../layout/Viewport';
import { COLORS, HEX } from '../UiTheme';
import { Panel } from '../components/Panel';
import { TextButton } from '../components/TextButton';
import { ProgressBar } from '../components/ProgressBar';
import { createLabel } from '../components/Label';
import { contentRect, rowRects } from '../layout/Layout';
import { formatDuration } from '@/core/utils/time';
import { formatNumber } from '@/core/utils/numbers';

const MAX_ROWS = 3;

interface Row {
  container: Phaser.GameObjects.Container;
  title: Phaser.GameObjects.Text;
  detail: Phaser.GameObjects.Text;
  button: TextButton;
  bar: ProgressBar;
}

export class UpgradePanel extends Phaser.GameObjects.Container {
  private readonly rows: Row[] = [];
  private readonly emptyLabel: Phaser.GameObjects.Text;
  private readonly subscriptions: Subscription[] = [];
  private currentBuildingId: BuildingId | null = null;
  private lastAvailability: UpgradeAvailability[] = [];

  constructor(
    scene: Phaser.Scene,
    private readonly context: GameContext,
    viewport: Viewport,
  ) {
    super(scene, 0, 0);

    this.emptyLabel = createLabel(scene, viewport, '', {
      size: 'sm',
      color: HEX.textDim,
      wrapWidth: viewport.width * 0.8,
    });

    this.add(this.emptyLabel);
    this.layout(viewport);
    this.setDepth(1_600).setScrollFactor(0);
    scene.add.existing(this);

    this.subscriptions.push(
      this.context.events.on('upgrade:completed', () => this.refresh()),
      this.context.events.on('upgrade:started', () => this.refresh()),
      this.context.events.on('upgrade:cancelled', () => this.refresh()),
      this.context.events.on('upgrade:rejected', () => this.refresh()),
      this.context.events.on('building:unlocked', () => this.refresh()),
      this.context.events.on('economy:changed', () => this.refresh()),
      this.context.events.on('timer:completed', ({ timer }) => {
        if (timer.kind === 'upgrade') this.refresh();
      }),
    );
  }

  show(buildingId: BuildingId | null): void {
    this.currentBuildingId = buildingId;
    this.refresh();
  }

  layout(viewport: Viewport): void {
    const rect = contentRect(viewport, Math.round(viewport.bounds.usableHeight * 0.44));
    this.setPosition(rect.x, rect.y);
    this.emptyLabel.setPosition(Math.round(rect.width * 0.04), Math.round(rect.height * 0.2));
    this.emptyLabel.setWordWrapWidth(rect.width * 0.92, true);

    const rows = rowRects(
      { x: Math.round(rect.width * 0.02), y: Math.round(viewport.font('md')), width: Math.round(rect.width * 0.96), height: Math.round(rect.height * 0.62) },
      MAX_ROWS,
      Math.round(viewport.font('sm') * 0.6),
    );

    rows.forEach((rowRect, index) => {
      this.ensureRow(index, rowRect, viewport);
    });
  }

  /** Called from the scene update loop to keep timers/costs live. */
  tick(): void {
    this.refreshRunningTimers();
  }

  private ensureRow(index: number, rowRect: { x: number; y: number; width: number; height: number }, viewport: Viewport): void {
    let row = this.rows[index];
    if (!row) {
      const container = this.scene.add.container(rowRect.x, rowRect.y);
      const background = new Panel(this.scene, { x: 0, y: 0, width: rowRect.width, height: rowRect.height }, {
        fill: COLORS.panelAlt,
        fillAlpha: 0.9,
      });
      const title = createLabel(this.scene, viewport, '', { size: 'md', bold: true });
      const detail = createLabel(this.scene, viewport, '', { size: 'xs', color: HEX.textDim });
      const bar = new ProgressBar(
        this.scene,
        { x: 0, y: 0, width: rowRect.width * 0.5, height: 6 },
        COLORS.success,
      );
      const button = new TextButton(this.scene, {
        rect: { x: 0, y: 0, width: rowRect.width * 0.3, height: Math.max(viewport.touchTarget * 0.7, rowRect.height * 0.4) },
        label: 'Upgrade',
        viewport,
        tone: 'primary',
        fontSize: 'sm',
        onClick: () => this.activate(index),
      });

      container.add([background, title, detail, bar, button]);
      this.add(container);
      row = { container, title, detail, button, bar };
      this.rows[index] = row;
    }

    row.container.setPosition(rowRect.x, rowRect.y);
    row.container.setSize(rowRect.width, rowRect.height);

    const pad = Math.round(rowRect.width * 0.03);
    row.title.setPosition(pad, pad);
    row.detail.setPosition(pad, pad + row.title.height + viewport.font('xs') * 0.5);
    row.bar.setRect({
      x: pad,
      y: rowRect.height - pad - 6,
      width: rowRect.width * 0.55,
      height: 6,
    });
    row.button.setRect({
      x: rowRect.width - pad - rowRect.width * 0.3,
      y: Math.round(rowRect.height / 2 - Math.max(viewport.touchTarget * 0.7, rowRect.height * 0.4) / 2),
      width: rowRect.width * 0.3,
      height: Math.max(viewport.touchTarget * 0.7, rowRect.height * 0.4),
    });
  }

  private activate(index: number): void {
    const availability = this.lastAvailability[index];
    if (!availability || !availability.definition) return;

    if (availability.code === 'already-active') {
      const skip = this.context.upgrades.skipWithGems(availability.upgradeId);
      this.context.events.emit('ui:toast', {
        message: skip.ok ? `Accelerated for ${skip.gemsSpent} gems` : skip.message,
        tone: skip.ok ? 'success' : 'warning',
      });
      this.refresh();
      return;
    }

    const result = this.context.upgrades.start(availability.upgradeId);
    if (!result.ok) {
      this.context.events.emit('ui:toast', { message: result.availability.message, tone: 'warning' });
    } else if (result.completedInstantly) {
      this.context.events.emit('ui:toast', { message: `${availability.definition.displayName} completed`, tone: 'success' });
    }
    this.refresh();
  }

  private refresh(): void {
    const buildingId = this.currentBuildingId;
    const availability = buildingId ? this.context.upgrades.listForBuilding(buildingId) : [];
    this.lastAvailability = availability.filter((entry) => entry.code !== 'already-completed');

    const hasRows = this.lastAvailability.length > 0;
    this.emptyLabel.setText(
      hasRows
        ? ''
        : buildingId
          ? 'No upgrades defined for this building yet (upgrades are content in src/data/upgrades).'
          : this.context.content.listBuildings().length === 0
            ? 'Upgrade rows appear here once the first building and its upgrades exist as content.'
            : 'Tap a building to see its upgrades.',
    );

    this.rows.forEach((row, index) => {
      const entry = this.lastAvailability[index];
      if (!entry) {
        row.container.setVisible(false);
        return;
      }
      row.container.setVisible(true);
      const definition = entry.definition;
      row.title.setText(definition?.displayName ?? entry.upgradeId);
      row.detail.setText(describe(entry));
      row.button.setLabel(entry.code === 'already-active' ? 'Speed up' : 'Upgrade');
      row.button.setEnabled(entry.ok || (entry.code === 'already-active' && entry.skipCostGems > 0));
      row.bar.setProgress(entry.durationMs > 0 ? 1 - entry.remainingMs / entry.durationMs : 1);
      row.bar.setVisible(entry.code === 'already-active');
    });

    this.refreshRunningTimers();
  }

  private refreshRunningTimers(): void {
    this.lastAvailability.forEach((entry, index) => {
      const row = this.rows[index];
      if (!row || !row.container.visible) return;
      if (entry.code !== 'already-active') return;
      const remaining = this.context.upgrades.getRemainingMs(entry.upgradeId);
      const progress = this.context.upgrades.getProgress(entry.upgradeId);
      entry.remainingMs = remaining;
      entry.skipCostGems = entry.definition
        ? this.context.upgrades.computeSkipCost(entry.definition, remaining)
        : 0;
      row.detail.setText(describe(entry));
      row.bar.setProgress(progress?.normalized ?? 0);
      row.button.setEnabled(remaining > 0);
    });
  }

  override destroy(fromScene?: boolean): void {
    for (const subscription of this.subscriptions) subscription.off();
    this.subscriptions.length = 0;
    super.destroy(fromScene);
  }
}

function describe(entry: UpgradeAvailability): string {
  const cost = entry.cost;
  const parts: string[] = [];
  if (cost.coins) parts.push(`${formatNumber(cost.coins)} coins`);
  if (cost.gems) parts.push(`${formatNumber(cost.gems)} gems`);
  if (parts.length === 0) parts.push('free');

  if (entry.code === 'already-active') {
    return `${parts.join(' + ')} • ${formatDuration(entry.remainingMs)} left${entry.skipCostGems > 0 ? ` • ${entry.skipCostGems} gems to skip` : ''}`;
  }
  if (!entry.ok) return `${parts.join(' + ')} • ${entry.message}`;

  return entry.durationMs > 0
    ? `${parts.join(' + ')} • takes ${formatDuration(entry.durationMs)}`
    : `${parts.join(' + ')} • instant`;
}
