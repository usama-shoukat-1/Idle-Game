import Phaser from 'phaser';

import { SPACING } from '@/core/constants/Layout';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import type { UiServices } from '@/ui/UiServices';
import { Button } from '@/ui/components/Button';
import { Screen } from '@/ui/components/Screen';
import { Slider } from '@/ui/components/Slider';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import { ConfirmationPopup } from '@/ui/popups/ConfirmationPopup';
import { RewardPopup } from '@/ui/popups/RewardPopup';

/**
 * SETTINGS
 * ========
 * Audio sliders (master/music/sfx), mute, motion preference, an offline-summary preview
 * (useful for QA of the offline pipeline) and the development-only save reset.
 *
 * Every control writes through the owning system - the screen stores no state of its own,
 * so values can never drift from the saved settings.
 */
export interface SettingsScreenOptions {
  readonly services: UiServices;
  readonly onClose: () => void;
}

export class SettingsScreen extends Screen {
  private readonly services: UiServices;
  private readonly sliders: Slider[] = [];
  private readonly muteButton: Button;
  private readonly motionButton: Button;
  private readonly offlineButton: Button;
  private readonly resetButton: Button;
  private readonly toolsLabel: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, settingsOptions: SettingsScreenOptions) {
    super(scene, {
      depth: UI_DEPTH.popups,
      withScrim: true,
      title: 'Settings',
      onBack: () => settingsOptions.onClose(),
    });

    this.services = settingsOptions.services;
    const audio = this.services.systems.audio;

    this.sliders = [
      new Slider(scene, {
        width: 420,
        initial: audio.settings.master,
        label: 'Master',
        onChange: (value) => audio.setMasterVolume(value),
      }),
      new Slider(scene, {
        width: 420,
        initial: audio.settings.music,
        label: 'Music',
        onChange: (value) => audio.setMusicVolume(value),
      }),
      new Slider(scene, {
        width: 420,
        initial: audio.settings.sfx,
        label: 'Effects',
        onChange: (value) => audio.setSfxVolume(value),
      }),
    ];
    for (const slider of this.sliders) this.container.add(slider.container);

    this.muteButton = new Button(scene, {
      label: audio.settings.muted ? 'Unmute' : 'Mute',
      variant: 'secondary',
      width: 296,
      height: 96,
      onClick: () => {
        const muted = audio.toggleMute();
        this.muteButton.setLabel(muted ? 'Unmute' : 'Mute');
        this.services.events.emit('ui:toast', { message: muted ? 'Audio muted' : 'Audio unmuted' });
      },
    });

    this.motionButton = new Button(scene, {
      label: this.services.systems.state.settings.display.reducedMotion ? 'Motion: reduced' : 'Motion: full',
      variant: 'ghost',
      width: 296,
      height: 96,
      onClick: () => {
        const display = this.services.systems.state.settings.display;
        display.reducedMotion = !display.reducedMotion;
        this.motionButton.setLabel(display.reducedMotion ? 'Motion: reduced' : 'Motion: full');
      },
    });

    this.toolsLabel = makeText(scene, 'Offline & development tools', {
      size: 'micro',
      color: UI_THEME.css.textMuted,
      align: 'center',
    });
    this.toolsLabel.setOrigin(0.5, 0.5);

    this.offlineButton = new Button(scene, {
      label: 'Preview offline reward',
      variant: 'secondary',
      width: 440,
      height: 96,
      onClick: () => this.previewOffline(),
    });

    this.resetButton = new Button(scene, {
      label: 'Reset save',
      variant: 'danger',
      width: 440,
      height: 96,
      onClick: () => this.confirmReset(),
    });

    this.container.add([
      this.muteButton.container,
      this.motionButton.container,
      this.toolsLabel,
      this.offlineButton.container,
      this.resetButton.container,
    ]);
  }

  protected override layout(handle: LayoutHandle): void {
    const startY = this.top(SPACING.xxxl * 2);
    const sliderSpacing = this.isCompact(handle) ? SPACING.xl + SPACING.xs : SPACING.xxxl;

    this.sliders.forEach((slider, index) => {
      slider.container.setPosition(this.centerX(), startY + index * sliderSpacing);
      slider.applyChildLayout(handle);
    });

    const afterSliders = startY + this.sliders.length * sliderSpacing + SPACING.lg;
    this.muteButton.container.setPosition(this.centerX() - 158, afterSliders);
    this.muteButton.applyChildLayout(handle);
    this.motionButton.container.setPosition(this.centerX() + 158, afterSliders);
    this.motionButton.applyChildLayout(handle);

    const toolsY = afterSliders + SPACING.xxxl;
    this.toolsLabel.setPosition(this.centerX(), toolsY);

    const offlineY = toolsY + SPACING.xxl + SPACING.sm;
    this.offlineButton.container.setPosition(this.centerX(), offlineY);
    this.offlineButton.applyChildLayout(handle);

    const resetY = offlineY + SPACING.xxl + SPACING.xxl;
    this.resetButton.container.setPosition(this.centerX(), resetY);
    this.resetButton.applyChildLayout(handle);
  }

  private isCompact(handle: LayoutHandle): boolean {
    return handle.metrics.frameUnits.height < 1400;
  }

  /** Shows exactly what the offline pipeline would award right now (foundation check). */
  private previewOffline(): void {
    const summary = this.services.systems.offline.preview();
    const popup = new RewardPopup({
      scene: this.scene,
      title: summary.skipped ? 'No offline reward' : 'Offline reward',
      subtitle: summary.skipped
        ? `Skipped: ${summary.skipReason}`
        : `Away for ${Math.round(summary.elapsedMs / 1000)}s (capped at ${Math.round(summary.capMs / 60_000)}m)`,
      rewards: [
        { label: 'coins', amount: summary.coins, kind: 'coins' },
        { label: 'efficiency', amount: summary.efficiency, kind: 'other' },
      ],
      ctaLabel: 'Close',
      onCollect: () => this.services.popups.close(popup),
    });
    this.services.popups.open(popup);
  }

  private confirmReset(): void {
    const popup = new ConfirmationPopup({
      scene: this.scene,
      title: 'Reset save?',
      body: 'This wipes all progress and starts a brand new game. It cannot be undone.',
      confirmLabel: 'Reset',
      destructive: true,
      onConfirm: () => {
        this.services.systems.save.reset();
        this.services.popups.close(popup);
        this.services.events.emit('ui:toast', { message: 'Save reset', variant: 'warning' });
      },
      onCancel: () => this.services.popups.close(popup),
    });
    this.services.popups.open(popup);
  }

  override destroy(): void {
    for (const slider of this.sliders) slider.destroy();
    this.sliders.length = 0;
    this.muteButton.destroy();
    this.motionButton.destroy();
    this.offlineButton.destroy();
    this.resetButton.destroy();
    super.destroy();
  }
}
