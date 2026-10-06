/**
 * Provider-independent monetization contracts.
 *
 * Phase 0 ships mock implementations only: no ad network SDK, no store SDK, and
 * no hard-coded AdMob / StoreKit / Play product identifiers anywhere.
 */

import type { AdPlacementId, EntitlementId, ProductId, TimerId } from './ids';

/* ------------------------------------------------------------------ rewards */

export type RewardGrantKind =
  | 'coins'
  | 'gems'
  | 'timer-reduction'
  | 'income-boost'
  | 'offline-enhance'
  | 'entitlement'
  | 'flag';

export interface RewardGrant {
  kind: RewardGrantKind;
  /** Currency amount, multiplier, or reduction ms depending on `kind`. */
  amount?: number;
  /** Target (building/district/timer). `undefined` = global/nearest context. */
  targetId?: string;
  durationMs?: number;
  entitlementId?: EntitlementId;
  /** Player-facing label, also used by the reward popup. */
  label: string;
}

/* -------------------------------------------------------------- rewarded ads */

export type RewardedAdOutcome =
  | 'granted'
  | 'dismissed'
  | 'cooldown'
  | 'unavailable'
  | 'error';

export interface RewardedAdResult {
  placementId: AdPlacementId;
  outcome: RewardedAdOutcome;
  /** Present when `outcome` is not `granted`. */
  message?: string;
}

export interface AdRewardService {
  /** Provider name for debugging/telemetry (e.g. "mock", "admob"). */
  readonly providerName: string;
  isAvailable(): boolean;
  /** Fire-and-forget warm-up; safe to call repeatedly. */
  preload(placementIds: AdPlacementId[]): Promise<void>;
  /**
   * Show an opt-in rewarded ad. The player must have explicitly asked for this;
   * implementations must never make a rewarded view mandatory.
   */
  show(placementId: AdPlacementId): Promise<RewardedAdResult>;
}

/** Options for the mock service, so QA can exercise every branch. */
export interface MockAdRewardOptions {
  available?: boolean;
  /** Simulated latency before the result resolves. */
  latencyMs?: number;
  /** Force a specific outcome instead of using `dismissedProbability`. */
  forcedOutcome?: RewardedAdOutcome;
  /** 0..1 chance a shown ad is dismissed early. */
  dismissedProbability?: number;
}

/* ------------------------------------------------------------------ purchases */

export type PurchaseStatus =
  | 'completed'
  | 'cancelled'
  | 'pending'
  | 'failed'
  | 'unavailable';

export interface PurchaseResult {
  productId: ProductId;
  status: PurchaseStatus;
  /** Provider-side transaction id (mock providers synthesize one). */
  transactionId?: string;
  message?: string;
}

export interface StoreProduct {
  productId: ProductId;
  /** Localized, provider-supplied price string - never hard-coded in game code. */
  priceLabel: string;
  available: boolean;
}

export interface PurchaseService {
  readonly providerName: string;
  isAvailable(): boolean;
  /** Returns provider price info for the enabled catalogue entries. */
  listProducts(productIds: ProductId[]): Promise<StoreProduct[]>;
  purchase(productId: ProductId): Promise<PurchaseResult>;
  /** Re-applies non-consumable entitlements (App Store requirement). */
  restore(): Promise<PurchaseResult[]>;
}

export interface MockPurchaseOptions {
  available?: boolean;
  latencyMs?: number;
  forcedStatus?: PurchaseStatus;
  cancelledProbability?: number;
}

/* --------------------------------------------------------------- cooldowns */

export interface PlacementCooldownState {
  placementId: AdPlacementId;
  remainingMs: number;
  shownToday: number;
  dailyLimitReached: boolean;
}

/* ------------------------------------------------------------------ helpers */

/** Context the dispatcher needs to apply timer-reduction grants. */
export interface RewardContext {
  /** Chooses the timer to shorten when a grant has no `targetId`. */
  resolveTimerId?: (grant: RewardGrant) => TimerId | undefined;
  /** Timestamp used for timestamp-anchored boost/entitlement grants. */
  now: number;
}
