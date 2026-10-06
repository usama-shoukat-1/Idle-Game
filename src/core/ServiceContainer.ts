import { DisposableBag } from '@/core/Disposable';
import { logger } from '@/core/Logger';
import { SystemClock, type GameClock } from '@/core/Time';
import { EventBus } from '@/core/events/EventBus';
import { contentRegistry, type ContentRegistry } from '@/core/content/ContentRegistry';
import { DEFAULT_CONTENT } from '@/data';
import { FEATURE_FLAGS, STORE_CATALOG } from '@/config/content';
import { applyDevBalanceOverrides } from '@/config/balance';
import { createDefaultStorageDriver } from '@/services/storage/StorageDrivers';
import { MockRewardedAdService } from '@/services/monetization/MockRewardedAdService';
import { MockPurchaseService } from '@/services/monetization/MockPurchaseService';
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
import { AudioSystem } from '@/systems/AudioSystem/AudioSystem';
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
    this._buildings = new BuildingSystem(state, this.content, this._economy, this.events, this.clock);
    this._upgrades = new UpgradeSystem(
      state,
      this.content,
      this._economy,
      this.timers,
      this._buildings,
      this.events,
      this.clock,
    );
    this._offline = new OfflineIncomeSystem(state, this.content, this._buildings, this.events, this.clock);
    this._progression = new ProgressionSystem(state, this.content, this._economy, this._buildings, this.events);
    this._ads = new AdRewardSystem(
      this.content,
      this._economy,
      this._upgrades,
      this.events,
      this.clock,
      new MockRewardedAdService(),
    );
    this._purchases = new PurchaseSystem(this._economy, new MockPurchaseService(), this.events, STORE_CATALOG);
    this._audio = new AudioSystem(state, this.events);

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
    ];
    for (const unsubscribe of subscriptions) this.bag.add(unsubscribe);
  }
}
