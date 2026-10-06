/**
 * Settings overlay.
 *
 * Volume/mute/haptics controls plus the development reset. Writes through the
 * AudioManager + state store so settings persist in the save (no UI-local state).
 */

import Phaser from 'phaser';
import type { GameContext } from '@/core/GameContext';
import type { SettingsState } from '@/core/types/gameState';
import type { Viewport } from '../layout/Viewport';
import { COLORS, HEX } from '../UiTheme';
import { Panel } from '../components/Panel';
import { Slider } from '../components/Slider';
import { TextButton } from '../components/TextButton';
import { createLabel } from '../components/Label';
import { centeredRect, insetRect, rowRects } from '../layout/Layout';
import { showConfirm } from '../popups/ConfirmPopup';

export interface SettingsScreenOptions {
  onClose: () => void;
}

export class SettingsScreen extends Phaser.GameObjects.Container {
  private readonly backdrop: Phaser.GameObjects.Rectangle;
  private readonly panel: Panel;
  private readonly title: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly sliders: Slider[] = [];
  private readonly buttons: TextButton[] = [];

  constructor(
    scene: Phaser.Scene,
    private readonly context: GameContext,
    private readonly viewport: Viewport,
    private readonly options: SettingsScreenOptions,
  ) {
    super(scene, 0, 0);

    this.backdrop = scene.add
      .rectangle(0, 0, viewport.width, viewport.height, COLORS.overlay, 0.72)
      .setOrigin(0, 0)
      .setInteractive();
    this.panel = new Panel(scene, { x: 0, y: 0, width: 10, height: 10 }, { fill: COLORS.panel });

    this.title = createLabel(scene, viewport, 'Settings', { size: 'xl', bold: true, align: 'center', origin: { x: 0.5, y: 0 } });
    this.hint = createLabel(scene, viewport, 'Audio is placeholder-only in Phase 0 (no sound files ship yet).', {
      size: 'xs',
      color: HEX.textDim,
      align: 'center',
      origin: { x: 0.5, y: 0 },
    });

    this.add([this.backdrop, this.panel, this.title, this.hint]);
    this.setDepth(9_500).setScrollFactor(0);
    scene.add.existing(this);

    this.buildControls();
    this.layout(viewport);
  }

  private buildControls(): void {
    const settings = this.context.state.state.settings;

    this.sliders.push(
      this.createSlider('Master volume', settings.masterVolume, (value) => this.commit({ masterVolume: value })),
      this.createSlider('Music volume', settings.musicVolume, (value) => this.commit({ musicVolume: value })),
      this.createSlider('SFX volume', settings.sfxVolume, (value) => this.commit({ sfxVolume: value })),
    );

    this.buttons.push(
      new TextButton(this.scene, {
        rect: { x: 0, y: 0, width: 10, height: 10 },
        label: settings.muted ? 'Sound: muted' : 'Sound: on',
        viewport: this.viewport,
        tone: 'secondary',
        fontSize: 'sm',
        onClick: () => {
          const next = !this.context.state.state.settings.muted;
          this.commit({ muted: next });
          this.buttons[0].setLabel(next ? 'Sound: muted' : 'Sound: on');
        },
      }),
      new TextButton(this.scene, {
        rect: { x: 0, y: 0, width: 10, height: 10 },
        label: settings.hapticsEnabled ? 'Haptics: on' : 'Haptics: off',
        viewport: this.viewport,
        tone: 'secondary',
        fontSize: 'sm',
        onClick: () => {
          const next = !this.context.state.state.settings.hapticsEnabled;
          this.commit({ hapticsEnabled: next });
          this.buttons[1].setLabel(next ? 'Haptics: on' : 'Haptics: off');
        },
      }),
      new TextButton(this.scene, {
        rect: { x: 0, y: 0, width: 10, height: 10 },
        label: 'Reset save',
        viewport: this.viewport,
        tone: 'danger',
        fontSize: 'sm',
        onClick: () => void this.confirmReset(),
      }),
      new TextButton(this.scene, {
        rect: { x: 0, y: 0, width: 10, height: 10 },
        label: 'Close',
        viewport: this.viewport,
        tone: 'primary',
        fontSize: 'sm',
        onClick: () => this.options.onClose(),
      }),
    );

    this.add(this.buttons);
  }

  private createSlider(label: string, value: number, onChange: (value: number) => void): Slider {
    const slider = new Slider(this.scene, {
      rect: { x: 0, y: 0, width: 10, height: 10 },
      viewport: this.viewport,
      label,
      value,
      onChange,
    });
    this.add(slider);
    return slider;
  }

  /** Persist a settings change once, through the audio manager + state store. */
  private commit(partial: Partial<SettingsState>): void {
    const next: SettingsState = { ...this.context.state.state.settings, ...partial };
    this.context.state.update((state) => {
      state.settings = { ...next };
    });
    this.context.audio.applySettings(next);
    this.context.events.emit('settings:changed', { settings: next });
  }

  private async confirmReset(): Promise<void> {
    const confirmed = await showConfirm(this.scene, this.viewport, {
      title: 'Reset save?',
      body: 'This wipes local progress and starts from a fresh default state. It cannot be undone.',
      confirmLabel: 'Reset',
      destructive: true,
    });
    if (!confirmed) return;

    const fresh = this.context.save.reset();
    this.context.state.replace(fresh, 'settings-reset');
    this.context.events.emit('ui:toast', { message: 'Save reset', tone: 'warning' });
    this.options.onClose();
  }

  layout(viewport: Viewport): void {
    const rect = centeredRect(viewport, 0.9, 0.78);
    this.setPosition(rect.x, rect.y);
    this.panel.setRect({ x: 0, y: 0, width: rect.width, height: rect.height });

    this.backdrop.setSize(viewport.width, viewport.height);

    const padding = Math.round(rect.width * 0.07);
    this.title.setPosition(rect.width / 2, padding * 0.7);
    this.hint.setPosition(rect.width / 2, padding * 0.7 + this.title.height + viewport.font('xs'));
    this.hint.setWordWrapWidth(rect.width - padding * 2, true);

    const content = insetRect({ x: 0, y: 0, width: rect.width, height: rect.height }, padding);
    const sliderArea = {
      x: content.x,
      y: this.hint.y + this.hint.height + viewport.font('md'),
      width: content.width,
      height: rect.height * 0.34,
    };

    rowRects(sliderArea, this.sliders.length, Math.round(viewport.font('sm'))).forEach((rowRect, index) => {
      const slider = this.sliders[index];
      if (!slider) return;
      slider.setPosition(rowRect.x, rowRect.y);
      slider.setSize(rowRect.width, rowRect.height);
    });

    const buttonArea = {
      x: content.x,
      y: sliderArea.y + sliderArea.height + viewport.font('sm'),
      width: content.width,
      height: rect.height - (sliderArea.y + sliderArea.height + viewport.font('sm')) - padding * 1.2,
    };
    const buttonHeight = Math.max(viewport.touchTarget * 0.75, buttonArea.height / (this.buttons.length + 0.6));
    rowRects({ ...buttonArea, height: buttonHeight * this.buttons.length }, this.buttons.length, Math.round(viewport.font('xs'))).forEach(
      (rowRect, index) => {
        this.buttons[index]?.setRect(rowRect);
      },
    );
  }

  override destroy(fromScene?: boolean): void {
    this.backdrop.destroy();
    super.destroy(fromScene);
  }
}
