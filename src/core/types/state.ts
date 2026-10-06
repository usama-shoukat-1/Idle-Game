import { MS_PER_MINUTE, type BuildingId, type StageId, type UpgradeId, type WorkerId } from './primitives';
import type { SettingsState, TutorialState } from './settings';
import type { RuntimeSnapshot } from './runtime';

/**
 * THE central game state model.
 *
 * One typed, serialisable tree owns everything the player can influence. Nothing
 * about the player's progress lives in a scene, a Phaser object or a module-level
 * variable. Systems receive a `GameState` reference and mutate it only through their
 * own public APIs; the SaveSystem is the only writer of serialised form.
 *
 * Rules:
 * - Everything here must be JSON-serialisable (no class instances, no functions,
 *   no Map/Set, no undefined - use null or omit).
 * - Additive changes only for saved fields; removals/renames require a migration.
 *   See docs/SAVE_SYSTEM.md.
 */

/** Static identity of the current save. */
export interface ProfileState {
  /** Stable anonymous player id (generated on first run, never a personal identifier). */
  playerId: string;
  /** Epoch ms of first ever launch. */
  createdAt: number;
  /** Monotonic counter, bumped on every successful save - handy for debugging. */
  saveCount: number;
  /** Number of sessions started (each successful load increments this). */
  sessionCount: number;
}

export interface WalletState {
  coins: number;
  gems: number;
}

/** Per-building progress. Keyed by BuildingId in `BuildingsState.entries`. */
export interface BuildingRuntimeState {
  unlocked: boolean;
  /** Current restoration/business tier (0 = as found, untouched). */
  tier: number;
  /** Current visual state key, resolved from content. Persisted so art can change. */
  visualState: string;
  /** Epoch ms when this building last produced income. */
  lastIncomeAt: number;
  /** Fraction of the current income interval already elapsed, in [0, 1). */
  incomeProgress: number;
  /** Optional assigned worker id (future automation). */
  assignedWorkerId: WorkerId | null;
}

export interface BuildingsState {
  /** Sparse map: a building only appears once the player first interacts with it. */
  entries: Record<BuildingId, BuildingRuntimeState>;
}

/**
 * An upgrade that is either running (timed) or already finished but waiting to be
 * acknowledged by the presentation layer (e.g. a "reveal" animation).
 */
export interface UpgradeJobState {
  readonly upgradeId: UpgradeId;
  readonly buildingId: BuildingId;
  /** Epoch ms the job started. */
  readonly startedAt: number;
  /** Epoch ms the job completes. Duration is `completesAt - startedAt` - never stored twice. */
  completesAt: number;
  /** True once `completesAt` has passed and the job has been applied. */
  applied: boolean;
}

export interface UpgradesState {
  /** Upgrades currently running, keyed by upgrade id. */
  active: Record<UpgradeId, UpgradeJobState>;
  /** Upgrade ids already finished (completed at least once). */
  completed: UpgradeId[];
}

export interface WorkerRuntimeState {
  id: WorkerId;
  unlocked: boolean;
  assignedBuildingId: BuildingId | null;
}

export interface WorkersState {
  entries: Record<WorkerId, WorkerRuntimeState>;
}

/** Per-stage progression: which stages are open, mastery, district synergy progress. */
export interface StageProgressState {
  unlocked: boolean;
  completed: boolean;
  /** Mastery points accumulated in this stage (0..masteryMax). */
  mastery: number;
  /** District synergy contribution, in percent, accumulated from restored buildings. */
  synergy: number;
}

export interface ProgressionState {
  currentStageId: StageId;
  stages: Record<StageId, StageProgressState>;
  unlockedStageIds: StageId[];
}

/** Redevelopment / prestige. Foundation only - no balance values in Phase 0. */
export interface RedevelopmentState {
  /** Redevelopment level (prestige count). */
  level: number;
  /** Unspent redevelopment currency. */
  points: number;
}

/** Append-only-ish transaction journal. Capped in length; see EconomySystem. */
export interface TransactionLogEntry {
  readonly at: number;
  readonly currency: 'coins' | 'gems';
  readonly delta: number;
  readonly balanceAfter: number;
  readonly reason: string;
}

export interface AnalyticsState {
  /** Lightweight counters that are useful in a bug report and cost nothing. */
  totalCoinsEarned: number;
  totalCoinsSpent: number;
  totalGemsEarned: number;
  totalGemsSpent: number;
  /** Epoch ms of the last time offline progress was settled. */
  lastSessionAt: number;
}

export interface SessionState {
  /** Epoch ms when the current session started. */
  startedAt: number;
  /** Epoch ms of the most recent successful save. This is the offline-progress anchor. */
  lastSaveAt: number;
  /** Accumulated foreground play time in ms. */
  playTimeMs: number;
  /** True when the session was restored from a save rather than started fresh. */
  resumed: boolean;
}

/**
 * The whole player-facing state tree.
 * Keep this flat-ish and composed of small interfaces so systems can own a slice.
 */
export interface GameState {
  /** Schema version of THIS object. Owned by the SaveSystem migration chain. */
  schemaVersion: number;
  profile: ProfileState;
  wallet: WalletState;
  buildings: BuildingsState;
  upgrades: UpgradesState;
  workers: WorkersState;
  progression: ProgressionState;
  redevelopment: RedevelopmentState;
  session: SessionState;
  analytics: AnalyticsState;
  settings: SettingsState;
  tutorial: TutorialState;
  transactions: TransactionLogEntry[];
}

/** Guard rails shared by save validation and system inputs. */
export const STATE_LIMITS = {
  /** Never trust a stored transaction journal longer than this. */
  maxTransactionLogEntries: 200,
  /** Sanity ceiling for stored currency values to reject corrupted/absurd saves. */
  maxCurrencyValue: 1e21,
  /** Elapsed time beyond this is clamped (implied by design). 14 days. */
  maxOfflineDurationMs: 14 * 24 * 60 * MS_PER_MINUTE,
} as const;

export type { RuntimeSnapshot };
