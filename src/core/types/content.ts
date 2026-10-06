/**
 * Content definition contracts (data-driven content lives in `src/data/**`).
 *
 * Nothing in here may reference a concrete building/upgrade/district: these are
 * the shapes a content author fills in. Core systems consume definitions
 * generically, which is what keeps new content from requiring engine edits.
 */

import type {
  AdPlacementId,
  BalanceId,
  BuildingId,
  DistrictId,
  EventId,
  MasteryTrackId,
  ProductId,
  StageId,
  UpgradeId,
} from './ids';
import type { CurrencyKind } from './economy';

export interface CurrencyCost {
  coins?: number;
  gems?: number;
}

export type BuildingType =
  | 'cafe'
  | 'shop'
  | 'service'
  | 'venue'
  | 'industry'
  | 'landmark'
  | 'utility';

export type BuildingRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** A visual state is an art/state swap point (e.g. derelict → restored). */
export interface VisualStateDefinition {
  id: string;
  label: string;
  /** Lower = earlier in the restoration journey. Used for ordering/lookups. */
  order: number;
  /** Future art key. `undefined` means "render the procedural placeholder". */
  textureKey?: string;
}

export interface RestorationTierDefinition {
  /** 0 = as-found. Each tier is reached through the listed upgrades. */
  tier: number;
  id: string;
  displayName: string;
  visualStateId: string;
  upgradeIds: UpgradeId[];
  /** Minimum income multiplier granted by reaching this tier. */
  incomeMultiplier: number;
}

export interface UnlockRequirementDefinition {
  stageId?: StageId;
  buildingId?: BuildingId;
  minTier?: number;
  cost?: CurrencyCost;
  /** 0..1 share of the district that must be restored. */
  districtProgress?: number;
  masteryLevel?: number;
}

export interface SynergyRuleDefinition {
  id: string;
  scope: 'district' | 'stage' | 'global';
  /** Buildings that must be restored (tier >= 1) for the rule to apply. */
  requiresBuildingIds?: BuildingId[];
  /** 1.15 = +15% income. */
  incomeMultiplier: number;
}

export interface BuildingDefinition {
  id: BuildingId;
  displayName: string;
  description?: string;
  stageId: StageId;
  districtId: DistrictId;
  type: BuildingType;
  rarity: BuildingRarity;
  /** Authoring order inside its district. */
  order: number;
  /** Coins produced per `incomeIntervalMs` at tier 0, before any modifiers. */
  baseIncome: number;
  incomeIntervalMs: number;
  maxTier: number;
  restorationTiers: RestorationTierDefinition[];
  visualStates: VisualStateDefinition[];
  upgradeIds: UpgradeId[];
  unlockRequirements?: UnlockRequirementDefinition;
  synergyRules?: SynergyRuleDefinition[];
  /** Reserved for the worker system (Phase 2+). */
  workerSlots?: number;
  tags?: string[];
}

/* ------------------------------------------------------------------ upgrades */

export type UpgradeKind =
  | 'instant'
  | 'timed'
  | 'tier-restoration'
  | 'automation'
  | 'capacity'
  | 'cosmetic';

export type UpgradeTarget =
  | { kind: 'building'; buildingId: BuildingId }
  | { kind: 'district'; districtId: DistrictId }
  | { kind: 'global' };

export type UpgradeEffectType =
  | 'income-multiplier'
  | 'income-add'
  | 'income-interval'
  | 'unlock-building'
  | 'unlock-district'
  | 'visual-state'
  | 'worker-slot'
  | 'offline-capacity'
  | 'flag';

export type EffectMode = 'add' | 'set' | 'multiply';

export interface UpgradeEffectDefinition {
  type: UpgradeEffectType;
  /** Numeric magnitude for numeric effects; unused for id-targeted effects. */
  value: number;
  /** Target id for `unlock-building` / `unlock-district` / `visual-state` / `flag`. */
  targetId?: string;
  /** Default: 'add' for numeric bonuses, 'set' for id effects. */
  mode?: EffectMode;
}

export interface UpgradePrerequisiteDefinition {
  upgradeId?: UpgradeId;
  buildingId?: BuildingId;
  minTier?: number;
  stageId?: StageId;
  masteryLevel?: number;
}

export interface UpgradeDefinition {
  id: UpgradeId;
  displayName: string;
  description?: string;
  target: UpgradeTarget;
  kind: UpgradeKind;
  /** Tier the target reaches once this upgrade completes (0 for utility upgrades). */
  tier: number;
  cost: CurrencyCost;
  /** 0 = instant upgrade. */
  durationMs: number;
  /**
   * Gems charged per remaining minute when skipping a timed upgrade.
   * `undefined` disables gem acceleration for this upgrade.
   */
  gemSkipRatePerMinute?: number;
  /** Replaces bespoke `incomeMultiplier`/`unlocks` fields with one data-driven list. */
  effects: UpgradeEffectDefinition[];
  prerequisites?: UpgradePrerequisiteDefinition[];
  /** Visual state applied on completion (must exist on the target building). */
  visualStateId?: string;
  repeatable?: boolean;
  maxPurchases?: number;
  iconKey?: string;
}

/* ------------------------------------------------------- stages / districts */

export interface StageDefinition {
  id: StageId;
  displayName: string;
  description?: string;
  order: number;
  districtIds: DistrictId[];
  unlockRequirements?: UnlockRequirementDefinition;
  /** Share of the stage's buildings that must be restored to master the stage. */
  masteryTarget?: number;
}

export interface DistrictDefinition {
  id: DistrictId;
  stageId: StageId;
  displayName: string;
  description?: string;
  order: number;
  buildingIds: BuildingId[];
  synergyRules?: SynergyRuleDefinition[];
  masteryTrackId?: MasteryTrackId;
  unlockRequirements?: UnlockRequirementDefinition;
}

export interface MasteryTrackDefinition {
  id: MasteryTrackId;
  displayName: string;
  /** XP required per level, index = level. */
  levelCurve: number[];
  /** Income multiplier per mastery level. */
  incomeMultiplierPerLevel: number;
}

/* --------------------------------------------------------------- economy */

export interface OfflineBalanceDefinition {
  enabled: boolean;
  /** Hard cap on credited offline time. Phase 0 value is a placeholder. */
  maxOfflineMs: number;
  /** Below this, offline time is absorbed silently instead of showing a popup. */
  minElapsedMs: number;
  /** 0..1 share of income credited while offline. Placeholder, untuned. */
  efficiency: number;
  /** Efficiency used when an "enhanced offline reward" is active. */
  enhancedEfficiency: number;
  enhancedDurationMs: number;
}

export interface EconomyBalanceDefinition {
  id: BalanceId;
  displayName: string;
  startingCoins: number;
  startingGems: number;
  /** Global income multiplier applied last (difficulty dial). */
  globalIncomeMultiplier: number;
  /** How often accrual is flushed to the wallet. */
  incomeTickMs: number;
  offline: OfflineBalanceDefinition;
  /** Redev/prestige is out of scope for Phase 0; the flag keeps the door open. */
  redevelopment?: { enabled: boolean; currencyId: string };
}

/* ---------------------------------------------------------------- events */

export type EventKind = 'limited-time' | 'seasonal' | 'daily' | 'story';

export interface EventModifierDefinition {
  type: 'income-multiplier' | 'upgrade-speed' | 'offline-efficiency';
  value: number;
  scopeBuildingIds?: BuildingId[];
  scopeDistrictIds?: DistrictId[];
}

export interface EventDefinition {
  id: EventId;
  displayName: string;
  description?: string;
  kind: EventKind;
  durationMs: number;
  startAt?: number;
  cooldownMs?: number;
  modifiers?: EventModifierDefinition[];
  rewardIds?: string[];
  unlockRequirements?: UnlockRequirementDefinition;
}

/* ------------------------------------------------------- monetization data */

/**
 * Rewarded ads are always an explicit player choice; `requiresOptIn` is a
 * literal `true` so a definition cannot accidentally ship as forced.
 */
export interface RewardedAdPlacementDefinition {
  id: AdPlacementId;
  displayName: string;
  description?: string;
  requiresOptIn: true;
  grants: import('./monetization').RewardGrant[];
  cooldownMs: number;
  maxPerDay?: number;
}

export interface ProductCatalogEntry {
  id: ProductId;
  displayName: string;
  description?: string;
  kind: 'consumable' | 'non-consumable' | 'subscription';
  grants: import('./monetization').RewardGrant[];
  /**
   * Store ids are supplied by the platform adapter at runtime. Never hard-code
   * AdMob/StoreKit/Play product identifiers in game code or content.
   */
  storeProductId?: string;
  enabled: boolean;
}

/**
 * A read-only slice of all registered content.
 *
 * Core code (default state, save validation, offline estimates) depends on this
 * small shape instead of the registry implementation, which keeps the dependency
 * direction one-way: systems -> core.
 */
export interface ContentSnapshot {
  buildings: BuildingDefinition[];
  upgrades: UpgradeDefinition[];
  districts: DistrictDefinition[];
  stages: StageDefinition[];
  masteryTracks: MasteryTrackDefinition[];
}

export interface EntitlementDefinition {
  id: string;
  displayName: string;
  description?: string;
  kind: 'remove-ads' | 'permanent-boost' | 'premium-content' | 'subscription';
  grants?: import('./monetization').RewardGrant[];
  currency?: CurrencyKind;
  multiplier?: number;
}
