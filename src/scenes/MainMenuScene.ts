/**
 * MainMenuScene.
 *
 * Proves the scene flow, the UI kit, save metadata display and the settings/popup
 * layer without any gameplay content. "Play" enters the (currently placeholder)
 * GameScene.
 */

import Phaser from 'phaser';
import { GAME_VERSION, SCENE_KEYS } from '@/core/constants';
import { COLORS, HEX } from '@/ui/UiTheme';
import { Panel } from '@/ui/components/Panel';
import { TextButton } from '@/ui/components/TextButton';
import { createLabel } from '@/ui/components/Label';
import { ToastManager } from '@/ui/components/ToastManager';
import { centeredRect, insetRect, rowRects } from '@/ui/layout/Layout';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { showConfirm } from '@/ui/popups/ConfirmPopup';
import type { Viewport } from '@/ui/layout/Viewport';
import { attachViewport, getGameContext, logSceneTransition } from './sceneContext';
import { formatDuration } from '@/core/utils/time';

export class MainMenuScene extends Phaser.Scene {
  private viewport!: Viewport;
  private title!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private panel!: Panel;
  private playButton!: TextButton;
  private settingsButton!: TextButton;
  private resetButton!: TextButton;
  private toasts!: ToastManager;
  private settingsScreen: SettingsScreen | null = null;

  constructor() {
    super({ key: SCENE_KEYS.mainMenu });
  }

  create(): void {
    const context = getGameContext(this);
    const { viewport, dispose } = attachViewport(this);
    this.viewport = viewport;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      dispose();
      this.toasts?.destroy();
      this.settingsScreen?.destroy();
      this.settingsScreen = null;
    });

    logSceneTransition(SCENE_KEYS.loading, SCENE_KEYS.mainMenu, context);
    this.cameras.main.setBackgroundColor(COLORS.bgBottom);

    this.build();
    this.toasts = new ToastManager(this, context.events, viewport);

    // Proof that save metadata is real (and that loading happened before the menu).
    const status = context.save.peek();
    context.events.emit('ui:toast', {
      message:
        status.kind === 'ready'
          ? `Save loaded • schema v${status.info.schemaVersion}`
          : 'Fresh start • no save yet',
      tone: 'info',
      durationMs: 2_000,
    });

    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.layout());
  }

  private build(): void {
    const context = getGameContext(this);
    const viewport = this.viewport;

    this.title = createLabel(this, viewport, 'RESTORE IT!', {
      size: 'title',
      bold: true,
      color: HEX.accent,
      align: 'center',
      origin: { x: 0.5, y: 0 },
    });
    this.subtitle = createLabel(this, viewport, 'restore • run • redevelop', {
      size: 'sm',
      color: HEX.textDim,
      align: 'center',
      origin: { x: 0.5, y: 0 },
    });

    this.panel = new Panel(this, { x: 0, y: 0, width: 10, height: 10 }, { fill: COLORS.panel, fillAlpha: 0.9 });

    this.playButton = new TextButton(this, {
      rect: { x: 0, y: 0, width: 10, height: 10 },
      label: 'Play',
      viewport,
      tone: 'primary',
      fontSize: 'lg',
      onClick: () => {
        this.scene.start(SCENE_KEYS.game);
      },
    });

    this.settingsButton = new TextButton(this, {
      rect: { x: 0, y: 0, width: 10, height: 10 },
      label: 'Settings',
      viewport,
      tone: 'secondary',
      onClick: () => this.openSettings(),
    });

    this.resetButton = new TextButton(this, {
      rect: { x: 0, y: 0, width: 10, height: 10 },
      label: 'Reset save',
      viewport,
      tone: 'ghost',
      fontSize: 'sm',
      onClick: () => void this.resetSave(),
    });

    const summary = context.debug.enabled ? context.debug.stateSummary().split('\n').slice(0, 3).join('\n') : '';
    this.info = createLabel(
      this,
      viewport,
      [
        `${GAME_VERSION} • schema v${context.state.state.schemaVersion}`,
        `storage: ${context.save.storageName} • content: ${Object.entries(context.content.counts)
          .map(([key, value]) => `${key} ${value}`)
          .join(', ')}`,
        summary,
      ]
        .filter(Boolean)
        .join('\n'),
      { size: 'xs', color: HEX.textDim, align: 'center', origin: { x: 0.5, y: 0 } },
    );

    this.layout();
  }

  private layout(): void {
    const viewport = this.viewport;
    const rect = centeredRect(viewport, 0.88, 0.72);
    this.panel.setRect(rect);
    this.panel.setPosition(rect.x, rect.y);

    this.title.setPosition(viewport.width / 2, rect.y + rect.height * 0.08);
    this.subtitle.setPosition(viewport.width / 2, this.title.y + this.title.height + viewport.font('xs'));

    const inner = insetRect(rect, Math.round(rect.width * 0.1));
    const buttonArea = { ...inner, y: Math.round(rect.y + rect.height * 0.42), height: Math.round(rect.height * 0.3) };
    const buttonRect = rowRects(buttonArea, 3, Math.round(viewport.font('sm')));

    this.playButton.setRect({ ...buttonRect[0], width: inner.width });
    this.settingsButton.setRect({ ...buttonRect[1], width: inner.width });
    this.resetButton.setRect({ ...buttonRect[2], width: inner.width });

    this.info.setPosition(viewport.width / 2, rect.y + rect.height * 0.78);
    this.info.setWordWrapWidth(rect.width - Math.round(rect.width * 0.1), true);

    this.title.setFontSize(viewport.font('title'));
    this.subtitle.setFontSize(viewport.font('sm'));
    this.info.setFontSize(viewport.font('xs'));

    this.toasts?.resize();
    this.settingsScreen?.layout(viewport);
  }

  private openSettings(): void {
    if (this.settingsScreen) return;
    this.settingsScreen = new SettingsScreen(this, getGameContext(this), this.viewport, {
      onClose: () => {
        this.settingsScreen?.destroy();
        this.settingsScreen = null;
      },
    });
  }

  private async resetSave(): Promise<void> {
    const context = getGameContext(this);
    const confirmed = await showConfirm(this, this.viewport, {
      title: 'Reset save?',
      body: 'Local progress will be deleted and a fresh default state created.',
      confirmLabel: 'Reset',
      destructive: true,
    });
    if (!confirmed) return;

    const fresh = context.save.reset();
    context.state.replace(fresh, 'menu-reset');
    context.events.emit('ui:toast', { message: 'Save reset — fresh state created', tone: 'warning' });
  }

  override update(): void {
    this.toasts?.update();
    // Keep the "saved x ago" style info fresh without polling the whole state.
    const context = getGameContext(this);
    const last = context.state.state.timestamps.lastSessionTime;
    void formatDuration(Math.max(0, context.clock.now() - last));
  }
}
