import Phaser from 'phaser';

import { SPACING } from '@/core/constants/Layout';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import type { UiServices } from '@/ui/UiServices';
import { Button } from '@/ui/components/Button';
import { Screen } from '@/ui/components/Screen';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';

/**
 * PAUSE / MENU OVERLAY
 * ====================
 * Shown over a live game scene. Note that "pause" here means *presentation* pause: an
 * idle game keeps its timers running on wall-clock time (that is the whole point of the
 * timestamp-based timer system), so pausing must never fake-stop progression.
 */
export interface PauseScreenOptions {
  readonly services: UiServices;
  readonly onResume: () => void;
  readonly onOpenSettings: () => void;
  readonly onExitToMenu: () => void;
}

export class PauseScreen extends Screen {
  private readonly services: UiServices;
  private readonly resumeButton: Button;
  private readonly settingsButton: Button;
  private readonly saveButton: Button;
  private readonly exitButton: Button;
  private readonly statsText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, options: PauseScreenOptions) {
    super(scene, { depth: UI_DEPTH.popups, withScrim: true, title: 'Paused' });
    this.services = options.services;

    this.resumeButton = new Button(scene, {
      label: 'Resume',
      variant: 'primary',
      width: 420,
      height: 100,
      onClick: options.onResume,
    });
    this.settingsButton = new Button(scene, {
      label: 'Settings',
      variant: 'secondary',
      width: 420,
      height: 100,
      onClick: options.onOpenSettings,
    });
    this.saveButton = new Button(scene, {
      label: 'Save now',
      variant: 'ghost',
      width: 420,
      height: 100,
      onClick: () => {
        const result = this.services.systems.requestSave('manual-menu');
        this.services.events.emit('ui:toast', {
          message: result.ok ? 'Game saved' : `Save failed: ${result.reason ?? 'unknown'}`,
          variant: result.ok ? 'success' : 'error',
        });
      },
    });
    this.exitButton = new Button(scene, {
      label: 'Main menu',
      variant: 'secondary',
      width: 420,
      height: 100,
      onClick: options.onExitToMenu,
    });

    this.statsText = makeText(scene, '', {
      size: 'micro',
      color: UI_THEME.css.textMuted,
      align: 'center',
    });
    this.statsText.setOrigin(0.5, 0.5);

    this.container.add([
      this.resumeButton.container,
      this.settingsButton.container,
      this.saveButton.container,
      this.exitButton.container,
      this.statsText,
    ]);
  }

  protected override layout(handle: LayoutHandle): void {
    const buttons = [this.resumeButton, this.settingsButton, this.saveButton, this.exitButton];
    const spacing = handle.metrics.frameUnits.height < 1400 ? 120 : 140;
    const startY = this.centerY() - ((buttons.length - 1) * spacing) / 2 + SPACING.md;

    buttons.forEach((button, index) => {
      button.container.setPosition(this.centerX(), startY + index * spacing);
      button.applyChildLayout(handle);
    });

    this.statsText.setPosition(this.centerX(), startY + buttons.length * spacing + SPACING.md);
    this.refreshStats();
  }

  override update(): void {
    this.refreshStats();
  }

  private refreshStats(): void {
    const systems = this.services.systems;
    const state = systems.state;
    const minutes = Math.round(state.session.playTimeMs / 60_000);
    this.statsText.setText(
      [
        `stage: ${state.progression.currentStageId}`,
        `buildings restored: ${Object.values(state.buildings.entries).filter((entry) => entry.tier > 0).length}`,
        `session: ${minutes}m · saves: ${state.profile.saveCount}`,
      ].join('\n'),
    );
  }

  override destroy(): void {
    this.resumeButton.destroy();
    this.settingsButton.destroy();
    this.saveButton.destroy();
    this.exitButton.destroy();
    super.destroy();
  }
}
