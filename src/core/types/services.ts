/**
 * Service contracts (provider-independent boundaries).
 *
 * Anything that talks to the outside world - storage, ads, purchase stores, audio
 * backends - is hidden behind a narrow interface so gameplay code never depends on a
 * vendor SDK. Phase 0 ships development/mock implementations of all of these.
 */

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface StorageDriver {
  /** Stable name for logs/debug (`localStorage`, `memory`, `cloud`). */
  readonly name: string;
  isAvailable(): boolean;
  read(key: string): string | null;
  write(key: string, value: string): boolean;
  remove(key: string): void;
  /** All keys this driver owns under the game's namespace. */
  keys(): string[];
}

// ---------------------------------------------------------------------------
// Rewarded ads
// ---------------------------------------------------------------------------

export type AdAvailability = 'available' | 'loading' | 'unavailable' | 'cooldown';

export interface RewardedAdResult {
  /** True only when the provider confirmed the user watched to the reward threshold. */
  readonly rewarded: boolean;
  /** Provider-agnostic status for analytics/debug. */
  readonly status: 'rewarded' | 'dismissed' | 'failed' | 'unavailable';
  readonly placementId: string;
  readonly error?: string;
}

/**
 * Rewarded ads are strictly opt-in: the player must tap a button that says what they
 * get. No interstitial/forced formats are represented here by design.
 */
export interface RewardedAdService {
  readonly providerName: string;
  /** Preload/prime the provider (no UI). Safe to call repeatedly. */
  initialize(): Promise<void>;
  /** Whether a reward for this placement could be shown right now. */
  getAvailability(placementId: string): AdAvailability;
  /**
   * Show the ad for a placement. Resolves with the provider's verdict; it never
   * grants the in-game reward itself - the caller (AdRewardSystem) does that only
   * when `rewarded === true`.
   */
  show(placementId: string): Promise<RewardedAdResult>;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Purchases / billing
// ---------------------------------------------------------------------------

export interface StoreProduct {
  /** Store-agnostic product key. The concrete store id is resolved by the provider. */
  readonly productId: string;
  readonly displayName: string;
  readonly description: string;
  /** Price in the store's localised price string, e.g. "4,99 €" - never hard-coded. */
  readonly localizedPrice: string;
  readonly kind: 'consumable' | 'nonConsumable' | 'subscription';
}

export interface PurchaseResult {
  readonly status: 'purchased' | 'cancelled' | 'pending' | 'failed' | 'unavailable';
  readonly productId: string;
  /** Provider receipt/token - opaque to gameplay code; validated server-side later. */
  readonly receipt?: string;
  readonly error?: string;
}

export interface PurchaseService {
  readonly providerName: string;
  initialize(): Promise<void>;
  getProducts(): Promise<readonly StoreProduct[]>;
  purchase(productId: string): Promise<PurchaseResult>;
  /** Restore previously bought non-consumables (required by mobile stores). */
  restore(): Promise<readonly string[]>;
  owns(productId: string): boolean;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Analytics (stub boundary - real SDK arrives with the platform build)
// ---------------------------------------------------------------------------

export interface AnalyticsService {
  readonly providerName: string;
  track(event: string, payload?: Readonly<Record<string, string | number | boolean>>): void;
}

export const NOOP_ANALYTICS: AnalyticsService = {
  providerName: 'noop',
  track: () => {
    /* intentionally empty */
  },
};
