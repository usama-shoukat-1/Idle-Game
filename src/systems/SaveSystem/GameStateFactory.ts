import type { ContentRegistry } from '@/core/content/ContentRegistry';
import { SAVE_SCHEMA_VERSION } from '@/core/constants/GameConstants';
import { DEFAULT_STAGE_ID } from '@/data/districts/district_01_old_town';
import type { GameState, StageProgressState } from '@/core/types/state';
import type { EpochMs, StageId } from '@/core/types/primitives';
import { DEFAULT_SETTINGS, DEFAULT_TUTORIAL } from '@/core/types/settings';
import { normalizeCurrencyAmount } from '@/core/utils/NumberUtils';

/**
 * The ONE place a brand-new `GameState` is constructed.
 *
 * Every field has a safe default, so a fresh install, a corrupted save and a schema
 * migration all converge on a valid, playable state. Nothing else in the codebase may
 * invent a state object (see docs/DEVELOPMENT_RULES.md).
 */

export interface CreateStateOptions {
  /** Epoch ms used for timestamps (injected so tests are deterministic). */
  readonly now: number;
  /** Content registry - supplies the default stage + starting wallet. */
  readonly content: ContentRegistry;
  /** Optional deterministic player id (tests). */
  readonly playerId?: string;
}

function createPlayerId(now: number): string {
  const random = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `p_${now.toString(36)}_${random}`;
}

export function createDefaultStageProgress(unlocked: boolean): StageProgressState {
  return { unlocked, completed: false, mastery: 0, synergy: 0 };
}

export function createDefaultGameState(options: CreateStateOptions): GameState {
  const { now, content } = options;
  const economy = content.getEconomyBalance();

  const stages = content.getAllStages();
  const defaultStageId: StageId = stages[0]?.id ?? DEFAULT_STAGE_ID;
  const stageEntries: Record<StageId, StageProgressState> = {};
  for (const stage of stages) {
    stageEntries[stage.id] = createDefaultStageProgress(true);
  }

  const workers: GameState['workers']['entries'] = {};
  for (const worker of content.getWorkers()) {
    workers[worker.id] = { id: worker.id, unlocked: false, assignedBuildingId: null };
  }

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    profile: {
      playerId: options.playerId ?? createPlayerId(now),
      createdAt: now,
      saveCount: 0,
      sessionCount: 0,
    },
    wallet: {
      coins: normalizeCurrencyAmount(economy.startingCoins),
      gems: normalizeCurrencyAmount(economy.startingGems),
    },
    buildings: { entries: {} },
    upgrades: { active: {}, completed: [] },
    workers: { entries: workers },
    progression: {
      currentStageId: defaultStageId,
      stages: stageEntries,
      unlockedStageIds: stages.map((stage) => stage.id),
    },
    redevelopment: { level: 0, points: 0 },
    session: {
      startedAt: now,
      lastSaveAt: now,
      playTimeMs: 0,
      resumed: false,
    },
    analytics: {
      totalCoinsEarned: 0,
      totalCoinsSpent: 0,
      totalGemsEarned: 0,
      totalGemsSpent: 0,
      lastSessionAt: now,
    },
    settings: structuredCloneSafe(DEFAULT_SETTINGS),
    tutorial: structuredCloneSafe(DEFAULT_TUTORIAL),
    transactions: [],
  };
}

/**
 * Deep clone for plain JSON data. `structuredClone` is used when available; the JSON
 * fallback keeps the game working in older WebViews (a real Android support case).
 */
export function structuredCloneSafe<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Convenience for systems: epoch helper without importing the clock. */
export function epoch(value: number): EpochMs {
  return value as EpochMs;
}
