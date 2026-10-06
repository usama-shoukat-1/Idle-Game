import { DisposableBag } from '@/core/Disposable';
import { logger } from '@/core/Logger';
import { SystemClock, type GameClock } from '@/core/Time';
import { EventBus } from '@/core/events/EventBus';
import { contentRegistry, type ContentRegistry } from '@/core/content/ContentRegistry';
import { DEFAULT_CONTENT } from '@/data';
import { FEATURE_FLAGS, MOCK_STORE_PRICES, STORE_CATALOG } from '@/config/content';
import { applyDevBalanceOverrides } from '@/config/balance';
import { createDefaultStorageDriver } from '@/services/storage/StorageDrivers';
import { MockRewardedAdService } from '@/services/monetization/MockRewardedAdService';
import { MockPurchaseService } from '@/services/monetization/MockPurchaseService';
import { WebAudioBackend } from '@/services/audio/WebAudioBackend';
import { SaveSystem } from '@/systems/SaveSystem/SaveSystem';
import { EconomySystem } from '@/systems/EconomySystem/EconomySystem';
import { TimerSystem } from '@/systems/TimerSystem/TimerSystem';
import { BuildingSystem } from '@/systems/BuildingSystem/BuildingSystem';
import { UpgradeSystem } from '@/systems/UpgradeSystem/UpgradeSystem';
import { OfflineIncomeSystem } from '@/systems/OfflineIncomeSystem/OfflineIncomeSystem';
import { ProgressionSystem } from '@/systems/ProgressionSystem/ProgressionSystem';
import { AdRewardSystem } from '@/systems/AdRewardSystem/AdRewardSystem';
import { PurchaseSystem } from '@/systems/PurchaseSystem/PurchaseSystem';
import { EventSystem } from '@/systems/EventSystem/EventSystem';
import { AudioSystem, NoopAudioBackend } from '@/systems/AudioSystem/AudioSystem';
import { BoostSystem } from '@/systems/BoostSystem/BoostSystem';
import { TutorialSystem } from '@/systems/TutorialSystem/TutorialSystem';
import { AnalyticsSystem, DevelopmentAnalyticsService } from '@/systems/AnalyticsSystem/AnalyticsSystem';
import type { GameState } from '@/core/types/state';
import type { StorageDriver } from '@/core/types/services';
import type { LoadResult, SaveResult } from '@/systems/SaveSystem/SaveSystem';

/**
 * COMPOSITION ROOT FOR SYSTEMS
 * ============================
 * One object owns the systems, their wiring and their lifetimes. Scenes receive this
 * container (via the game registry) instead of constructing systems themselves, which
 * is what keeps scene code thin and prevents duplicated system instances.
 *
 * Dependency direction is acyclic: clock/events -> storage/content -> save ->
 * economy/timers -> buildings -> upgrades -> offline/progression/monetization.
 */
/** Rewarded-ad placements the game offers. Named here so no scene uses a magic string. */
export const AD_PLACEMENTS = {
  /** Bottom restore panel: cut the running timer. */
  timeSkip: 'placement.upgrade_speedup',
  /** Coin button in the restore panel. */
  bonusCoins: 'placement.bonus_coins',
  /** Income boost button. */
  incomeBoost: 'placement.income_boost',
  /** Offline earnings popup: double the collected reward. */
  offlineDouble: 'placement.offline_double',
} as const;

export interface ServiceContainerOptions {
  readonly storage?: StorageDriver;
  readonly clock?: GameClock;
  readonly content?: ContentRegistry;
  readonly gameVersion?: string;
  /** Disable autosave timers / visibility hooks (tests). */
  readonly headless?: boolean;
}

export class ServiceContainer {
  private readonly bag = new DisposableBag();
  private loaded = false;

  readonly clock: GameClock;
  readonly events: EventBus;
  readonly content: ContentRegistry;
  readonly storage: StorageDriver;
  readonly save: SaveSystem;
  readonly timers: TimerSystem;
  readonly eventSystem: EventSystem;

  private _state: GameState | null = null;
  private _economy: EconomySystem | null = null;
  private _buildings: BuildingSystem | null = null;
  private _upgrades: UpgradeSystem | null = null;
  private _offline: OfflineIncomeSystem | null = null;
  private _progression: ProgressionSystem | null = null;
  private _ads: AdRewardSystem | null = null;
  private _purchases: PurchaseSystem | null = null;
  private _audio: AudioSystem | null = null;
  private _boosts: BoostSystem | null = null;
  private _tutorial: TutorialSystem | null = null;
  private _analytics: AnalyticsSystem | null = null;
  private _rewardedAds: MockRewardedAdService | null = null;
  private _mockStore: MockPurchaseService | null = null;

  constructor(private readonly options: ServiceContainerOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.events = new EventBus();
    this.content = options.content ?? contentRegistry;

    if (!this.content.isLoaded) {
      this.content.load(DEFAULT_CONTENT);
      if (FEATURE_FLAGS.debugTools) applyDevBalanceOverrides(this.content);
    }

    this.storage = options.storage ?? createDefaultStorageDriver();
    this.eventSystem = new EventSystem(this.events, this.clock);
    this.timers = new TimerSystem(this.clock);

    this.save = new SaveSystem({
      storage: this.storage,
      content: this.content,
      clock: this.clock,
      gameVersion: this.options.gameVersion ?? '0.1.0',
      autosaveIntervalMs: options.headless ? 0 : undefined,
      handleVisibility: !options.headless,
    });
    this.bag.addDisposable(this.save);
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  get state(): GameState {
    if (!this._state) throw new Error('ServiceContainer.load() must be called before using systems');
    return this._state;
  }

  get economy(): EconomySystem {
    if (!this._economy) throw new Error('ServiceContainer.load() must be called before using systems');
    return this._economy;
  }

  get buildings(): BuildingSystem {
    if (!this._buildings) throw new Error('ServiceContainer.load() must be called before using systems');
    return this._buildings;
  }

  get upgrades(): UpgradeSystem {
    if (!this._upgrades) throw new Error('ServiceContainer.load() must be called before using systems');
    return this._upgrades;
  }

  get offline(): OfflineIncomeSystem {
    if (!this._offline) throw new Error('ServiceContainer.load() must be called before using systems');
    return this._offline;
  }

  get progression(): ProgressionSystem {
    if (!this._progression) throw new Error('ServiceContainer.load() must be called before using systems');
    return this._progression;
  }

  get ads(): AdRewardSystem {
    if (!this._ads) throw new Error('ServiceContainer.load() must be called before using systems');
    return this._ads;
  }

  get purchases(): PurchaseSystem {
    if (!this._purchases) throw new Error('ServiceContainer.load() must be called before using systems');
    return this._purchases;
  }

  get audio(): AudioSystem {
    if (!this._audio) throw new Error('ServiceContainer.load() must be called before using systems');
    return this._audio;
  }

  get boosts(): BoostSystem {
    if (!this._boosts) throw new Error('ServiceContainer.load() must be called before using systems');
    return this._boosts;
  }

  get tutorial(): TutorialSystem {
    if (!this._tutorial) throw new Error('ServiceContainer.load() must be called before using systems');
    return this._tutorial;
  }

  get analytics(): AnalyticsSystem {
    if (!this._analytics) throw new Error('ServiceContainer.load() must be called before using systems');
    return this._analytics;
  }

  /**
   * The development ad/store providers. Exposed so debug tooling can switch them on and
   * off during QA; gameplay reads them through AdRewardSystem/PurchaseSystem only.
   */
  get devProviders(): {
    readonly ads: MockRewardedAdService | null;
    readonly store: MockPurchaseService | null;
  } {
    return { ads: this._rewardedAds, store: this._mockStore };
  }

  /**
   * Boots the game: load (or create) the save, then build every system around the
   * loaded state. Safe to call once; repeated calls return the previous result.
   */
  load(): LoadResult {
    if (this.loaded && this._state) {
      return { state: this._state, status: 'loaded', issues: [], migratedFrom: null };
    }

    const result = this.save.load();
    const state = result.state;
    this._state = state;

    this._economy = new EconomySystem(state, this.content, this.events, this.clock);
    this._boosts = new BoostSystem(state, this.events, this.clock);
    this._buildings = new BuildingSystem(
      state,
      this.content,
      this._economy,
      this._boosts,
      this.events,
      this.clock,
    );
    this._upgrades = new UpgradeSystem(
      state,
      this.content,
      this._economy,
      this.timers,
      this._buildings,
      this.events,
      this.clock,
    );
    this._offline = new OfflineIncomeSystem(
      state,
      this.content,
      this._buildings,
      this._economy,
      this.events,
      this.clock,
    );
    this._progression = new ProgressionSystem(state, this.content, this._economy, this._buildings, this.events);
    // Development providers. Both are opt-in by construction: the ad service only ever
    // responds to an explicit player tap, and the store only grants what the catalog says.
    this._rewardedAds = new MockRewardedAdService({ knownPlacements: Object.values(AD_PLACEMENTS) });
    this._mockStore = new MockPurchaseService({
      products: STORE_CATALOG.map((entry) => ({
        productId: entry.productId,
        displayName: entry.displayName,
        description: entry.description,
        localizedPrice: MOCK_STORE_PRICES[entry.productId] ?? 'mock',
        kind: entry.kind,
      })),
    });

    this._ads = new AdRewardSystem(
      this.content,
      this._economy,
      this._upgrades,
      this._boosts,
      this._offline,
      this.events,
      this.clock,
      this._rewardedAds,
    );
    this._purchases = new PurchaseSystem(this._economy, this._mockStore, this.events, STORE_CATALOG);
    this._tutorial = new TutorialSystem(state, this.content, this.events);
    this._analytics = new AnalyticsSystem(this.events, new DevelopmentAnalyticsService());
    this._audio = new AudioSystem(
      state,
      this.events,
      this.options.headless ? new NoopAudioBackend() : new WebAudioBackend(),
    );

    this.wireAutosaveTriggers();
    this.loaded = true;

    logger.info('core', `services ready (schema ${state.schemaVersion}, save status "${result.status}")`);
    return result;
  }

  /** Persists through SaveSystem. Scenes/systems call this instead of touching storage. */
  requestSave(reason = 'manual'): SaveResult {
    return this.save.save(reason);
  }

  /** Full teardown: systems, timers and DOM listeners. Used on game destroy/tests. */
  dispose(): void {
    this._analytics?.dispose();
    this._audio?.dispose();
    this.eventSystem.dispose();
    this.timers.dispose();
    this.events.removeAll();
    this.bag.dispose();
    this.loaded = false;
    this._state = null;
  }

  /**
   * Any meaningful state change marks the save dirty; the SaveSystem's autosave timer
   * and visibility hooks then do the actual writing. This is cheaper (and less
   * error-prone) than sprinkling `save()` calls through gameplay code.
   */
  private wireAutosaveTriggers(): void {
    const markDirty = (): void => this.save.markDirty();
    const subscriptions = [
      this.events.on('economy:coins-changed', markDirty),
      this.events.on('economy:gems-changed', markDirty),
      this.events.on('upgrade:started', markDirty),
      this.events.on('upgrade:completed', markDirty),
      this.events.on('building:unlocked', markDirty),
      this.events.on('building:tier-changed', markDirty),
      this.events.on('stage:unlocked', markDirty),
      this.events.on('mastery:changed', markDirty),
      // Boosts and the pending offline reward are part of the save too.
      this.events.on('boost:applied', markDirty),
      this.events.on('offline:summary-ready', markDirty),
      this.events.on('offline:collected', markDirty),
    ];
    for (const unsubscribe of subscriptions) this.bag.add(unsubscribe);
  }
}
