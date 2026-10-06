/**
 * Building information panel (placeholder styling).
 *
 * Deliberately content-agnostic: it renders whatever definition it is given and
 * refreshes from state/events. With no buildings registered yet it shows a clear
 * empty state pointing at the data folder, which also proves the panel is driven by
 * content rather than hard-coded to the (not yet existing) first building.
 */

import Phaser from 'phaser';
import type { BuildingDefinition } from '@/core/types/content';
import type { BuildingId } from '@/core/types/ids';
import type { GameContext } from '@/core/GameContext';
import { COLORS, HEX } from '../UiTheme';
import { Panel } from '../components/Panel';
import { ProgressBar } from '../components/ProgressBar';
import { createLabel } from '../components/Label';
import { bottomSheetRect } from '../layout/Layout';
import type { Subscription } from '@/systems/EventSystem';
import type { Viewport } from '../layout/Viewport';
import { formatDuration } from '@/core/utils/time';
import { formatMultiplier, formatNumber } from '@/core/utils/numbers';

export class BuildingInfoPanel extends Phaser.GameObjects.Container {
  private readonly panel: Panel;
  private readonly title: Phaser.GameObjects.Text;
  private readonly subtitle: Phaser.GameObjects.Text;
  private readonly stats: Phaser.GameObjects.Text;
  private readonly timerLabel: Phaser.GameObjects.Text;
  private readonly timerBar: ProgressBar;
  private readonly emptyState: Phaser.GameObjects.Text;
  private readonly subscriptions: Subscription[] = [];
  private currentBuildingId: BuildingId | null = null;
  private currentDefinition: BuildingDefinition | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly context: GameContext,
    viewport: Viewport,
  ) {
    const rect = bottomSheetRect(viewport);
    super(scene, rect.x, rect.y);

    this.panel = new Panel(scene, { x: 0, y: 0, width: rect.width, height: rect.height });
    this.title = createLabel(scene, viewport, '', { size: 'lg', bold: true });
    this.subtitle = createLabel(scene, viewport, '', { size: 'sm', color: HEX.textDim });
    this.stats = createLabel(scene, viewport, '', { size: 'sm', color: HEX.textDim });
    this.timerLabel = createLabel(scene, viewport, '', { size: 'sm', color: HEX.accent });
    this.timerBar = new ProgressBar(scene, { x: 0, y: 0, width: rect.width * 0.5, height: 8 }, COLORS.accent);
    this.emptyState = createLabel(scene, viewport, '', {
      size: 'sm',
      color: HEX.textDim,
      wrapWidth: rect.width * 0.84,
    });

    this.add([this.panel, this.title, this.subtitle, this.stats, this.timerLabel, this.timerBar, this.emptyState]);
    this.setDepth(1_500).setScrollFactor(0);
    scene.add.existing(this);

    this.layout(viewport);
    this.bindEvents();
    this.render();
  }

  /** Show a specific building (null = nothing selected yet). */
  show(buildingId: BuildingId | null): void {
    this.currentBuildingId = buildingId;
    this.currentDefinition = buildingId ? this.context.content.getBuilding(buildingId) : null;
    this.render();
  }

  get selectedBuildingId(): BuildingId | null {
    return this.currentBuildingId;
  }

  layout(viewport: Viewport): void {
    const rect = bottomSheetRect(viewport);
    this.setPosition(rect.x, rect.y);
    this.panel.setRect({ x: 0, y: 0, width: rect.width, height: rect.height });

    const pad = Math.round(rect.width * 0.05);
    this.title.setPosition(pad, pad);
    this.subtitle.setPosition(pad, pad + this.title.height + viewport.font('xs') * 0.4);
    this.stats.setPosition(pad, pad + (rect.height * 0.36));
    this.timerLabel.setPosition(pad, rect.height - pad - this.timerLabel.height * 2.2);
    this.timerBar.setRect({
      x: pad,
      y: rect.height - pad - this.timerBar.height / 2 - this.timerLabel.height * 0.2,
      width: rect.width - pad * 2,
      height: Math.max(6, Math.round(rect.height * 0.02)),
    });
    this.emptyState.setWordWrapWidth(rect.width - pad * 2, true);
    this.emptyState.setPosition(pad, rect.height * 0.3);
  }

  private bindEvents(): void {
    this.subscriptions.push(
      this.context.events.on('building:unlocked', ({ buildingId }) => {
        if (buildingId === this.currentBuildingId) this.render();
      }),
      this.context.events.on('building:tier-changed', ({ buildingId }) => {
        if (buildingId === this.currentBuildingId) this.render();
      }),
      this.context.events.on('upgrade:started', ({ buildingId }) => {
        if (buildingId === this.currentBuildingId) this.render();
      }),
      this.context.events.on('upgrade:completed', ({ buildingId }) => {
        if (buildingId === this.currentBuildingId) this.render();
      }),
      this.context.events.on('upgrade:cancelled', ({ buildingId }) => {
        if (buildingId === this.currentBuildingId) this.render();
      }),
      this.context.events.on('building:income-flushed', () => this.refreshStats()),
    );
  }

  /** Called from the scene update loop; only touches the timer rows. */
  tick(): void {
    if (!this.currentBuildingId) return;
    const active = this.context.upgrades.getActiveForBuilding(this.currentBuildingId);
    if (!active) {
      this.timerLabel.setText('');
      this.timerBar.setProgress(0);
      return;
    }
    const remaining = this.context.timers.getRemainingMs(active.timerId);
    const progress = this.context.timers.getProgress(active.timerId);
    this.timerLabel.setText(`Upgrading… ${formatDuration(remaining)} left`);
    this.timerBar.setProgress(progress?.normalized ?? 0);
  }

  private render(): void {
    const definition = this.currentDefinition;

    if (!definition) {
      this.title.setText('No building selected');
      this.subtitle.setText('');
      this.stats.setText('');
      this.timerLabel.setText('');
      this.timerBar.setProgress(0);
      const registered = this.context.content.listBuildings().length;
      this.emptyState.setText(
        registered === 0
          ? 'Building content is not in yet (Phase 1 adds the first building as data in src/data/buildings). The panel, upgrade list, timers and save state are already wired for it.'
          : 'Tap a building in the world to see its details.',
      );
      return;
    }

    // The entity pairs the definition with live state, so the panel never reaches
    // into the state tree itself.
    const entity = this.context.buildings.getEntity(definition.id);
    this.emptyState.setText('');
    if (!entity) {
      this.title.setText(definition.displayName);
      this.subtitle.setText('');
      this.stats.setText('');
      return;
    }

    this.title.setText(entity.displayName);
    this.subtitle.setText(
      `${definition.type} • tier ${entity.tier}/${entity.maxTier} • ${entity.isUnlocked ? (entity.isFullyRestored ? 'restored' : 'open') : 'locked'}`,
    );
    this.refreshStats();
  }

  private refreshStats(): void {
    const definition = this.currentDefinition;
    if (!definition) return;
    const entity = this.context.buildings.getEntity(definition.id);
    const breakdown = entity?.incomeBreakdown ?? null;
    if (!entity || !breakdown) {
      this.stats.setText('');
      return;
    }
    const district = this.context.state.state.districts[definition.districtId];
    const efficiency = breakdown.baseIncomePerSecond > 0
      ? breakdown.incomePerSecond / breakdown.baseIncomePerSecond
      : 1;
    this.stats.setText(
      [
        `income: ${formatNumber(entity.incomePerSecond)}/s  (base ${formatNumber(breakdown.baseIncomePerSecond)}/s)`,
        `modifiers: x${formatMultiplier(efficiency)}`,
        `district: ${district ? `${Math.round(district.progress * 100)}% restored` : 'unassigned'}`,
      ].join('\n'),
    );
  }

  override destroy(fromScene?: boolean): void {
    for (const subscription of this.subscriptions) subscription.off();
    this.subscriptions.length = 0;
    super.destroy(fromScene);
  }
}
