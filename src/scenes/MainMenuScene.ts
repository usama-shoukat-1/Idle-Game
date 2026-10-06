import Phaser from 'phaser';

import { FONT_SIZE, PALETTE, RADIUS, SPACING } from '@/core/constants/Layout';
import { SCENE_KEYS } from '@/core/constants/GameConstants';
import { getGameContext } from '@/core/GameContext';
import { formatCompactNumber } from '@/core/events/EventBus';
import { formatRelative } from '@/core/utils/TimeUtils';
import { createUiServices, type UiServices } from '@/ui/UiServices';
import { LazyPopupHost, UiRoot } from '@/ui/UiRoot';
import { Button } from '@/ui/components/Button';
import { Screen } from '@/ui/components/Screen';
import { ToastLayer } from '@/ui/components/ToastLayer';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import { setTextIfChanged } from '@/ui/utils/TextUtils';

/**
 * MAIN MENU
 * =========
 * Entry point into the run: title, a single prominent Play button, settings, and a small
 * save-status line (schema version, wallet, last save age) that makes the persistence
 * layer observable during QA.
 *
 * Menu composition is done with the same `Screen` + `UiRoot` machinery the game scene
 * uses, so there is no second UI pattern to maintain.
 */
export class MainMenuScene extends Phaser.Scene {
  private ui!: UiRoot;
  private services!: UiServices;
  private settingsScreen: SettingsScreen | null = null;
  private menuScreen!: MenuScreen;

  constructor() {
    super(SCENE_KEYS.mainMenu);
  }

  create(): void {
    const context = getGameContext(this);
    this.cameras.main.setBackgroundColor(PALETTE.background);

    this.services = createUiServices(context.systems, context.layout, new LazyPopupHost(() => this.ui));
    this.ui = new UiRoot(this, this.services);
    this.menuScreen = new MenuScreen(this, this.services, {
      onPlay: () => this.scene.start(SCENE_KEYS.game),
      onSettings: () => this.openSettings(),
    });
    this.ui.mount(this.menuScreen);
    this.ui.mount(new ToastLayer(this, { events: context.systems.events, clock: context.systems.clock }));

    this.drawBackdrop();
  }

  override update(_time: number, delta: number): void {
    this.menuScreen.update(_time, delta);
  }

  private openSettings(): void {
    if (this.settingsScreen) return;
    this.settingsScreen = new SettingsScreen(this, {
      services: this.services,
      onClose: () => {
        if (!this.settingsScreen) return;
        this.ui.close(this.settingsScreen);
        this.settingsScreen.destroy();
        this.settingsScreen = null;
      },
    });
    this.ui.open(this.settingsScreen);
  }

  /** Placeholder menu art: a soft vertical gradient + a horizon line, drawn in design units. */
  private drawBackdrop(): void {
    const graphics = this.add.graphics().setDepth(0);
    const redraw = (): void => {
      const frame = getGameContext(this).layout.metrics.frame;
      const top = frame.y;
      const height = frame.height;
      const steps = 24;
      graphics.clear();
      for (let i = 0; i < steps; i += 1) {
        const t = i / (steps - 1);
        const colour = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(PALETTE.background),
          Phaser.Display.Color.ValueToColor(PALETTE.surface),
          1,
          t * 0.9,
        );
        graphics.fillStyle(Phaser.Display.Color.GetColor(colour.r, colour.g, colour.b), 1);
        graphics.fillRect(frame.x, top + (height / steps) * i, frame.width, height / steps + 1);
      }
    };
    redraw();
    const unsubscribe = getGameContext(this).layout.onChange(redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  }
}

interface MenuScreenOptions {
  readonly onPlay: () => void;
  readonly onSettings: () => void;
}

/** The visible menu content. Kept as a Screen so it participates in layout/teardown. */
class MenuScreen extends Screen {
  private readonly title: Phaser.GameObjects.Text;
  private readonly tagline: Phaser.GameObjects.Text;
  private readonly playButton: Button;
  private readonly settingsButton: Button;
  private readonly saveInfo: Phaser.GameObjects.Text;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly frame: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, private readonly services: UiServices, options: MenuScreenOptions) {
    super(scene, { depth: 10 });

    this.frame = scene.add.graphics();
    this.container.add(this.frame);

    this.title = makeText(scene, 'RESTORE IT!', { size: 'display', bold: true, color: UI_THEME.css.accent, align: 'center' });
    this.title.setOrigin(0.5, 0.5);
    this.tagline = makeText(scene, 'Restore abandoned places. Build a living city.', {
      size: 'small',
      color: UI_THEME.css.textMuted,
      align: 'center',
    });
    this.tagline.setOrigin(0.5, 0.5);

    this.playButton = new Button(scene, {
      label: 'Play',
      variant: 'primary',
      width: 460,
      height: 118,
      onClick: options.onPlay,
    });
    this.settingsButton = new Button(scene, {
      label: 'Settings',
      variant: 'secondary',
      width: 460,
      height: 104,
      onClick: options.onSettings,
    });

    this.saveInfo = makeText(scene, '', { size: 'micro', color: UI_THEME.css.textMuted, align: 'center' });
    this.saveInfo.setOrigin(0.5, 0.5);
    this.statusText = makeText(scene, '', { size: 'micro', color: UI_THEME.css.textMuted, align: 'center' });
    this.statusText.setOrigin(0.5, 1);

    this.container.add([
      this.title,
      this.tagline,
      this.playButton.container,
      this.settingsButton.container,
      this.saveInfo,
      this.statusText,
    ]);
  }

  protected override layout(handle: Parameters<Screen['applyLayout']>[0]): void {
    this.title.setPosition(this.centerX(), this.centerY(-this.frameHeight * 0.26));
    this.title.setFontSize(FONT_SIZE.display);
    this.tagline.setPosition(this.centerX(), this.centerY(-this.frameHeight * 0.26 + 64));

    this.playButton.container.setPosition(this.centerX(), this.centerY(+this.frameHeight * 0.02));
    this.playButton.applyChildLayout(handle);
    this.settingsButton.container.setPosition(this.centerX(), this.centerY(+this.frameHeight * 0.02 + 132));
    this.settingsButton.applyChildLayout(handle);

    this.saveInfo.setPosition(this.centerX(), this.centerY(+this.frameHeight * 0.2));

    // A framed "card" behind the title gives the menu a deliberate shape without art.
    this.frame.clear();
    const cardWidth = Math.min(this.frameWidth - this.gutter * 2, 620);
    const cardHeight = 260;
    const cardX = this.centerX() - cardWidth / 2;
    const cardY = this.centerY(-this.frameHeight * 0.26) - 120;
    this.frame.fillStyle(UI_THEME.colors.surface, 0.55);
    this.frame.fillRoundedRect(cardX, cardY, cardWidth, cardHeight, RADIUS.lg);
    this.frame.lineStyle(2, UI_THEME.colors.outline, 0.8);
    this.frame.strokeRoundedRect(cardX, cardY, cardWidth, cardHeight, RADIUS.lg);

    this.statusText.setPosition(this.centerX(), this.bottom(SPACING.lg));

    const buildStamp = import.meta.env?.MODE ?? 'unknown';
    const state = this.services.systems.state;
    this.saveInfo.setText(
      [
        `Stage: ${state.progression.currentStageId}`,
        `Wallet: ${formatCompactNumber(state.wallet.coins)} coins · ${formatCompactNumber(state.wallet.gems)} gems`,
        `Last save: ${formatRelative(state.session.lastSaveAt, this.services.systems.clock.now())}`,
      ].join('\n'),
    );
    this.statusText.setText(
      `build ${buildStamp} · schema v${state.schemaVersion} · ${this.services.systems.storage.name} · Phase 0 foundation`,
    );
  }

  override update(_time: number, _delta: number): void {
    const state = this.services.systems.state;
    setTextIfChanged(
      this.saveInfo,
      [
        `Stage: ${state.progression.currentStageId}`,
        `Wallet: ${formatCompactNumber(state.wallet.coins)} coins · ${formatCompactNumber(state.wallet.gems)} gems`,
        `Last save: ${formatRelative(state.session.lastSaveAt, this.services.systems.clock.now())}`,
      ].join('\n'),
    );
  }
}
