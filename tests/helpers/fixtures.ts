/**
 * Test fixtures.
 *
 * Phase 0 ships no content, so tests register their own synthetic definitions and
 * drive the systems through the *same* public APIs the game uses. That is the point
 * of the architecture check: a brand-new building is added as data and everything
 * (economy, timers, upgrades, offline, save) works without engine edits.
 */

import { ManualClock } from '@/core/Clock';
import { createGameContext, type GameContext, type GameContextOptions } from '@/core/GameContext';
import type {
  BuildingDefinition,
  DistrictDefinition,
  EconomyBalanceDefinition,
  MasteryTrackDefinition,
  StageDefinition,
  UpgradeDefinition,
} from '@/core/types/content';
import { ContentRegistry } from '@/systems/ContentSystem/ContentRegistry';
import { MemoryStorageAdapter } from '@/services/storage';
import { MINUTE } from '@/core/utils/time';

export const TEST_START_TIME = 1_700_000_000_000;

export const TEST_BALANCE: EconomyBalanceDefinition = {
  id: 'default',
  displayName: 'Test Balance',
  startingCoins: 100,
  startingGems: 5,
  globalIncomeMultiplier: 1,
  incomeTickMs: 1_000,
  offline: {
    enabled: true,
    maxOfflineMs: 4 * 60 * MINUTE,
    minElapsedMs: MINUTE,
    efficiency: 0.5,
    enhancedEfficiency: 1,
    enhancedDurationMs: 30 * MINUTE,
  },
};

export const TEST_BUILDING: BuildingDefinition = {
  id: 'building.test-shop',
  displayName: 'Test Shop',
  stageId: 'stage.test',
  districtId: 'district.test',
  type: 'shop',
  rarity: 'common',
  order: 1,
  baseIncome: 10,
  incomeIntervalMs: 1_000,
  maxTier: 2,
  restorationTiers: [
    { tier: 0, id: 'tier.0', displayName: 'Derelict', visualStateId: 'derelict', upgradeIds: [], incomeMultiplier: 1 },
    {
      tier: 1,
      id: 'tier.1',
      displayName: 'Cleaned',
      visualStateId: 'cleaned',
      upgradeIds: ['upgrade.test.clean'],
      incomeMultiplier: 2,
    },
    {
      tier: 2,
      id: 'tier.2',
      displayName: 'Restored',
      visualStateId: 'restored',
      upgradeIds: ['upgrade.test.restore'],
      incomeMultiplier: 4,
    },
  ],
  visualStates: [
    { id: 'derelict', label: 'Derelict', order: 0 },
    { id: 'cleaned', label: 'Cleaned', order: 1 },
    { id: 'restored', label: 'Restored', order: 2 },
  ],
  upgradeIds: ['upgrade.test.clean', 'upgrade.test.restore'],
  unlockRequirements: { stageId: 'stage.test' },
};

export const TEST_CLEAN_UPGRADE: UpgradeDefinition = {
  id: 'upgrade.test.clean',
  displayName: 'Clean the windows',
  target: { kind: 'building', buildingId: TEST_BUILDING.id },
  kind: 'instant',
  tier: 1,
  cost: { coins: 50 },
  durationMs: 0,
  effects: [{ type: 'income-multiplier', value: 1, mode: 'add' }],
  visualStateId: 'cleaned',
};

export const TEST_RESTORE_UPGRADE: UpgradeDefinition = {
  id: 'upgrade.test.restore',
  displayName: 'Rebuild the storefront',
  target: { kind: 'building', buildingId: TEST_BUILDING.id },
  kind: 'timed',
  tier: 2,
  cost: { coins: 200, gems: 1 },
  durationMs: 10 * MINUTE,
  gemSkipRatePerMinute: 2,
  effects: [
    { type: 'income-multiplier', value: 1.5, mode: 'add' },
    { type: 'income-add', value: 5 },
  ],
  prerequisites: [{ upgradeId: TEST_CLEAN_UPGRADE.id }],
  visualStateId: 'restored',
};

export const TEST_STAGE: StageDefinition = {
  id: 'stage.test',
  displayName: 'Test Stage',
  order: 1,
  districtIds: ['district.test'],
  masteryTarget: 1,
};

export const TEST_DISTRICT: DistrictDefinition = {
  id: 'district.test',
  stageId: 'stage.test',
  displayName: 'Test District',
  order: 1,
  buildingIds: [TEST_BUILDING.id],
  masteryTrackId: 'mastery.test',
};

export const TEST_MASTERY: MasteryTrackDefinition = {
  id: 'mastery.test',
  displayName: 'Test Mastery',
  levelCurve: [10, 25, 50],
  incomeMultiplierPerLevel: 0.05,
};

export function createFixtureContent(): ContentRegistry {
  const registry = new ContentRegistry();
  registry.load({
    buildings: [TEST_BUILDING],
    upgrades: [TEST_CLEAN_UPGRADE, TEST_RESTORE_UPGRADE],
    stages: [TEST_STAGE],
    districts: [TEST_DISTRICT],
    masteryTracks: [TEST_MASTERY],
    balances: [TEST_BALANCE],
  });
  return registry;
}

export interface TestHarness {
  context: GameContext;
  clock: ManualClock;
  storage: MemoryStorageAdapter;
}

/** Headless context with a manual clock and in-memory storage. */
export function createTestHarness(options: Partial<GameContextOptions> = {}): TestHarness {
  const clock = new ManualClock(TEST_START_TIME);
  const storage = new MemoryStorageAdapter();
  const context = createGameContext({
    clock,
    storage,
    content: createFixtureContent(),
    debugEnabled: false,
    configOverrides: {
      storage: { adapter: 'memory' },
      debug: { enabled: false, cheatsEnabled: false, showOverlay: false, logLevel: 'error' },
      balanceId: 'default',
    },
    ...options,
  });
  return { context, clock, storage };
}

/** Unlock the fixture building directly (gameplay would go through the UI). */
export function unlockTestBuilding(context: GameContext): void {
  context.buildings.unlock(TEST_BUILDING.id);
}
