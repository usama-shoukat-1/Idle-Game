/**
 * The central game-state model.
 *
 * Everything that must survive a reload lives here. Systems read/write this tree
 * through their own services (EconomySystem, TimerSystem, …) - never through
 * ad-hoc globals scattered across scenes.
 */

import type {
  BuildingId,
  DistrictId,
  EntitlementId,
  MasteryTrackId,
  StageId,
  TimerId,
  UpgradeId,
  WorkerId,
} from './ids';
import type { CurrencyCost } from './content';
import type { CurrencyKind } from './economy';
import type { TimerState } from './timers';

export interface CurrencyState {
  coins: number;
  gems: number;
}

/** Per-building persistent state. Buildings are content; this is their runtime. */
export interface BuildingState {
  id: BuildingId;
  unlocked: boolean;
  unlockedAt: number | null;
  /** Restoration/upgrade tier. 0 = as found, locked or untouched. */
  tier: number;
  /** Explicit visual state; when null the tier's visual state is used. */
  visualStateId: string | null;
  /** Upgrade currently being applied to this building, if any. */
  activeUpgradeId: UpgradeId | null;
  completedUpgradeIds: UpgradeId[];
  /** Purchase counts, supporting repeatable upgrades. */
  purchaseCounts: Record<UpgradeId, number>;
  /** Multiplier accumulated from completed upgrades (content sets the values). */
  incomeMultiplier: number;
  /** Additive income bonus accumulated from completed upgrades. */
  incomeBonus: number;
  /** Per-building income interval override in ms (null = definition value). */
  incomeIntervalMsOverride: number | null;
  /** Extra worker slots granted by upgrades (base count lives in the definition). */
  workerSlotsBonus: number;
  /** Timestamp of the last accrual so income is timestamp-based, not frame-based. */
  lastIncomeAt: number;
  lifetimeEarned: number;
  workerIds: WorkerId[];
  /** Reserved for the future redevelopment/prestige loop. */
  redevelopmentCount: number;
}

export interface ActiveUpgradeState {
  upgradeId: UpgradeId;
  buildingId: BuildingId | null;
  timerId: TimerId;
  startedAt: number;
  endsAt: number;
  durationMs: number;
  costPaid: CurrencyCost;
  purchases: number;
}

export interface WorkerState {
  id: WorkerId;
  /** Id into the (future) worker content registry - no worker content in Phase 0. */
  definitionId: string;
  assignedBuildingId: BuildingId | null;
  hiredAt: number;
  level: number;
}

export interface DistrictProgressState {
  districtId: DistrictId;
  unlocked: boolean;
  restoredBuildings: number;
  totalBuildings: number;
  /** 0..1 */
  progress: number;
  completedAt: number | null;
  synergyMultiplier: number;
}

export interface MasteryState {
  trackId: MasteryTrackId;
  level: number;
  xp: number;
}

export interface ProgressionState {
  currentStageId: StageId;
  unlockedStageIds: StageId[];
  unlockedDistrictIds: DistrictId[];
  /** 0..1 completion per stage. */
  stageProgress: Record<StageId, number>;
}

/** Temporary, timestamp-anchored effect (ad reward, event, boost, …). */
export interface BoostState {
  id: string;
  kind: 'income-multiplier' | 'offline-efficiency' | 'upgrade-speed';
  multiplier: number;
  /** Building/district/global target. `undefined` = global. */
  targetId?: string;
  startedAt: number;
  endsAt: number;
  source: string;
}

export interface EventInstanceState {
  eventId: string;
  startedAt: number;
  endsAt: number;
  claimedRewardIds: string[];
}

export interface EntitlementState {
  active: boolean;
  purchasedAt: number;
  expiresAt: number | null;
}

export interface AdPlacementState {
  lastShownAt: number;
  shownToday: number;
  /** Local day key (`YYYY-MM-DD`) used to reset daily counters. */
  dayKey: string;
}

export interface SettingsState {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  hapticsEnabled: boolean;
  reducedMotion: boolean;
  showFloatingNumbers: boolean;
  language: string;
}

export interface TutorialState {
  completed: boolean;
  skipped: boolean;
  currentStepId: string | null;
  completedStepIds: string[];
}

export interface StatsState {
  sessionsStarted: number;
  playTimeMs: number;
  totalTaps: number;
  buildingsUnlocked: number;
  buildingsRestored: number;
  upgradesCompleted: number;
  offlineRewardsClaimed: number;
  rewardedAdsWatched: number;
  /** Lifetime currency statistics, mirrored from the economy system. */
  lifetimeEarned: Record<CurrencyKind, number>;
  lifetimeSpent: Record<CurrencyKind, number>;
  /** Aggregate transaction counters keyed by direction/currency/reason. */
  reasonCounters: Record<string, { count: number; total: number }>;
}

export interface TimestampsState {
  /** When this save was first created. */
  createdAt: number;
  /** When the state last changed (updated by the state store). */
  updatedAt: number;
  /** When the game was last closed/saved - the offline-progression anchor. */
  lastSessionTime: number;
  /** When the current/previous session started. */
  sessionStartedAt: number;
  /** When the last offline report was computed. */
  lastOfflineComputedAt: number | null;
  /** When an offline reward was last claimed. */
  lastOfflineClaimedAt: number | null;
}

export interface GameState {
  /** Informational mirror of the save envelope schema version. */
  schemaVersion: number;
  currencies: CurrencyState;
  progression: ProgressionState;
  buildings: Record<BuildingId, BuildingState>;
  upgrades: {
    active: Record<UpgradeId, ActiveUpgradeState>;
    completed: UpgradeId[];
  };
  timers: Record<TimerId, TimerState>;
  workers: WorkerState[];
  districts: Record<DistrictId, DistrictProgressState>;
  mastery: Record<MasteryTrackId, MasteryState>;
  boosts: BoostState[];
  events: {
    active: EventInstanceState[];
    completedIds: string[];
  };
  entitlements: Record<EntitlementId, EntitlementState>;
  ads: {
    placements: Record<string, AdPlacementState>;
  };
  settings: SettingsState;
  tutorial: TutorialState;
  stats: StatsState;
  timestamps: TimestampsState;
  /** Generic content flags (e.g. "cafe_intro_seen"). Kept typed + centralized. */
  flags: Record<string, string | number | boolean>;
  /** Seed for deterministic content rolls (events, cosmetics…). */
  rngSeed: number;
}
