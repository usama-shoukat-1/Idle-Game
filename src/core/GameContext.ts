/**
 * Composition root.
 *
 * All systems are constructed once, wired together here, and shared through this
 * context. Scenes never construct systems and never own game state: they read the
 * context from Phaser's registry and talk to systems + the typed event bus.
 */

import { OffsetClock, SystemClock, type Clock } from '@/core/Clock';
import { createGameConfig, type GameConfig, type GameConfigOverrides } from '@/core/GameConfig';
import { GameStateStore } from '@/core/state/GameStateStore';
import { createDefaultGameState } from '@/core/state/defaultGameState';
import { validateAndRepairGameState } from '@/core/state/gameStateValidation';
import { createLogger, setGlobalLogLevel } from '@/core/utils/logger';
import type { EconomyBalanceDefinition } from '@/core/types/content';
import type { GameState } from '@/core/types/gameState';
import type { AdRewardService, PurchaseService } from '@/core/types/monetization';
import type { StorageAdapter } from '@/core/types/save';
import { createStorageAdapter } from '@/services/storage';
import { ContentRegistry } from '@/systems/ContentSystem/ContentRegistry';
import { createGameEventBus, type GameEventBus } from '@/systems/EventSystem';
import { SaveSystem } from '@/systems/SaveSystem/SaveSystem';
import { EconomySystem } from '@/systems/EconomySystem/EconomySystem';
import { TimerSystem } from '@/systems/TimerSystem/TimerSystem';
import { BuildingSystem } from '@/systems/BuildingSystem/BuildingSystem';
import { UpgradeSystem } from '@/systems/UpgradeSystem/UpgradeSystem';
import { ProgressionSystem } from '@/systems/ProgressionSystem/ProgressionSystem';
import { OfflineIncomeSystem } from '@/systems/OfflineIncomeSystem/OfflineIncomeSystem';
import { AdRewardSystem } from '@/systems/AdRewardSystem/AdRewardSystem';
import { MockAdRewardService } from '@/systems/AdRewardSystem/MockAdRewardService';
import { RewardDispatcher } from '@/systems/AdRewardSystem/RewardDispatcher';
import { PurchaseSystem } from '@/systems/PurchaseSystem/PurchaseSystem';
import { MockPurchaseService } from '@/systems/PurchaseSystem/MockPurchaseService';
import { AudioManager } from '@/systems/AudioSystem/AudioManager';
import { buildContentRegistry } from '@/data';
import { SOUND_REGISTRY } from '@/config/content';
import { createDebugTools, type DebugApi } from '@/debug';

export interface GameContextOptions {
  config?: GameConfig;
  configOverrides?: GameConfigOverrides;
  /** Injection points for QA builds and tests. */
  adService?: AdRewardService;
  purchaseService?: PurchaseService;
  clock?: Clock;
  content?: ContentRegistry;
  /** Explicit storage backend (tests, embedded shells). */
  storage?: StorageAdapter;
  /** Disable Phaser-bound debug tooling (headless tests). */
  debugEnabled?: boolean;
}

export interface GameContext {
  readonly config: GameConfig;
  readonly clock: Clock;
  readonly events: GameEventBus;
  readonly content: ContentRegistry;
  readonly balance: EconomyBalanceDefinition;
  readonly state: GameStateStore;
  readonly save: SaveSystem;
  readonly economy: EconomySystem;
  readonly timers: TimerSystem;
  readonly buildings: BuildingSystem;
  readonly upgrades: UpgradeSystem;
  readonly progression: ProgressionSystem;
  readonly offline: OfflineIncomeSystem;
  readonly rewards: RewardDispatcher;
  readonly ads: AdRewardSystem;
  readonly purchases: PurchaseSystem;
  readonly audio: AudioManager;
  readonly debug: DebugApi;
  /** Fresh default state (reset + load fallback). */
  createDefaultState(): GameState;
  /** Validate/repair untrusted save data against the current content. */
  validateState(raw: unknown, now: number): ReturnType<typeof validateAndRepairGameState>;
  readonly disposed: boolean;
  dispose(): void;
}

export function createGameContext(options: GameContextOptions = {}): GameContext {
  const config = options.config ?? createGameConfig(options.configOverrides);
  setGlobalLogLevel(config.debug.logLevel);
  const log = createLogger('context');

  const clock = options.clock ?? new OffsetClock(new SystemClock());
  const events = createGameEventBus();
  const content = options.content ?? buildContentRegistry();
  const balance = content.getBalance(config.balanceId);

  if (!balance) {
    throw new Error(
      `no economy balance registered for id "${config.balanceId}" - check src/data/economy and src/config/balance`,
    );
  }

  const contentSnapshot = content.snapshot();
  const createDefaultState = (): GameState =>
    createDefaultGameState({ now: clock.now(), balance, content: contentSnapshot });

  const validateState = (raw: unknown, now: number) =>
    validateAndRepairGameState(raw, {
      now,
      balance,
      content: contentSnapshot,
      defaults: createDefaultGameState({ now, balance, content: contentSnapshot }),
    });

  const state = new GameStateStore(createDefaultState(), events);
  const storage = options.storage ?? createStorageAdapter(config);

  const save = new SaveSystem({
    storage,
    clock,
    config,
    events,
    createDefaultState,
    validate: validateState,
  });

  const economy = new EconomySystem({ store: state, events, clock });
  const timers = new TimerSystem({
    store: state,
    events,
    clock,
    progressIntervalMs: config.timerProgressIntervalMs,
  });
  const buildings = new BuildingSystem({ store: state, events, clock, content, economy, balance });
  const progression = new ProgressionSystem({ store: state, events, clock, content, buildings, economy });
  const upgrades = new UpgradeSystem({ store: state, events, clock, content, economy, timers, buildings, progression });
  // Buildings expose entities that need upgrade availability; the provider is wired
  // here (after both systems exist) to keep the dependency one-way.
  buildings.setUpgradeProvider(upgrades);

  const offline = new OfflineIncomeSystem({ store: state, events, clock, content, buildings, economy, timers, balance });
  const rewards = new RewardDispatcher({ store: state, events, clock, economy, timers });

  const ads = new AdRewardSystem({
    store: state,
    events,
    clock,
    content,
    service: options.adService ?? new MockAdRewardService(),
    dispatcher: rewards,
  });
  const purchases = new PurchaseSystem({
    store: state,
    events,
    clock,
    content,
    service: options.purchaseService ?? new MockPurchaseService(),
    dispatcher: rewards,
  });
  const audio = new AudioManager(state.state.settings, { events, definitions: SOUND_REGISTRY });

  /* ---------------------------------------------------- income modifiers */

  // Temporary boosts (ad rewards, events) - registered outside the building system
  // so new bonus sources never require an edit to core economy code.
  buildings.registerIncomeModifier('boosts', ({ state: buildingState, at }) => {
    const active = state.state.boosts.filter(
      (boost) =>
        boost.kind === 'income-multiplier' &&
        boost.endsAt > at &&
        (!boost.targetId || boost.targetId === buildingState.id),
    );
    return active.reduce((total, boost) => total * Math.max(0, boost.multiplier), 1);
  });

  // District synergy: a restored district lifts the income of its members. The
  // curve itself is a Phase 1+ tuning decision and lives here (not in content).
  buildings.registerIncomeModifier('district-synergy', ({ definition }) => {
    const district = state.state.districts[definition.districtId];
    if (!district) return 1;
    return 1 + district.progress * 0.25;
  });

  /* --------------------------------------------------------------- debug */

  let debugTools: DebugApi = createDebugToolsFromEnabled(options.debugEnabled ?? config.debug.enabled, () => context);

  let disposed = false;

  const context: GameContext = {
    config,
    clock,
    events,
    content,
    balance,
    state,
    save,
    economy,
    timers,
    buildings,
    upgrades,
    progression,
    offline,
    rewards,
    ads,
    purchases,
    audio,
    get debug() {
      return debugTools;
    },
    createDefaultState,
    validateState,
    get disposed() {
      return disposed;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      upgrades.dispose();
      audio.dispose();
      debugTools = createDebugToolsFromEnabled(false, () => null);
      events.removeAll();
      state.markClean();
      log.debug('game context disposed');
    },
  };

  log.debug('game context ready', { balance: balance.id, content: content.counts });
  return context;
}

function createDebugToolsFromEnabled(enabled: boolean, getContext: () => GameContext | null): DebugApi {
  return createDebugTools({ enabled, getContext });
}
