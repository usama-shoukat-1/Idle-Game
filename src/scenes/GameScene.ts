import Phaser from 'phaser';

import { logger } from '@/core/Logger';
import { FONT_SIZE, PALETTE, RADIUS, SPACING } from '@/core/constants/Layout';
import { REGISTRY_KEYS, SCENE_KEYS, UI_DEPTH } from '@/core/constants/GameConstants';
import { getGameContext } from '@/core/GameContext';
import { createUiServices, type UiServices } from '@/ui/UiServices';
import { LazyPopupHost, UiRoot, type UiScreen } from '@/ui/UiRoot';
import { BuildingInfoPanel } from '@/ui/panels/BuildingInfoPanel';
import { UpgradePanel } from '@/ui/panels/UpgradePanel';
import { ToastLayer } from '@/ui/components/ToastLayer';
import { HudScreen } from '@/ui/screens/HudScreen';
import { PauseScreen } from '@/ui/screens/PauseScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import { setTextIfChanged } from '@/ui/utils/TextUtils';
import { InputSystem } from '@/systems/InputSystem/InputSystem';
import { CustomerPool } from '@/entities/Customer/CustomerEntity';
import { DebugOverlay } from '@/debug/DebugOverlay';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import type { OfflineSummary } from '@/systems/OfflineIncomeSystem/OfflineIncomeSystem';
import { formatCompactNumber } from '@/core/events/EventBus';

/**
 * GAME SCENE
 * ==========
 * The playable surface. In Phase 0 it renders a placeholder world and proves the whole
 * stack is live: scene flow, input, state, save/load, timers, economy, HUD and debug tools.
 *
 * It deliberately contains NO building-specific logic and no balance numbers. The world is a
 * stage-driven backdrop; when Phase 1 registers buildings in content, the same scene code
 * renders them through `BuildingEntity` without modification.
 *
 * Performance notes (mobile first):
 * - the world grid is drawn once into a Graphics object, not per frame;
 * - per-frame work is limited to ticking timers, a pooled customer update and a throttled
 *   UI refresh (4 Hz) instead of touching text every frame;
 * - nothing polls game state in a tight loop: changes arrive as events.
 */
export class GameScene extends Phaser.Scene {
  private ui!: UiRoot;
  private services!: UiServices;
  private inputSystem!: InputSystem;
  private customers!: CustomerPool;
  private hud!: HudScreen;
  private buildingPanel!: BuildingInfoPanel;
  private upgradePanel!: UpgradePanel;
  private toastLayer!: ToastLayer;
  private debugOverlay: DebugOverlay | null = null;
  private pauseScreen: PauseScreen | null = null;
  private settingsScreen: SettingsScreen | null = null;
  private stageLabel!: Phaser.GameObjects.Text;
  private worldHint!: Phaser.GameObjects.Text;
  private debugHelp!: Phaser.GameObjects.Text;
  private panelRefreshTimer = 0;
  private worldGraphics!: Phaser.GameObjects.Graphics;

  constructor() {
    super(SCENE_KEYS.game);
  }

  create(): void {
    const context = getGameContext(this);
    const systems = context.systems;

    this.cameras.main.setBackgroundColor(PALETTE.background);
    context.systems.save.markDirty();
    systems.progression.setCurrentStage(systems.progression.getCurrentStageId());

    this.drawWorld();

    // --- UI -------------------------------------------------------------
    this.services = createUiServices(systems, context.layout, new LazyPopupHost(() => this.ui));

    this.hud = new HudScreen(this, {
      services: this.services,
      onMenuPress: () => this.openPause(),
    });

    this.buildingPanel = new BuildingInfoPanel(this, {
      services: this.services,
      onUpgrade: (buildingId) => this.requestRestore(buildingId),
      onAccelerate: (buildingId) => this.requestAccelerate(buildingId),
    });

    this.upgradePanel = new UpgradePanel(this, {
      services: this.services,
    });

    // Panels are plain components; this adapter lets the UiRoot treat them as screens.
    const asScreen = (container: Phaser.GameObjects.Container, onLayout: (handle: LayoutHandle) => void, onUpdate?: () => void): UiScreen => ({
      container,
      applyLayout: (handle) => onLayout(handle),
      update: onUpdate ? () => onUpdate() : undefined,
      destroy: () => container.removeAll(true),
    });

    this.ui = new UiRoot(this, this.services);
    this.ui.mount(this.hud, 10);
    this.ui.mount(
      asScreen(
        this.buildingPanel.container,
        (handle) => this.buildingPanel.applyLayout(handle),
      ),
      20,
    );
    this.ui.mount(
      asScreen(
        this.upgradePanel.container,
        (handle) => this.upgradePanel.applyLayout(handle),
        () => undefined,
      ),
      21,
    );

    this.toastLayer = new ToastLayer(this, { events: systems.events, clock: systems.clock });
    this.ui.mount(this.toastLayer, UI_DEPTH.toasts);

    // --- input ----------------------------------------------------------
    this.inputSystem = new InputSystem(this, {
      debugKeys: {
        F1: 'debug.toggleOverlay',
        F2: 'debug.addCoins',
        F3: 'debug.addGems',
        F4: 'debug.unlockBuilding',
        F5: 'debug.finishTimers',
        F6: 'debug.resetSave',
        ONE: 'debug.unlockStage',
      },
    });
    this.wireInput();

    this.customers = new CustomerPool(this, 16);

    // --- debug ----------------------------------------------------------
    if (context.debug) {
      this.debugOverlay = new DebugOverlay(this, { tools: context.debug, clock: systems.clock });
      this.ui.mount(this.debugOverlay, UI_DEPTH.debug);
      this.debugOverlay.setVisible(context.debug.enabled);
      this.disableContextMenu();
    }

    this.wireEvents();

    // Offline summary from LoadingScene: surfaced as a toast so the pipeline is visible.
    const summary = this.registry.get(REGISTRY_KEYS.offlineSummary) as OfflineSummary | undefined;
    if (summary && !summary.skipped && summary.coins > 0) {
      this.toastLayer.push(
        `Welcome back — ${formatCompactNumber(summary.coins)} coins earned while away`,
        'success',
      );
    } else {
      this.toastLayer.push('Foundation ready. Tap the world to test input.', 'info');
    }

    logger.info('scene', 'game scene ready');
  }

  override update(_time: number, delta: number): void {
    const systems = getGameContext(this).systems;

    // Timestamp-based timers: completion happens here, but their accuracy does not depend
    // on this being called at any particular rate.
    systems.timers.tick();
    systems.eventSystem.flush();
    systems.eventSystem.prune();

    this.customers.update(delta);

    // Throttled UI refresh: 4 Hz is smooth for countdowns and 15x cheaper than per frame.
    this.panelRefreshTimer += delta;
    if (this.panelRefreshTimer >= 250) {
      this.panelRefreshTimer = 0;
      this.hud.update();
      this.buildingPanel.update();
      this.upgradePanel.update();
      if (this.debugOverlay?.visible) this.debugOverlay.update();
    }

    const state = systems.state;
    state.session.playTimeMs += delta;
  }

  // --- world ---------------------------------------------------------------

  /** Placeholder world: stage backdrop + a reusable tile grid, drawn once. */
  private drawWorld(): void {
    this.worldGraphics = this.add.graphics().setDepth(UI_DEPTH.world);

    this.stageLabel = makeText(this, '', { size: 'heading', bold: true, color: UI_THEME.css.text, align: 'center' });
    this.stageLabel.setOrigin(0.5, 0);
    this.worldHint = makeText(this, '', { size: 'micro', color: UI_THEME.css.textMuted, align: 'center' });
    this.worldHint.setOrigin(0.5, 0);
    this.debugHelp = makeText(this, 'F1 overlay · F2 coins · F3 gems · F4 unlock · F5 finish · F6 reset · 1 stage', {
      size: 'micro',
      color: UI_THEME.css.textMuted,
      align: 'center',
    });
    this.debugHelp.setOrigin(0.5, 0);
    if (!getGameContext(this).debug?.enabled) this.debugHelp.setVisible(false);

    const redraw = (handle: LayoutHandle): void => {
      this.layoutWorld(handle);
    };
    const unsubscribe = getGameContext(this).layout.onChange(redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    redraw(getGameContext(this).layout.handle);
  }

  private layoutWorld(handle: LayoutHandle): void {
    const frame = handle.metrics.frame;
    const systems = getGameContext(this).systems;
    const stageId = systems.progression.getCurrentStageId();
    const stage = systems.content.tryGetStage(stageId);

    this.worldGraphics.clear();

    // Ground plane + horizon.
    const horizon = frame.y + frame.height * 0.42;
    this.worldGraphics.fillStyle(PALETTE.surface, 1);
    this.worldGraphics.fillRect(frame.x, frame.y, frame.width, frame.height);
    this.worldGraphics.fillStyle(PALETTE.background, 1);
    this.worldGraphics.fillRect(frame.x, frame.y, frame.width, horizon - frame.y);

    // Grid drawn once per layout pass (not per frame).
    const tile = handle.px(96);
    this.worldGraphics.lineStyle(1, PALETTE.outline, 0.25);
    for (let x = frame.x; x <= frame.x + frame.width; x += tile) {
      this.worldGraphics.lineBetween(x, horizon, x, frame.y + frame.height);
    }
    for (let y = horizon; y <= frame.y + frame.height; y += tile / 2) {
      this.worldGraphics.lineBetween(frame.x, y, frame.x + frame.width, y);
    }
    this.worldGraphics.lineStyle(3, PALETTE.accent, 0.35);
    this.worldGraphics.lineBetween(frame.x, horizon, frame.x + frame.width, horizon);

    // Stage card: content-driven, so a new stage needs no code here.
    const titleY = frame.y + frame.height * 0.18;
    this.worldGraphics.fillStyle(PALETTE.surfaceAlt, 0.85);
    this.worldGraphics.fillRoundedRect(
      frame.x + handle.px(SPACING.lg),
      titleY - handle.px(SPACING.md),
      frame.width - handle.px(SPACING.lg * 2),
      handle.px(SPACING.xxl * 2.2),
      handle.px(RADIUS.lg),
    );

    this.stageLabel.setFontSize(handle.px(FONT_SIZE.heading));
    this.stageLabel.setPosition(frame.x + frame.width / 2, titleY);
    setTextIfChanged(this.stageLabel, stage?.displayName ?? 'Unknown stage');

    this.worldHint.setFontSize(handle.px(FONT_SIZE.micro));
    this.worldHint.setPosition(frame.x + frame.width / 2, titleY + handle.px(SPACING.xxl));
    setTextIfChanged(
      this.worldHint,
      stage?.description ?? 'No stage content registered',
    );

    this.debugHelp.setFontSize(handle.px(FONT_SIZE.micro));
    this.debugHelp.setPosition(frame.x + frame.width / 2, frame.y + frame.height * 0.42 + handle.px(SPACING.md));
  }

  // --- wiring --------------------------------------------------------------

  private wireInput(): void {
    // World gestures arrive as semantic events; the scene decides what they mean.
    this.inputSystem.on('tap', (gesture) => {
      if (this.ui.isOpen()) return; // never let a world tap fight with a modal
      const systems = getGameContext(this).systems;
      const stageId = systems.progression.getCurrentStageId();
      const buildings = systems.buildings.getBuildingsForStage(stageId);
      if (buildings.length === 0) {
        this.toastLayer.push('Input works — no buildings registered yet (Phase 0)', 'info');
        this.spawnTestCustomer(gesture.x, gesture.y);
        return;
      }
      // Phase 1: hit-test building entities here and select them.
      this.toastLayer.push('Select a building', 'info');
    });

    this.inputSystem.on('longPress', (gesture) => {
      if (this.ui.isOpen()) return;
      logger.debug('scene', `long press at ${gesture.x.toFixed(0)},${gesture.y.toFixed(0)}`);
      this.toastLayer.push('Long press recognised (reserved for future tooltips)', 'info');
      void gesture;
    });

    this.inputSystem.on('swipe', (gesture) => {
      if (this.ui.isOpen()) return;
      this.toastLayer.push(`Swipe ${gesture.direction} — stage scrolling lands in Phase 1`, 'info');
    });

    this.inputSystem.on('drag', () => {
      // Reserved for camera panning once stages are wider than the screen.
    });

    if (!getGameContext(this).debug) return;
    const debug = getGameContext(this).debug!;
    this.inputSystem.onAction('debug.toggleOverlay', () => {
      if (!this.debugOverlay) return;
      const visible = !this.debugOverlay.visible;
      this.debugOverlay.setVisible(visible);
      if (visible) this.debugOverlay.refreshNow();
    });
    this.inputSystem.onAction('debug.addCoins', () => {
      const granted = debug.addCoins(1000);
      this.toastLayer.push(`+${granted} coins (debug)`, 'warning');
    });
    this.inputSystem.onAction('debug.addGems', () => {
      const granted = debug.addGems(25);
      this.toastLayer.push(`+${granted} gems (debug)`, 'warning');
    });
    this.inputSystem.onAction('debug.unlockBuilding', () => {
      const unlocked = debug.unlockBuilding();
      this.toastLayer.push(unlocked ? `Unlocked ${unlocked}` : 'No locked buildings', 'warning');
    });
    this.inputSystem.onAction('debug.finishTimers', () => {
      const count = debug.finishTimers();
      this.toastLayer.push(`Finished ${count} timer(s)`, 'warning');
    });
    this.inputSystem.onAction('debug.unlockStage', () => {
      const ok = debug.unlockStage();
      this.toastLayer.push(ok ? 'Stage unlocked' : 'No locked stages', 'warning');
    });
    this.inputSystem.onAction('debug.resetSave', () => {
      debug.resetSave({ keepSettings: true });
      this.toastLayer.push('Save reset — reloading scene', 'error');
      this.scene.restart();
    });
  }

  private wireEvents(): void {
    const systems = getGameContext(this).systems;
    const subscriptions = [
      systems.events.on('upgrade:completed', ({ upgradeId }) => {
        this.toastLayer.push(`Upgrade complete: ${upgradeId}`, 'success');
      }),
      systems.events.on('building:tier-changed', ({ buildingId, tier }) => {
        this.toastLayer.push(`${buildingId} restored to tier ${tier}`, 'success');
      }),
      systems.events.on('building:income-accrued', () => {
        // Income is throttled through the economy event; no per-frame UI work.
      }),
      systems.events.on('offline:summary-ready', ({ coins }) => {
        this.toastLayer.push(`Offline income: ${formatCompactNumber(coins)} coins`, 'success');
      }),
      systems.events.on('economy:transaction-rejected', ({ currency, requested, reason }) => {
        logger.debug('scene', `rejected ${currency} transaction of ${requested} (${reason})`);
      }),
    ];

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      this.inputSystem.dispose();
      this.customers.dispose();
      this.ui.dispose();
    });
  }

  private spawnTestCustomer(x: number, y: number): void {
    const entity = this.customers.spawn(x, y, x, y + 60, 1400);
    if (!entity) return;
  }

  private requestRestore(buildingId: string): void {
    const systems = getGameContext(this).systems;
    const upgrades = systems.content.getBuildingUpgrades(buildingId as never);
    const next = upgrades.find((upgrade) => systems.upgrades.getStatus(upgrade.id) === 'available');
    if (!next) {
      this.toastLayer.push('Nothing to restore yet', 'warning');
      return;
    }
    const result = systems.upgrades.start(next.id);
    this.toastLayer.push(
      result.ok ? `Started ${next.displayName}` : `Cannot start: ${result.message ?? result.reason}`,
      result.ok ? 'success' : 'error',
    );
  }

  private requestAccelerate(buildingId: string): void {
    const systems = getGameContext(this).systems;
    const job = systems.upgrades.getActiveJobForBuilding(buildingId as never);
    if (!job) {
      this.toastLayer.push('Nothing in progress', 'warning');
      return;
    }
    const ok = systems.upgrades.accelerate(job.upgradeId);
    this.toastLayer.push(ok ? 'Upgrade finished instantly' : 'Not enough gems', ok ? 'success' : 'error');
  }

  private openPause(): void {
    if (this.pauseScreen) return;
    const systems = getGameContext(this).systems;

    this.pauseScreen = new PauseScreen(this, {
      services: this.services,
      onResume: () => this.closePause(),
      onOpenSettings: () => this.openSettings(),
      onExitToMenu: () => {
        systems.save.save('exit-to-menu');
        this.scene.start(SCENE_KEYS.mainMenu);
      },
    });
    this.ui.open(this.pauseScreen);
  }

  private closePause(): void {
    if (!this.pauseScreen) return;
    this.ui.close(this.pauseScreen);
    this.pauseScreen.destroy();
    this.pauseScreen = null;
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

  /** Right-click menu is a desktop annoyance during development. */
  private disableContextMenu(): void {
    this.input.mouse?.disableContextMenu();
  }
}
