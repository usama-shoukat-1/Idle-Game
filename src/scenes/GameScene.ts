import Phaser from 'phaser';

import { logger } from '@/core/Logger';
import { PALETTE } from '@/core/constants/Layout';
import { SCENE_KEYS, UI_DEPTH } from '@/core/constants/GameConstants';
import { getGameContext } from '@/core/GameContext';
import { AD_PLACEMENTS, type ServiceContainer } from '@/core/ServiceContainer';
import { FEATURE_FLAGS } from '@/config/content';
import { formatCompactNumber } from '@/core/events/EventBus';
import type { BuildingDefinition } from '@/core/types/content';
import { upgradeId as asUpgradeId, type BuildingId } from '@/core/types/primitives';
import { createUiServices, type UiServices } from '@/ui/UiServices';
import { LazyPopupHost, UiRoot } from '@/ui/UiRoot';
import { HudScreen } from '@/ui/screens/HudScreen';
import { PauseScreen } from '@/ui/screens/PauseScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { RestorePanel, type RestorePanelState } from '@/ui/panels/RestorePanel';
import { TutorialBanner } from '@/ui/panels/TutorialBanner';
import { ToastLayer } from '@/ui/components/ToastLayer';
import { CafeIllustration, CAFE_ART_SIZE } from '@/ui/art/CafeIllustration';
import { CoinFeedback } from '@/ui/effects/CoinFeedback';
import { CustomerVisitors } from '@/ui/effects/CustomerVisitors';
import { OfflineEarningsPopup } from '@/ui/popups/OfflineEarningsPopup';
import { GemShopPopup } from '@/ui/popups/GemShopPopup';
import { CafeCompletePopup } from '@/ui/popups/CafeCompletePopup';
import { DebugOverlay } from '@/debug/DebugOverlay';
import { InputSystem } from '@/systems/InputSystem/InputSystem';
import type { LayoutHandle } from '@/ui/layout/LayoutService';

/**
 * GAME SCENE - the Old Café (Phase 1 vertical slice)
 * ==================================================
 * The playable screen. It is a *presentation and orchestration* layer: it renders the
 * building, forwards player intents to the systems and reacts to domain events. It never
 * mutates the wallet, never computes balance numbers and never persists anything itself.
 *
 * Responsibilities
 * ----------------
 *  - draw the café illustration and advance its visual state with the restoration tier
 *  - accrue income on a 1 Hz *timestamp-driven* cadence (frames only decide *when to ask*)
 *  - host the HUD, restore panel, tutorial banner, popups and debug overlay
 *  - run the optional rewarded-ad and gem-acceleration flows through the systems
 *
 * Performance (mobile first)
 * -------------------------
 *  - income accrual and UI refresh are throttled (1 Hz / 4 Hz), never per frame
 *  - the café is drawn once per tier change (visibility flips, no texture work)
 *  - customers and coin pops are pooled and capped
 *  - the illustration is created once and only repositioned on layout changes
 */
export class GameScene extends Phaser.Scene {
  private services!: UiServices;
  private systems!: ServiceContainer;
  private ui!: UiRoot;
  private hud!: HudScreen;
  private restorePanel!: RestorePanel;
  private tutorialBanner!: TutorialBanner;
  private toastLayer!: ToastLayer;
  private debugOverlay: DebugOverlay | null = null;
  private pauseScreen: PauseScreen | null = null;
  private settingsScreen: SettingsScreen | null = null;
  private shops: GemShopPopup | null = null;
  private offlinePopup: OfflineEarningsPopup | null = null;
  private completionShown = false;

  private illustration!: CafeIllustration;
  private coinFeedback!: CoinFeedback;
  private customers!: CustomerVisitors;
  private inputSystem!: InputSystem;

  private building!: BuildingDefinition;
  private buildingId!: BuildingId;

  /**
   * The building this scene plays. Content decides: the first building of the current
   * stage (Phase 1 has exactly one). Nothing here names the café, so opening the next
   * location is a data change.
   */
  private resolveFocusBuilding(): BuildingDefinition {
    const stageId = this.systems.progression.getCurrentStageId();
    const inStage = this.systems.content.getStageBuildings(stageId);
    const candidate = inStage[0] ?? this.systems.content.getAllBuildings()[0];
    if (!candidate) {
      throw new Error('GameScene requires at least one registered building in content');
    }
    return candidate;
  }

  private incomeAccumulatorMs = 0;
  private refreshAccumulatorMs = 0;
  private unsubscribe: Array<() => void> = [];

  constructor() {
    super(SCENE_KEYS.game);
  }

  create(): void {
    const context = getGameContext(this);
    this.systems = context.systems;
    this.cameras.main.setBackgroundColor(PALETTE.background);

    // --- which building are we playing? (content-driven: first building of the stage) ---
    this.building = this.resolveFocusBuilding();
    this.buildingId = this.building.id;
    this.systems.buildings.ensureRuntime(this.buildingId);
    if (!this.systems.buildings.isUnlocked(this.buildingId)) {
      // `startsUnlocked` content is owned from the first session; this is the safety net
      // for an older save that predates the building's registration.
      this.systems.buildings.unlock(this.buildingId, 'scene-entry');
    }

    this.drawBackdrop();

    // --- world: café illustration + feedback layers ---------------------------------
    const worldScale = this.worldScale();
    const layout = context.layout.metrics;

    this.illustration = new CafeIllustration({ scene: this, depth: 10 });
    this.illustration.setScale(worldScale);
    this.illustration.setPosition(layout.frame.x + layout.frame.width / 2, layout.frame.y + layout.frame.height * 0.42);
    this.illustration.setTier(this.systems.buildings.getTier(this.buildingId), false);

    this.coinFeedback = new CoinFeedback({ scene: this, size: 4 });
    this.customers = new CustomerVisitors({ scene: this, maxActive: 3 });

    // --- UI -------------------------------------------------------------------------
    this.services = createUiServices(this.systems, context.layout, new LazyPopupHost(() => this.ui));
    this.ui = new UiRoot(this, this.services);

    this.hud = new HudScreen(this, {
      services: this.services,
      onMenuPress: () => this.openPause(),
      onGemsPress: () => this.openShop(),
    });

    this.restorePanel = new RestorePanel(this, {
      callbacks: {
        onRestore: () => this.startNextRestoration(),
        onGemFinish: () => void this.finishWithGems(),
        onSpeedUpAd: () => void this.watchAd('timeSkip'),
        onBonusCoinsAd: () => void this.watchAd('coins'),
        onIncomeBoostAd: () => void this.watchAd('incomeMultiplier'),
      },
    });

    this.tutorialBanner = new TutorialBanner(this, {
      onAcknowledge: () => this.systems.tutorial.acknowledge(),
      onSkip: () => {
        this.systems.tutorial.skip();
        this.systems.requestSave('tutorial-skip');
      },
    });

    this.ui.mount(this.hud, UI_DEPTH.panels + 10);
    this.ui.mount(this.restorePanel, UI_DEPTH.panels + 20);
    this.ui.mount(this.tutorialBanner, UI_DEPTH.panels + 40);

    this.toastLayer = new ToastLayer(this, { events: this.systems.events, clock: this.systems.clock });
    this.ui.mount(this.toastLayer, UI_DEPTH.toasts);

    // --- input ----------------------------------------------------------------------
    // Debug shortcuts exist only when the build ships debug tools: a release build binds
    // no F-keys at all and registers no cheat handlers.
    const debugTools = context.debug;
    this.inputSystem = new InputSystem(this, {
      debugKeys: debugTools
        ? {
            F1: 'debug.toggleOverlay',
            F2: 'debug.addCoins',
            F3: 'debug.addGems',
            F4: 'debug.cycleTier',
            F5: 'debug.instantUpgrade',
            F6: 'debug.resetSave',
            F7: 'debug.simulateOffline',
            F8: 'debug.toggleAds',
            F9: 'debug.advanceTime',
            F10: 'debug.toggleStore',
          }
        : undefined,
    });
    this.wireInput(Boolean(debugTools));

    if (context.debug) {
      this.debugOverlay = new DebugOverlay(this, { tools: context.debug, clock: this.systems.clock });
      this.ui.mount(this.debugOverlay, UI_DEPTH.debug);
      this.debugOverlay.setVisible(false);
    }

    this.wireEvents();
    this.refreshUi(0);

    // Tutorial + offline summary are shown once the screen exists, so the player sees the
    // café before either of them appears.
    this.showTutorialStep();
    this.presentOfflineEarnings();

    // Entering the level is a save point: it pins `lastSaveAt` for offline maths.
    this.systems.requestSave('scene-entry');
    this.audio('sfx/tap');
    this.ui.refreshLayout();
    logger.info('scene', `game scene ready (${this.building.id})`);
  }

  // -------------------------------------------------------------------------
  // Frame loop - throttled, timestamp-driven
  // -------------------------------------------------------------------------

  override update(_time: number, delta: number): void {
    // Income: ask the system at most once a second. The *maths* is timestamp based, so a
    // dropped frame or a throttled background tab changes nothing about what is earned.
    this.incomeAccumulatorMs += delta;
    if (this.incomeAccumulatorMs >= 1_000) {
      this.incomeAccumulatorMs %= 1_000;
      this.accrueIncome();
    }

    // UI refresh at 4 Hz: timers and labels stay smooth without touching text per frame.
    this.refreshAccumulatorMs += delta;
    if (this.refreshAccumulatorMs >= 250) {
      const elapsed = this.refreshAccumulatorMs;
      this.refreshAccumulatorMs = 0;
      this.refreshUi(elapsed);
    }

    // Customers exist purely to make the café feel alive (never part of the economy).
    this.customers.update(delta, this.customerIntensity(), this.customerAnchors());
  }

  private accrueIncome(): void {
    const result = this.systems.buildings.accrueIncome(this.buildingId, { reason: 'building.income' });
    if (result.coins <= 0) return;

    const anchor = this.illustration.roofAnchor;
    const scale = this.worldScale();
    this.coinFeedback.pop(
      this.illustration.x + anchor.x * scale,
      this.illustration.y + anchor.y * scale,
      result.coins,
    );
    this.audio('sfx/coin', 0.5);
  }

  /** 0 = nobody, 1 = busy: driven by the restoration tier, not by customer count. */
  private customerIntensity(): number {
    const tier = this.systems.buildings.getTier(this.buildingId);
    if (tier < 4) return 0; // not open for business yet
    return Math.min(1, (tier - 3) / 6);
  }

  private customerAnchors(): { entry: { x: number; y: number }; stand: { x: number; y: number }; exit: { x: number; y: number } } {
    const scale = this.worldScale();
    const originX = this.illustration.x;
    const originY = this.illustration.y;
    const door = this.illustration.doorAnchor;
    const halfWidth = this.scale.width / 2;

    return {
      entry: { x: halfWidth + 40, y: originY + door.y * scale },
      stand: { x: originX + door.x * scale, y: originY + door.y * scale },
      exit: { x: -60, y: originY + (door.y + 8) * scale },
    };
  }

  /** Pixels per design unit for the world layer (mirrors the UI root's scaling). */
  private worldScale(): number {
    const metrics = getGameContext(this).layout.metrics;
    return metrics.scale * 0.86;
  }

  // -------------------------------------------------------------------------
  // Player actions (all of them go through a system)
  // -------------------------------------------------------------------------

  private startNextRestoration(): void {
    const next = this.nextUpgrade();
    if (!next) {
      this.toast('Nothing left to restore here', 'info');
      return;
    }

    const check = this.systems.upgrades.canStart(next.id);
    if (!check.ok) {
      this.toast(check.message ?? 'Not available yet', 'warning');
      this.audio('sfx/error');
      return;
    }

    const result = this.systems.upgrades.start(next.id);
    if (!result.ok) {
      this.toast(result.message ?? 'Could not start', 'warning');
      this.audio('sfx/error');
      return;
    }

    this.audio('sfx/upgrade_start');
    this.systems.requestSave('upgrade-start'); // explicit save: the timer must survive a reload
    this.refreshUi(0);
  }

  private async finishWithGems(): Promise<void> {
    const job = this.systems.upgrades.getPrimaryActiveJob();
    if (!job) return;

    const cost = this.systems.upgrades.getAccelerationCost(job.upgradeId);
    if (!cost || !this.systems.economy.canAfford(cost)) {
      this.toast(`Needs ${cost?.amount ?? 0} gems — opening the shop`, 'info');
      this.openShop();
      return;
    }

    if (this.systems.upgrades.accelerate(job.upgradeId)) {
      this.audio('sfx/upgrade_complete');
      this.toast(`Finished instantly for ${cost.amount} gems`, 'success');
      this.systems.requestSave('gem-finish');
      this.refreshUi(0);
    }
  }

  /** Rewarded ads: always opt-in, always labelled with the reward, never auto-played. */
  private async watchAd(kind: 'timeSkip' | 'coins' | 'incomeMultiplier'): Promise<void> {
    if (!FEATURE_FLAGS.rewardedAds) {
      this.toast('Rewarded ads are disabled in this build', 'info');
      return;
    }

    const reward = this.systems.ads.findOffered(kind);
    if (!reward) {
      this.toast('Not available right now', 'warning');
      return;
    }

    const placement =
      kind === 'timeSkip'
        ? AD_PLACEMENTS.timeSkip
        : kind === 'coins'
          ? AD_PLACEMENTS.bonusCoins
          : AD_PLACEMENTS.incomeBoost;

    const outcome = await this.systems.ads.requestReward({ placementId: placement, rewardId: reward.id });
    if (outcome.status === 'granted') {
      this.audio('sfx/ad_reward');
      this.toast(outcome.message, 'success');
      this.systems.requestSave(`ad-${reward.id}`);
    } else {
      this.toast(outcome.message, 'warning');
    }
    this.refreshUi(0);
  }

  private openShop(): void {
    if (!FEATURE_FLAGS.purchases || this.shops) return;

    const shop = new GemShopPopup(this, {
      catalog: this.systems.purchases.getCatalog(),
      providerName: this.systems.purchases.providerName,
      isMock: this.systems.purchases.providerName === 'mock',
      gemsOwned: () => this.systems.economy.getGems(),
      priceLabel: (productId) => this.systems.purchases.getLocalizedPrice(productId),
      onPurchase: async (productId) => {
        const outcome = await this.systems.purchases.purchase(productId);
        if (outcome.status === 'completed') {
          this.audio('sfx/purchase');
          return `+${formatCompactNumber(outcome.grantedGems)} gems (mock purchase)`;
        }
        this.audio('sfx/error');
        return `Purchase ${outcome.status}: ${outcome.message}`;
      },
    });
    this.shops = shop;
    this.ui.open(shop);
  }

  private openPause(): void {
    if (this.pauseScreen) return;
    this.pauseScreen = new PauseScreen(this, {
      services: this.services,
      onResume: () => this.closePause(),
      onOpenSettings: () => this.openSettings(),
      onExitToMenu: () => {
        this.systems.requestSave('exit-to-menu');
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

  // -------------------------------------------------------------------------
  // Domain events -> presentation
  // -------------------------------------------------------------------------

  private wireEvents(): void {
    const events = this.systems.events;

    this.unsubscribe = [
      events.on('building:tier-changed', ({ buildingId, tier }) => {
        if (buildingId !== this.buildingId) return;
        this.illustration.setTier(tier);
        this.audio('sfx/upgrade_complete');
        this.refreshUi(0);
      }),

      events.on('building:completed', ({ buildingId, incomePerMinute, totalCost }) => {
        if (buildingId !== this.buildingId || this.completionShown) return;
        this.completionShown = true;
        this.illustration.setTier(this.systems.buildings.getMaxTier(this.buildingId));
        this.showCompletion(incomePerMinute, totalCost);
      }),

      events.on('upgrade:completed', ({ upgradeId, buildingId }) => {
        if (buildingId !== this.buildingId) return;
        const definition = this.systems.content.tryGetUpgrade(asUpgradeId(upgradeId));
        if (definition) this.toast(`${definition.displayName} — done`, 'success');
      }),

      events.on('tutorial:step', () => this.showTutorialStep()),
      events.on('tutorial:completed', () => this.tutorialBanner.setVisible(false)),

      events.on('offline:summary-ready', ({ coins, elapsedMs }) => {
        logger.debug('scene', `offline: ${coins} coins over ${Math.round(elapsedMs / 1000)}s`);
      }),
    ];
  }

  private showTutorialStep(): void {
    const step = this.systems.tutorial.currentStep;
    if (!step) {
      this.tutorialBanner.setVisible(false);
      return;
    }
    const index = this.systems.tutorial.currentIndex;
    this.tutorialBanner.show(
      { message: step.message, detail: step.detail, index, total: this.systems.tutorial.total },
      { requireAcknowledge: Boolean(step.requireAcknowledge) },
    );
  }

  private presentOfflineEarnings(): void {
    const pending = this.systems.offline.getPending();
    if (!pending || pending.coins <= 0 || this.offlinePopup) return;

    const balance = this.systems.content.getEconomyBalance();
    const reward = this.systems.ads.findOffered('offlineBoost');

    const popup = new OfflineEarningsPopup(this, {
      pending,
      capMs: balance.offline.maxDurationMs,
      onWatchAd: async () => {
        if (!reward || !FEATURE_FLAGS.rewardedAds) return pending.coins;
        // The ad is requested through the system; the *grant* doubles the pending reward,
        // which is why it can never be collected twice.
        const outcome = await this.systems.ads.requestReward({
          placementId: AD_PLACEMENTS.offlineDouble,
          rewardId: reward.id,
        });
        if (outcome.status !== 'granted') {
          this.toast(outcome.message, 'warning');
          return this.systems.offline.getPending()?.coins ?? pending.coins;
        }
        this.audio('sfx/ad_reward');
        this.systems.requestSave('offline-boost');
        return this.systems.offline.getPending()?.coins ?? pending.coins;
      },
      onCollect: () => {
        const granted = this.systems.offline.collect();
        this.audio('sfx/offline_reward');
        this.toast(`+${formatCompactNumber(granted)} coins collected`, 'success');
        this.systems.requestSave('offline-collect');
        this.refreshUi(0);
      },
      onDismiss: (coins) => {
        // Safety net so a stray dismissal can never lose the player's offline earnings.
        if (coins > 0) this.systems.offline.collect();
        this.refreshUi(0);
      },
    });

    this.offlinePopup = popup;
    this.ui.open(popup);
  }

  private showCompletion(incomePerMinute: number, totalCost: number): void {
    this.audio('sfx/building_complete');
    const spent = this.systems.state.analytics.totalCoinsSpent;

    // Completion percentage is derived from content, never hard-coded: how many of this
    // building's restoration steps the player has actually finished.
    const upgrades = this.systems.content.getBuildingUpgrades(this.buildingId);
    const completed = upgrades.filter((upgrade) => this.systems.upgrades.isCompleted(upgrade.id)).length;
    const completionPercent = Math.round((completed / Math.max(1, upgrades.length)) * 100);

    const popup = new CafeCompletePopup(this, {
      buildingName: this.building.displayName,
      finalIncomePerMinute: incomePerMinute,
      totalRestorationCost: totalCost,
      totalSpent: spent,
      completionPercent,
      onClose: () => {
        this.completionShown = true;
      },
    });
    this.ui.open(popup);
  }

  // -------------------------------------------------------------------------
  // UI refresh (throttled) + helpers
  // -------------------------------------------------------------------------

  private refreshUi(_elapsedMs: number): void {
    const buildings = this.systems.buildings;
    const upgrades = this.systems.upgrades;
    const economy = this.systems.economy;
    const tier = buildings.getTier(this.buildingId);
    const maxTier = buildings.getMaxTier(this.buildingId);
    const incomePerMinute = Math.round(buildings.getIncomePerSecond(this.buildingId) * 60);
    const next = this.nextUpgrade();
    const job = upgrades.getActiveJobForBuilding(this.buildingId);

    const boostMultiplier = this.systems.boosts.getIncomeMultiplier(this.buildingId);
    this.hud.setBusinessName(
      tier >= maxTier
        ? `${this.building.displayName} · RESTORED`
        : `${this.building.displayName} · Tier ${tier} / ${maxTier}`,
    );
    this.hud.setIncomePerSecond(
      buildings.getIncomePerSecond(this.buildingId),
      boostMultiplier > 1 ? `  (${boostMultiplier}× active)` : '',
    );

    const speedUpReward = this.systems.ads.findOffered('timeSkip');
    const bonusReward = this.systems.ads.findOffered('coins');
    const boostReward = this.systems.ads.findOffered('incomeMultiplier');

    const state: RestorePanelState = {
      building: this.building,
      tier,
      maxTier,
      incomePerMinute,
      nextUpgrade: next,
      nextIncomePerMinute: next ? buildings.predictIncomePerMinute(this.buildingId, next.tier) : incomePerMinute,
      activeJob: job
        ? {
            displayName:
              this.systems.content.tryGetUpgrade(job.upgradeId)?.displayName ?? 'Restoration',
            remainingMs: upgrades.getRemainingMs(job.upgradeId),
            progress: upgrades.getProgress(job.upgradeId),
          }
        : null,
      gemCost: job ? (upgrades.getAccelerationCost(job.upgradeId)?.amount ?? null) : null,
      coins: economy.getCoins(),
      speedUpAd: job && speedUpReward
        ? {
            label: speedUpReward.actionLabel ?? 'WATCH AD → SPEED UP',
            seconds: Math.round(this.systems.ads.previewAmount(speedUpReward.id) / 1000),
            enabled: FEATURE_FLAGS.rewardedAds,
          }
        : null,
      bonusCoinsAd: bonusReward
        ? {
            label: bonusReward.actionLabel ?? 'WATCH AD → BONUS COINS',
            coins: this.systems.ads.previewAmount(bonusReward.id),
            enabled: FEATURE_FLAGS.rewardedAds,
          }
        : null,
      incomeBoostAd: boostReward
        ? { label: boostReward.actionLabel ?? 'WATCH AD → 2× INCOME', enabled: FEATURE_FLAGS.rewardedAds }
        : null,
    };

    this.restorePanel.applyState(state);
    this.restorePanel.setVisible(true);

    if (this.debugOverlay?.visible) {
      this.debugOverlay.refresh();
    }
  }

  private nextUpgrade() {
    const upgrades = this.systems.content.getBuildingUpgrades(this.buildingId);
    const tier = this.systems.buildings.getTier(this.buildingId);
    return (
      upgrades.find((upgrade) => upgrade.tier === tier + 1) ??
      upgrades.find((upgrade) => !this.systems.upgrades.isCompleted(upgrade.id)) ??
      null
    );
  }

  private toast(message: string, variant: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    this.systems.events.emit('ui:toast', { message, variant });
  }

  private audio(key: string, volume?: number): void {
    this.systems.events.emit('audio:play', { key, volume });
  }

  private drawBackdrop(): void {
    const graphics = this.add.graphics().setDepth(0);
    const redraw = (handle: LayoutHandle): void => {
      const frame = handle.metrics.frame;
      graphics.clear();
      // Warm dusk gradient behind the café: sky at the top, warm street light at the base.
      const steps = 18;
      for (let i = 0; i < steps; i += 1) {
        const t = i / (steps - 1);
        const colour = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(PALETTE.background),
          Phaser.Display.Color.ValueToColor(0x3a2f3c),
          1,
          t,
        );
        graphics.fillStyle(Phaser.Display.Color.GetColor(colour.r, colour.g, colour.b), 1);
        graphics.fillRect(frame.x, frame.y + (frame.height / steps) * i, frame.width, frame.height / steps + 1);
      }
      graphics.fillStyle(0x000000, 0.18);
      graphics.fillRect(frame.x, frame.y, frame.width, 96);
    };

    redraw(getGameContext(this).layout.handle);
    const unsubscribe = getGameContext(this).layout.onChange((handle) => {
      redraw(handle);
      this.layoutWorld();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  }

  private layoutWorld(): void {
    if (!this.illustration) return;
    const metrics = getGameContext(this).layout.metrics;
    const scale = this.worldScale();
    this.illustration.setScale(scale);
    this.illustration.setPosition(
      metrics.frame.x + metrics.frame.width / 2,
      metrics.frame.y + metrics.frame.height * 0.42,
    );
  }

  private wireInput(withDebugKeys: boolean): void {
    // Gestures arrive through the InputSystem, never as raw pointer events.
    this.inputSystem.on('tap', ({ x, y }) => {
      const door = this.illustration.doorAnchor;
      const scale = this.worldScale();
      const hitRadius = (CAFE_ART_SIZE.width / 2) * scale;
      if (Math.abs(x - this.illustration.x) > hitRadius) return;
      if (Math.abs(y - (this.illustration.y + door.y * scale)) > hitRadius) return;
      this.tapCafe();
    });

    if (!withDebugKeys) return;

    // Debug shortcuts become logical actions; the scene decides what each one does.
    // Release builds never reach this point, so no cheat handler even exists there.
    const actions: Readonly<Record<string, () => void>> = {
      'debug.toggleOverlay': () => this.debugOverlay?.toggle(),
      'debug.addCoins': () => {
        this.getDebug()?.addCoins();
        this.refreshUi(0);
      },
      'debug.addGems': () => {
        this.getDebug()?.addGems();
        this.refreshUi(0);
      },
      // F4 walks the café through every visual state (wrap-around), which is how the tier
      // art is reviewed in-game.
      'debug.cycleTier': () => {
        const debug = this.getDebug();
        if (!debug) return;
        const current = this.systems.buildings.getTier(this.buildingId);
        const maxTier = this.systems.buildings.getMaxTier(this.buildingId);
        const next = current >= maxTier ? 0 : current + 1;
        debug.setBuildingTier(this.buildingId, next);
        // `setBuildingTier` emits tier-changed, but re-applying is harmless and covers the
        // wrap-to-0 case where the tier is unchanged.
        this.illustration.setTier(next);
        this.toast(`Café tier ${next} / ${maxTier}`, 'info');
        this.refreshUi(0);
      },
      'debug.instantUpgrade': () => {
        const debug = this.getDebug();
        if (!debug) return;
        const finished = debug.finishTimers();
        this.illustration.setTier(this.systems.buildings.getTier(this.buildingId));
        this.toast(finished > 0 ? `${finished} upgrade(s) finished` : 'Nothing in progress', 'info');
        this.refreshUi(0);
      },
      'debug.resetSave': () => {
        this.getDebug()?.resetSave();
        this.refreshUi(0);
      },
      'debug.simulateOffline': () => {
        this.getDebug()?.simulateOffline();
        this.presentOfflineEarnings();
      },
      'debug.toggleAds': () => {
        const enabled = this.getDebug()?.toggleMockAds() ?? false;
        this.toast(`Mock ads ${enabled ? 'enabled' : 'disabled'}`, 'info');
      },
      'debug.advanceTime': () => {
        this.getDebug()?.advanceTime(60_000);
        this.refreshUi(0);
      },
      'debug.toggleStore': () => {
        const enabled = this.getDebug()?.toggleMockPurchases() ?? false;
        this.toast(`Mock store ${enabled ? 'enabled' : 'disabled'}`, 'info');
      },
    };
    for (const [action, handler] of Object.entries(actions)) {
      this.inputSystem.onAction(action, handler);
    }
  }

  /** Tapping the café is a pure easter egg: it never grants currency. */
  private tapCafe(): void {
    this.audio('sfx/tap', 0.4);
    const scale = this.worldScale();
    this.tweens.add({
      targets: this.illustration,
      scale: { from: scale * 0.985, to: scale },
      duration: 180,
      ease: 'Quad.easeOut',
    });
    if (this.systems.tutorial.currentStep) this.systems.tutorial.acknowledge('tapped-cafe');
  }

  private getDebug() {
    return getGameContext(this).debug;
  }

  /**
   * Scene teardown. Phaser calls this on shutdown (and on a scene restart), which is the
   * only correct place to release listeners and pooled objects.
   */
  shutdown(): void {
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.unsubscribe = [];
    this.customers?.destroy();
    this.coinFeedback?.destroy();
    this.illustration?.destroy();
    this.inputSystem?.dispose();
    this.ui?.dispose();
  }
}
