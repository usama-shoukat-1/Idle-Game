/**
 * Safe default state.
 *
 * The default state is derived from registered content + the economy balance, so
 * adding a building definition automatically produces its locked runtime record.
 * No building is special-cased here.
 */

import { DEFAULT_STAGE_ID } from '@/core/constants';
import type {
  BuildingDefinition,
  ContentSnapshot,
  EconomyBalanceDefinition,
} from '@/core/types/content';
import type {
  BuildingState,
  DistrictProgressState,
  GameState,
  MasteryState,
  SettingsState,
} from '@/core/types/gameState';
import { SAVE_SCHEMA_VERSION } from '@/core/types/save';
import { roundCurrency } from '@/core/utils/numbers';

export const DEFAULT_SETTINGS: Readonly<SettingsState> = Object.freeze({
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.9,
  muted: false,
  hapticsEnabled: true,
  reducedMotion: false,
  showFloatingNumbers: true,
  language: 'en',
});

export function defaultBuildingState(definition: BuildingDefinition, now: number): BuildingState {
  return {
    id: definition.id,
    unlocked: false,
    unlockedAt: null,
    tier: 0,
    visualStateId: null,
    activeUpgradeId: null,
    completedUpgradeIds: [],
    purchaseCounts: {},
    incomeMultiplier: 1,
    incomeBonus: 0,
    incomeIntervalMsOverride: null,
    workerSlotsBonus: 0,
    lastIncomeAt: now,
    lifetimeEarned: 0,
    workerIds: [],
    redevelopmentCount: 0,
  };
}

export function defaultDistrictProgress(
  districtId: string,
  totalBuildings: number,
  unlocked: boolean,
): DistrictProgressState {
  return {
    districtId,
    unlocked,
    restoredBuildings: 0,
    totalBuildings,
    progress: 0,
    completedAt: null,
    synergyMultiplier: 1,
  };
}

export interface DefaultStateOptions {
  now: number;
  balance: EconomyBalanceDefinition;
  content: ContentSnapshot;
  settings?: Partial<SettingsState>;
  rngSeed?: number;
  schemaVersion?: number;
}

export function createDefaultGameState(options: DefaultStateOptions): GameState {
  const { now, balance, content } = options;

  const stages = [...content.stages].sort((a, b) => a.order - b.order);
  const firstStageId = stages[0]?.id ?? DEFAULT_STAGE_ID;

  const buildings: Record<string, BuildingState> = {};
  for (const definition of content.buildings) {
    buildings[definition.id] = defaultBuildingState(definition, now);
  }

  const districts: Record<string, DistrictProgressState> = {};
  for (const district of content.districts) {
    districts[district.id] = defaultDistrictProgress(
      district.id,
      district.buildingIds.length,
      district.stageId === firstStageId,
    );
  }

  const mastery: Record<string, MasteryState> = {};
  for (const track of content.masteryTracks) {
    mastery[track.id] = { trackId: track.id, level: 0, xp: 0 };
  }

  return {
    schemaVersion: options.schemaVersion ?? SAVE_SCHEMA_VERSION,
    currencies: {
      coins: roundCurrency(balance.startingCoins),
      gems: roundCurrency(balance.startingGems),
    },
    progression: {
      currentStageId: firstStageId,
      unlockedStageIds: stages.length > 0 ? [firstStageId] : [],
      unlockedDistrictIds: content.districts
        .filter((district) => district.stageId === firstStageId)
        .map((district) => district.id),
      stageProgress: {},
    },
    buildings,
    upgrades: { active: {}, completed: [] },
    timers: {},
    workers: [],
    districts,
    mastery,
    boosts: [],
    events: { active: [], completedIds: [] },
    entitlements: {},
    ads: { placements: {} },
    settings: { ...DEFAULT_SETTINGS, ...options.settings },
    tutorial: {
      completed: false,
      skipped: false,
      currentStepId: null,
      completedStepIds: [],
    },
    stats: {
      sessionsStarted: 0,
      playTimeMs: 0,
      totalTaps: 0,
      buildingsUnlocked: 0,
      buildingsRestored: 0,
      upgradesCompleted: 0,
      offlineRewardsClaimed: 0,
      rewardedAdsWatched: 0,
      lifetimeEarned: { coins: 0, gems: 0 },
      lifetimeSpent: { coins: 0, gems: 0 },
      reasonCounters: {},
    },
    timestamps: {
      createdAt: now,
      updatedAt: now,
      lastSessionTime: now,
      sessionStartedAt: now,
      lastOfflineComputedAt: null,
      lastOfflineClaimedAt: null,
    },
    flags: {},
    rngSeed: options.rngSeed ?? 1,
  };
}
