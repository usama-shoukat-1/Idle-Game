/**
 * GameScene.
 *
 * Phase 0 keeps the world as an explicit placeholder: there is no building content
 * yet, so instead of faking gameplay the scene wires up everything that production
 * gameplay will need - income accrual, save autosave, the UI panels, the input
 * layer, the offline popup and the debug overlay - and proves them with a small
 * "foundation probe".
 */

import Phaser from 'phaser';
import { SCENE_KEYS } from '@/core/constants';
import { COLORS, HEX } from '@/ui/UiTheme';
import { CurrencyBar } from '@/ui/components/CurrencyBar';
import { TextButton } from '@/ui/components/TextButton';
import { createLabel } from '@/ui/components/Label';
import { ToastManager } from '@/ui/components/ToastManager';
import { BuildingInfoPanel } from '@/ui/panels/BuildingInfoPanel';
import { UpgradePanel } from '@/ui/panels/UpgradePanel';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { OfflineProgressScreen } from '@/ui/screens/OfflineProgressScreen';
import { contentRect } from '@/ui/layout/Layout';
import { DebugOverlay } from '@/debug/DebugOverlay';
import { InputManager } from '@/systems/InputSystem/InputManager';
import type { Viewport } from '@/ui/layout/Viewport';
import type { TapEvent } from '@/systems/InputSystem';
import type { OfflineReport } from '@/core/types/offline';
import { attachViewport, getGameContext, logSceneTransition, OFFLINE_REPORT_REGISTRY_KEY } from './sceneContext';

export class GameScene extends Phaser.Scene {
  private viewport!: Viewport;
  private inputManager!: InputManager;
  private currencyBar!: CurrencyBar;
  private buildingPanel!: BuildingInfoPanel;
  private upgradePanel!: UpgradePanel;
  private toasts!: ToastManager;
  private debugOverlay: DebugOverlay | null = null;
  private settingsScreen: SettingsScreen | null = null;
  private offlineScreen: OfflineProgressScreen | null = null;

  private worldLabel!: Phaser.GameObjects.Text;
  private probeLabel!: Phaser.GameObjects.Text;
  private probe!: Phaser.GameObjects.Arc;
  private worldLayer!: Phaser.GameObjects.Container;
  private hudLayer!: Phaser.GameObjects.Container;
  private saveButton!: TextButton;
  private settingsButton!: TextButton;
  private menuButton!: TextButton;

  private lastIncomeFlushAt = 0;
  private autosaveAccumulator = 0;
  private lastProbePulse = 0;

  constructor() {
    super({ key: SCENE_KEYS.game });
  }

  create(): void {
    const context = getGameContext(this);
    const { viewport, dispose } = attachViewport(this);
    this.viewport = viewport;

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      dispose();
      this.inputManager?.dispose();
      this.toasts?.destroy();
      this.debugOverlay?.destroy();
      this.debugOverlay = null;
      this.settingsScreen?.destroy();
      this.settingsScreen = null;
      this.offlineScreen?.close();
      this.offlineScreen = null;
    });

    logSceneTransition(SCENE_KEYS.mainMenu, SCENE_KEYS.game, context);

    this.cameras.main.setBackgroundColor(COLORS.bgBottom);
    this.worldLayer = this.add.container(0, 0);
    this.hudLayer = this.add.container(0, 0);

    this.buildWorldPlaceholder();
    this.buildHud();
    this.buildInput();
    this.showOfflineReportIfAny();

    // Register the desktop debug shortcuts (no-op on mobile and in release builds).
    if (context.debug.enabled) {
      context.debug.registerShortcuts?.(this.inputManager);
      const game = this.game;
      if (game) context.debug.attachGame?.(game);
      this.debugOverlay = new DebugOverlay(this, context, viewport);
    }

    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.layout());
    this.layout();

    context.events.emit('ui:toast', { message: 'World placeholder — content arrives in Phase 1', tone: 'info' });
  }

  /* ---------------------------------------------------------------- world */

  private buildWorldPlaceholder(): void {
    const rect = contentRect(this.viewport, Math.round(this.viewport.bounds.usableHeight * 0.44));

    const tile = this.add
      .tileSprite(rect.x, rect.y, rect.width, rect.height, 'placeholder-tile')
      .setOrigin(0, 0);
    tile.setAlpha(0.35);

    this.worldLabel = createLabel(this, this.viewport, this.worldPlaceholderText(), {
      size: 'sm',
      color: HEX.textDim,
      align: 'center',
      origin: { x: 0.5, y: 0 },
      wrapWidth: rect.width * 0.82,
    });

    this.probe = this.add
      .circle(0, 0, Math.round(this.viewport.width * 0.11), COLORS.accent, 0.18)
      .setStrokeStyle(3, COLORS.accent, 0.9);

    this.probeLabel = createLabel(this, this.viewport, 'foundation probe\ntap me', {
      size: 'sm',
      color: HEX.accent,
      align: 'center',
      origin: { x: 0.5, y: 0.5 },
    });

    this.worldLayer.add([tile, this.worldLabel, this.probe, this.probeLabel]);
  }

  private worldPlaceholderText(): string {
    const context = getGameContext(this);
    if (context.content.listBuildings().length > 0) {
      return 'World placeholder: building definitions detected. Rendering arrives in Phase 1.';
    }
    return 'World placeholder\nNo building content registered yet.\nThe probe below verifies input, economy, state and save/load.';
  }

  /* ------------------------------------------------------------------ hud */

  private buildHud(): void {
    const context = getGameContext(this);

    this.currencyBar = new CurrencyBar(this, context, this.viewport);
    this.hudLayer.add(this.currencyBar);

    this.buildingPanel = new BuildingInfoPanel(this, context, this.viewport);
    this.upgradePanel = new UpgradePanel(this, context, this.viewport);
    this.hudLayer.add([this.buildingPanel, this.upgradePanel]);

    this.saveButton = new TextButton(this, {
      rect: { x: 0, y: 0, width: 10, height: 10 },
      label: 'Save now',
      viewport: this.viewport,
      tone: 'secondary',
      fontSize: 'sm',
      onClick: () => this.saveNow(),
    });

    this.settingsButton = new TextButton(this, {
      rect: { x: 0, y: 0, width: 10, height: 10 },
      label: 'Settings',
      viewport: this.viewport,
      tone: 'secondary',
      fontSize: 'sm',
      onClick: () => this.openSettings(),
    });

    this.menuButton = new TextButton(this, {
      rect: { x: 0, y: 0, width: 10, height: 10 },
      label: 'Menu',
      viewport: this.viewport,
      tone: 'ghost',
      fontSize: 'sm',
      onClick: () => this.returnToMenu(),
    });

    this.hudLayer.add([this.saveButton, this.settingsButton, this.menuButton]);
    this.toasts = new ToastManager(this, context.events, this.viewport);

    // A single tap anywhere selects the (future) building under the finger; with no
    // content the panels simply show their empty state.
    const buildings = context.content.listBuildings();
    if (buildings[0]) {
      this.buildingPanel.show(buildings[0].id);
      this.upgradePanel.show(buildings[0].id);
    }
  }

  /* ---------------------------------------------------------------- input */

  private buildInput(): void {
    const context = getGameContext(this);
    // The input layer is scene-scoped: it wraps Phaser's pointer/keyboard plugins,
    // so the scene owns its lifecycle while gameplay only sees semantic events.
    this.inputManager = new InputManager(this, context.events);

    this.inputManager.onTap((tap) => this.handleTap(tap));
    this.inputManager.onSwipe(({ direction }) => {
      if (direction === 'down') this.settingsScreen?.destroy();
    });
  }

  private handleTap(tap: TapEvent): void {
    const context = getGameContext(this);

    context.state.update((state) => {
      state.stats.totalTaps += 1;
    });

    // First touch unlocks the (currently silent) audio context - a browser policy
    // requirement that has to happen on a real gesture.
    void context.audio.unlock();

    const distance = Phaser.Math.Distance.Between(tap.worldX, tap.worldY, this.probe.x, this.probe.y);
    if (distance <= this.probe.radius * 1.4) {
      this.pulseProbe(tap);
      return;
    }
  }

  /**
   * Foundation probe: proves engine -> input -> economy -> state -> save in one tap.
   * In release builds (cheats disabled) it only pulses, so no economy mutation is
   * reachable outside development.
   */
  private pulseProbe(tap: TapEvent): void {
    const context = getGameContext(this);
    const now = this.time.now;
    if (now - this.lastProbePulse < 90) return;
    this.lastProbePulse = now;

    this.tweens.add({
      targets: [this.probe, this.probeLabel],
      scale: { from: 0.94, to: 1.02 },
      duration: 110,
      yoyo: true,
    });

    if (!context.config.debug.cheatsEnabled) {
      this.worldLabel.setText('Input OK\nThis build has no gameplay content yet.');
      return;
    }

    const result = context.economy.add('coins', 1, 'dev:probe');
    if (!result.ok) return;

    const float = createLabel(this, this.viewport, '+1', {
      size: 'md',
      bold: true,
      color: HEX.coin,
      origin: { x: 0.5, y: 0.5 },
    });
    float.setPosition(tap.worldX, tap.worldY);
    this.worldLayer.add(float);
    this.tweens.add({
      targets: float,
      y: float.y - this.viewport.font('xl'),
      alpha: 0,
      duration: 620,
      onComplete: () => float.destroy(),
    });
  }

  /* --------------------------------------------------------------- offline */

  private showOfflineReportIfAny(): void {
    const report = this.registry.get(OFFLINE_REPORT_REGISTRY_KEY) as OfflineReport | undefined;
    if (!report) return;
    this.registry.remove(OFFLINE_REPORT_REGISTRY_KEY);
    this.offlineScreen = new OfflineProgressScreen(this, getGameContext(this), this.viewport, { report });
  }

  /* ---------------------------------------------------------------- layout */

  private layout(): void {
    const viewport = this.viewport;
    const rect = contentRect(viewport, Math.round(viewport.bounds.usableHeight * 0.44));

    // World
    const tile = this.worldLayer.list[0] as Phaser.GameObjects.TileSprite | undefined;
    if (tile && 'setSize' in tile) {
      tile.setPosition(rect.x, rect.y);
      tile.setSize(rect.width, rect.height);
    }
    this.worldLabel?.setPosition(viewport.width / 2, rect.y + rect.height * 0.06);
    this.worldLabel?.setWordWrapWidth(rect.width * 0.86, true);

    const probeY = rect.y + rect.height * 0.55;
    this.probe?.setPosition(viewport.width / 2, probeY).setRadius(Math.round(viewport.width * 0.11));
    this.probeLabel?.setPosition(viewport.width / 2, probeY);

    // Panels
    this.currencyBar?.layout(viewport);
    this.buildingPanel?.layout(viewport);
    this.upgradePanel?.layout(viewport);

    // HUD buttons sit just above the building panel.
    const buttonHeight = Math.max(viewport.touchTarget * 0.72, viewport.font('md') * 2.6);
    const buttonWidth = Math.round((rect.width - viewport.font('sm')) / 3);
    const hudY = viewport.height - viewport.bounds.safeBottom - Math.round(viewport.bounds.usableHeight * 0.44) - buttonHeight - viewport.font('sm');
    this.saveButton?.setRect({ x: rect.x, y: hudY, width: buttonWidth, height: buttonHeight });
    this.settingsButton?.setRect({ x: rect.x + buttonWidth + viewport.font('sm'), y: hudY, width: buttonWidth, height: buttonHeight });
    this.menuButton?.setRect({
      x: rect.x + (buttonWidth + viewport.font('sm')) * 2,
      y: hudY,
      width: buttonWidth,
      height: buttonHeight,
    });

    this.toasts?.resize();
    this.debugOverlay?.resize(viewport);
    this.settingsScreen?.layout(viewport);
  }

  /* ------------------------------------------------------------ save/loops */

  private saveNow(): void {
    const context = getGameContext(this);
    context.offline.anchor(context.clock.now());
    const result = context.save.save(context.state.snapshot(), 'manual');
    context.state.markClean();
    context.events.emit('ui:toast', {
      message: result.ok ? 'Saved' : `Save failed: ${result.error ?? 'unknown error'}`,
      tone: result.ok ? 'success' : 'error',
    });
  }

  private returnToMenu(): void {
    const context = getGameContext(this);
    context.offline.anchor(context.clock.now());
    context.save.save(context.state.snapshot(), 'scene-change');
    context.state.markClean();
    this.scene.start(SCENE_KEYS.mainMenu);
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

  override update(_time: number, delta: number): void {
    const context = getGameContext(this);
    const now = context.clock.now();

    // Simulation is timestamp based: complete timers, then accrue income.
    context.timers.update(now);
    context.buildings.accrue(now);

    // Flush accrued income into the wallet once per balance tick (not per frame).
    if (now - this.lastIncomeFlushAt >= context.balance.incomeTickMs) {
      this.lastIncomeFlushAt = now;
      context.buildings.flush(now);
    }

    // Autosave on the configured interval, only when something changed.
    this.autosaveAccumulator += delta;
    if (this.autosaveAccumulator >= context.config.autosaveIntervalMs) {
      this.autosaveAccumulator = 0;
      if (context.state.isDirty) {
        context.offline.anchor(now);
        context.save.save(context.state.snapshot(), 'autosave');
        context.state.markClean();
      }
    }

    this.buildingPanel?.tick();
    this.upgradePanel?.tick();
    this.toasts?.update();
    this.debugOverlay?.update(delta);
  }
}
