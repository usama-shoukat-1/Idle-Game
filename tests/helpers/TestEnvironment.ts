import { ContentRegistry, type ContentBundle } from '@/core/content/ContentRegistry';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ManualClock } from '@/core/Time';
import { MemoryStorageDriver } from '@/services/storage/StorageDrivers';
import { buildingId, stageId, upgradeId, asDurationMs, seconds } from '@/core/types/primitives';
import type { BuildingDefinition, EconomyBalanceConfig, StageDefinition, UpgradeDefinition } from '@/core/types/content';
import type { StorageDriver } from '@/core/types/services';
import type { GameState } from '@/core/types/state';
import type { LoadResult } from '@/systems/SaveSystem/SaveSystem';
import type { OfflineSummary } from '@/systems/OfflineIncomeSystem/OfflineIncomeSystem';

/**
 * Test harness for the foundation systems.
 *
 * Every test runs against the REAL systems (economy, timers, upgrades, save, offline) with
 * two substitutions: a `ManualClock` so time is deterministic, and an in-memory storage
 * driver so nothing touches the browser. That combination is what makes timestamp-heavy
 * idle logic testable at all.
 */

export const TEST_IDS = {
  stage: stageId('stage.test.street'),
  cafe: buildingId('building.test.cafe'),
  shop: buildingId('building.test.shop'),
  cafeTier1: upgradeId('upgrade.test.cafe.1'),
  cafeTier2: upgradeId('upgrade.test.cafe.2'),
} as const;

export function createTestEconomy(overrides: Partial<EconomyBalanceConfig> = {}): EconomyBalanceConfig {
  return {
    startingCoins: 100,
    startingGems: 10,
    maxCoins: 1e15,
    maxGems: 1e9,
    offline: {
      maxDurationMs: asDurationMs(8 * 60 * 60 * 1000),
      efficiency: 0.5,
      minimumDurationMs: asDurationMs(60_000),
    },
    acceleration: { gemsPerMinute: 1, minimumGems: 1 },
    rewardedRewards: [
      { id: 'reward.test.coins', kind: 'coins', amount: 250, cooldownMs: asDurationMs(0), displayName: 'Coins', description: '' },
      { id: 'reward.test.skip', kind: 'timeSkip', amount: seconds(30), cooldownMs: asDurationMs(0), displayName: 'Skip', description: '' },
    ],
    ...overrides,
  };
}

function createTestBuilding(): BuildingDefinition {
  return {
    id: TEST_IDS.cafe,
    displayName: 'Test Café',
    description: 'Synthetic building used by the foundation tests.',
    stageId: TEST_IDS.stage,
    type: 'cafe',
    order: 0,
    baseIncome: { kind: 'perInterval', coinsPerInterval: 10, intervalMs: seconds(10) },
    restorationTiers: [
      { tier: 0, displayName: 'As found', cost: { currency: 'coins', amount: 0 }, durationMs: asDurationMs(0), incomeMultiplier: 1, visualState: 'tier0', prerequisites: [], unlocks: [] },
      { tier: 1, displayName: 'Cleaned', cost: { currency: 'coins', amount: 50 }, durationMs: seconds(30), incomeMultiplier: 2, visualState: 'tier1', prerequisites: [], unlocks: [] },
      { tier: 2, displayName: 'Restored', cost: { currency: 'coins', amount: 200 }, durationMs: asDurationMs(0), incomeMultiplier: 4, visualState: 'tier2', prerequisites: [], unlocks: [] },
    ],
    visualStates: [
      { key: 'tier0', layers: {} },
      { key: 'tier1', layers: {} },
      { key: 'tier2', layers: {} },
    ],
    unlockRequirements: [],
    synergyRules: [],
    placeholder: { tint: '#556677' },
  };
}

function createTestUpgrades(): UpgradeDefinition[] {
  return [
    {
      id: TEST_IDS.cafeTier1,
      displayName: 'Sweep the floor',
      description: 'First restoration step (timed).',
      targetBuildingId: TEST_IDS.cafe,
      tier: 1,
      cost: { currency: 'coins', amount: 50 },
      durationMs: seconds(30),
      incomeMultiplier: 2,
      unlocks: [],
      visualState: 'tier1',
      prerequisites: [],
      options: { gemAcceleration: true, rewardedTimeSkip: true },
    },
    {
      id: TEST_IDS.cafeTier2,
      displayName: 'Replace the counter',
      description: 'Instant restoration step.',
      targetBuildingId: TEST_IDS.cafe,
      tier: 2,
      cost: { currency: 'coins', amount: 200 },
      durationMs: asDurationMs(0),
      incomeMultiplier: 4,
      unlocks: [],
      visualState: 'tier2',
      prerequisites: [TEST_IDS.cafeTier1],
    },
  ];
}

export function createTestContent(bundleOverrides: Partial<ContentBundle> = {}): ContentRegistry {
  const stage: StageDefinition = {
    id: TEST_IDS.stage,
    displayName: 'Test Street',
    description: 'Synthetic stage.',
    order: 0,
    buildingIds: [TEST_IDS.cafe],
    unlockRequirements: [],
    synergy: { masteryMax: 10, synergyScalePercent: 0 },
  };

  const registry = new ContentRegistry();
  registry.load({
    districts: [
      {
        id: 'district.test',
        displayName: 'Test District',
        description: '',
        order: 0,
        stageIds: [TEST_IDS.stage],
        theme: { backgroundTint: '#000000', accentColour: '#ffffff' },
      },
    ],
    stages: [stage],
    buildings: [createTestBuilding()],
    upgrades: createTestUpgrades(),
    workers: [],
    economy: createTestEconomy(),
    ...bundleOverrides,
  });
  return registry;
}

export interface TestEnvironment {
  readonly systems: ServiceContainer;
  readonly clock: ManualClock;
  readonly storage: StorageDriver;
  readonly content: ContentRegistry;
  readonly state: GameState;
  readonly loadResult: LoadResult;
  /** Disposes systems so interval-free tests never leak listeners. */
  dispose(): void;
}

export interface TestEnvironmentOptions {
  readonly content?: ContentRegistry;
  readonly now?: number;
  readonly storage?: StorageDriver;
  /** Skip loading so the test can exercise a first-run scenario explicitly. */
  readonly seedSave?: boolean;
}

export function createTestEnvironment(options: TestEnvironmentOptions = {}): TestEnvironment {
  const clock = new ManualClock(options.now ?? 1_700_000_000_000);
  const storage = options.storage ?? new MemoryStorageDriver();
  const content = options.content ?? createTestContent();

  const systems = new ServiceContainer({ clock, storage, content, headless: true });
  const loadResult = systems.load();

  return {
    systems,
    clock,
    storage,
    content,
    state: systems.state,
    loadResult,
    dispose: () => systems.dispose(),
  };
}

/** Unlocks the synthetic building so income/upgrade tests can start from a live building. */
export function unlockTestBuilding(env: TestEnvironment): void {
  env.systems.buildings.unlock(TEST_IDS.cafe, 'test-setup');
}

// ---------------------------------------------------------------------------
// PHASE 1 HARNESS
// ---------------------------------------------------------------------------

/**
 * Environment wired to the **shipped content** (the Old Café and its ten tiers) instead of
 * synthetic definitions. Phase 1 tests use this so they validate the real balance table,
 * the real reward definitions and the real stage/building wiring - exactly what a player
 * gets. Time and storage are still deterministic.
 */
export function createPhase1Environment(options: TestEnvironmentOptions = {}): TestEnvironment {
  const clock = new ManualClock(options.now ?? PHASE1_EPOCH);
  const storage = options.storage ?? new MemoryStorageDriver();

  const systems = new ServiceContainer({
    clock,
    storage,
    // No `content` override: ServiceContainer loads DEFAULT_CONTENT (the real game content).
    headless: true,
  });
  const loadResult = systems.load();

  return {
    systems,
    clock,
    storage,
    content: systems.content,
    state: systems.state,
    loadResult,
    dispose: () => systems.dispose(),
  };
}

/** Fixed epoch for Phase 1 tests (a Wednesday, so day-of-week logic stays stable). */
export const PHASE1_EPOCH = 1_700_000_000_000;

/** Enters the game: unlocks the starting location, exactly as LoadingScene does at boot. */
export function enterGame(env: TestEnvironment): void {
  env.systems.buildings.ensureDefaultUnlocks();
}

/**
 * Replays the whole LoadingScene boot sequence: resume persisted jobs (completing any that
 * finished while the game was closed), unlock the starting location, then settle offline
 * progression. Tests that simulate "the player comes back" use this instead of `enterGame`.
 */
export function bootSession(env: TestEnvironment): OfflineSummary {
  env.systems.upgrades.rehydrate();
  env.systems.buildings.ensureDefaultUnlocks();
  return env.systems.offline.settle();
}

/** The Old Café id used by every Phase 1 test. */
export const OLD_CAFE_ID = buildingId('building_old_cafe');

/** Upgrade id for a tier (1..10). */
export function cafeUpgrade(tier: number) {
  return upgradeId(`old_cafe_tier_${String(tier).padStart(2, '0')}`);
}

/**
 * Grants enough coins to buy the next restoration steps, so tests about *behaviour* do not
 * have to simulate the whole income curve. (Tests that are about the economy use the real
 * wallet and never call this.)
 */
export function grantCoins(env: TestEnvironment, amount: number): void {
  env.systems.economy.addCoins(amount, 'test.grant');
}

/**
 * Restores the café through `tiers` upgrades, granting coins as needed.
 * Idempotent: tiers that are already completed are skipped, so a test can push the café to
 * a tier, assert something, and then continue restoring.
 */
export function restoreUpTo(env: TestEnvironment, tiers: number): void {
  for (let tier = 1; tier <= tiers; tier += 1) {
    const id = cafeUpgrade(tier);
    if (env.systems.upgrades.isCompleted(id)) continue;
    const definition = env.systems.content.getUpgrade(id);
    grantCoins(env, definition.cost.amount);
    const result = env.systems.upgrades.start(id);
    if (!result.ok) throw new Error(`could not start ${id}: ${result.reason}`);
    if (env.systems.upgrades.isRunning(id)) {
      env.systems.upgrades.completeNow(id, 'test.fast-forward');
    }
  }
}

/** Reloads the same save into a fresh environment (session 2). */
export function reopenSession(env: TestEnvironment, now?: number): TestEnvironment {
  return createPhase1Environment({ storage: env.storage, now: now ?? env.clock.now() });
}
