import { ContentRegistry, type ContentBundle } from '@/core/content/ContentRegistry';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ManualClock } from '@/core/Time';
import { MemoryStorageDriver } from '@/services/storage/StorageDrivers';
import { buildingId, stageId, upgradeId, asDurationMs, seconds } from '@/core/types/primitives';
import type { BuildingDefinition, EconomyBalanceConfig, StageDefinition, UpgradeDefinition } from '@/core/types/content';
import type { StorageDriver } from '@/core/types/services';
import type { GameState } from '@/core/types/state';
import type { LoadResult } from '@/systems/SaveSystem/SaveSystem';

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
