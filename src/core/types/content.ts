import type { BuildingId, DurationMs, StageId, UpgradeId, WorkerId } from './primitives';
import type { Cost } from './settings';

/**
 * CONTENT MODEL
 * =============
 * Everything the player can progress through is described by plain data registered in
 * a ContentRegistry. Scenes and systems never contain building-specific logic: they ask
 * the registry for a definition and operate on generic fields.
 *
 * Adding content = new data file + one registration line.
 * See docs/DATA_MODEL.md and docs/DEVELOPMENT_RULES.md.
 */

/** Categories of building. Drives presentation + which systems apply. */
export type BuildingType =
  | 'cafe'
  | 'retail'
  | 'workshop'
  | 'studio'
  | 'theatre'
  | 'market'
  | 'service'
  | 'landmark';

/** How a building produces income. Keep this list short and generic. */
export type IncomeModel =
  | { readonly kind: 'perInterval'; readonly coinsPerInterval: number; readonly intervalMs: DurationMs }
  | { readonly kind: 'perSecond'; readonly coinsPerSecond: number }
  | { readonly kind: 'flat'; readonly coins: number };

/** A single restoration/business tier of a building. Index === tier number. */
export interface RestorationTierDefinition {
  /** Must equal the tier's index in the containing array (validated by the registry). */
  readonly tier: number;
  readonly displayName: string;
  /** Cost to reach this tier (tier 0 is usually free / "as found"). */
  readonly cost: Cost;
  /** Duration of the restoration work. Zero = instant upgrade. */
  readonly durationMs: DurationMs;
  /** Multiplier applied to the building's base income once this tier is active. */
  readonly incomeMultiplier: number;
  /** Visual state key this tier renders as (art is content, not code). */
  readonly visualState: string;
  /** Upgrade ids that must be completed before this tier can be bought. */
  readonly prerequisites: readonly UpgradeId[];
  /** Content ids unlocked when this tier completes (new buildings, features, workers). */
  readonly unlocks: readonly string[];
}

/** Art/animation mapping per visual state, resolved by the presentation layer. */
export interface VisualStateDefinition {
  readonly key: string;
  /** Texture keys per layer, e.g. { facade: 'building/cafe/facade_2' }. */
  readonly layers: Readonly<Record<string, string>>;
  readonly description?: string;
}

/** Rules that let restored buildings boost each other inside a district. */
export interface SynergyRule {
  readonly id: string;
  readonly description: string;
  /** Building ids that must be at or above `minTier` for the rule to be active. */
  readonly requires: ReadonlyArray<{ readonly buildingId: BuildingId; readonly minTier: number }>;
  /** Percent bonus applied to the listed targets (10 === +10%). */
  readonly bonusPercent: number;
  /** Empty array === applies to every building in the district. */
  readonly appliesTo: readonly BuildingId[];
}

export interface UnlockRequirement {
  readonly kind: 'stage' | 'building' | 'upgrade' | 'mastery' | 'currency';
  /** Id of the referenced content (stage/building/upgrade), when applicable. */
  readonly id?: string;
  /** Minimum tier/mastery/amount when applicable. */
  readonly value?: number;
}

export interface BuildingDefinition {
  readonly id: BuildingId;
  readonly displayName: string;
  /** Short player-facing blurb for the info panel. */
  readonly description: string;
  readonly stageId: StageId;
  readonly type: BuildingType;
  /** Ordering inside a stage's list; also used for unlock sequencing. */
  readonly order: number;
  /** Income at tier 0 (as found). Tiers multiply this. */
  readonly baseIncome: IncomeModel;
  /** Tier definitions, index === tier. */
  readonly restorationTiers: readonly RestorationTierDefinition[];
  /** Visual state catalog for this building, keyed by `visualState`. */
  readonly visualStates: readonly VisualStateDefinition[];
  readonly unlockRequirements: readonly UnlockRequirement[];
  readonly synergyRules: readonly SynergyRule[];
  /** Optional placeholder texture keys for Phase 0-style flat rendering. */
  readonly placeholder?: {
    /** Base colour used to draw the placeholder block, e.g. '#5b6b7c'. */
    readonly tint: string;
    /** Icon glyph or texture key for the map marker. */
    readonly iconKey?: string;
  };
}

export interface UpgradeDefinition {
  readonly id: UpgradeId;
  readonly displayName: string;
  readonly description: string;
  readonly targetBuildingId: BuildingId;
  /** Tier this upgrade belongs to (usually matches the tier it unlocks). */
  readonly tier: number;
  readonly cost: Cost;
  /** Total work time. `0` means an instant upgrade. */
  readonly durationMs: DurationMs;
  /** Multiplier on the building's income while/after this upgrade is active. */
  readonly incomeMultiplier: number;
  /** Content ids unlocked on completion (buildings, features, workers). */
  readonly unlocks: readonly string[];
  readonly visualState: string;
  readonly prerequisites: readonly UpgradeId[];
  /** Optional per-upgrade UX flags (e.g. whether a rewarded-ad speed-up is offered). */
  readonly options?: {
    /** Allow the player to finish this upgrade early with gems (Phase 1+ tuning). */
    readonly gemAcceleration?: boolean;
    /** Allow an opt-in rewarded ad to reduce the remaining time. */
    readonly rewardedTimeSkip?: boolean;
  };
}

/** A district groups stages under one city area and owns its theme/palette. */
export interface DistrictDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly order: number;
  /** Stages inside this district, in unlock order. */
  readonly stageIds: readonly StageId[];
  /** Presentation hook only: palette/texture prefix, no gameplay meaning. */
  readonly theme: {
    readonly backgroundTint: string;
    readonly accentColour: string;
  };
}

export interface StageDefinition {
  readonly id: StageId;
  readonly displayName: string;
  readonly description: string;
  readonly order: number;
  /** Buildings owned by this stage, in presentation order. */
  readonly buildingIds: readonly BuildingId[];
  readonly unlockRequirements: readonly UnlockRequirement[];
  /** District-level bonuses, applied multiplicatively. */
  readonly synergy: {
    /** Mastery points required to consider the stage mastered. */
    readonly masteryMax: number;
    /** Percent income bonus granted per 100% district synergy. */
    readonly synergyScalePercent: number;
  };
}

/** Economy knobs. Centralised so balancing never requires touching systems. */
export interface EconomyBalanceConfig {
  readonly startingCoins: number;
  readonly startingGems: number;
  /** Hard caps for the wallet. Prevents numeric overflow in the UI. */
  readonly maxCoins: number;
  readonly maxGems: number;
  /** Offline progression policy (numbers intentionally neutral in Phase 0). */
  readonly offline: {
    /** Maximum simulated offline time. */
    readonly maxDurationMs: DurationMs;
    /** Share of the online rate the player keeps while away, 0..1. */
    readonly efficiency: number;
    /** Minimum elapsed time before an offline summary is produced. */
    readonly minimumDurationMs: DurationMs;
  };
  /** Conversion used when the player spends gems to finish an upgrade instantly. */
  readonly acceleration: {
    /** Gems charged per remaining minute of an upgrade. */
    readonly gemsPerMinute: number;
    /** Floor so a nearly finished upgrade still costs something reasonable. */
    readonly minimumGems: number;
  };
  /** Rewarded-ad rewards the game may offer. Amounts are content, not code. */
  readonly rewardedRewards: readonly RewardedRewardDefinition[];
}

export type RewardedRewardKind =
  | 'coins'
  | 'gems'
  | 'timeSkip'
  | 'incomeMultiplier'
  | 'offlineBoost';

export interface RewardedRewardDefinition {
  readonly id: string;
  readonly kind: RewardedRewardKind;
  /** Amount semantics depend on `kind` (coins, gems, ms skipped, multiplier, percent). */
  readonly amount: number;
  /** Cooldown before the same reward can be requested again. */
  readonly cooldownMs: DurationMs;
  readonly displayName: string;
  readonly description: string;
}

export interface WorkerDefinition {
  readonly id: WorkerId;
  readonly displayName: string;
  /** Cost to hire. */
  readonly hireCost: Cost;
  /** Income multiplier this worker adds to its assigned building. */
  readonly incomeMultiplier: number;
  /** Automatic collection interval, if the worker automates a building. */
  readonly automationIntervalMs?: DurationMs;
}
