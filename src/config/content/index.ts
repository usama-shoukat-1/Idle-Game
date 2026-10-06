import type { StoreCatalogEntry } from '@/systems/PurchaseSystem/PurchaseSystem';

/**
 * BUILD-TIME CONTENT & FEATURE CONFIGURATION
 * ==========================================
 *
 * HOW TO ADD A BUILDING (the Phase 1 path, no engine changes):
 *   1. add `src/data/buildings/building_XXX.ts` exporting a `BuildingDefinition`
 *   2. push it into `BUILDINGS` in `src/data/buildings/index.ts`
 *   3. reference its id from the stage in `src/data/districts/*`
 *   4. add tier upgrades in `src/data/upgrades/`
 * That is the whole process - the economy, UI and save layers read definitions only.
 */

export interface FeatureFlags {
  /** Debug tools (cheats, state inspector, FPS). Release builds must ship `false`. */
  readonly debugTools: boolean;
  /** Rewarded ads. Phase 0 has no ad provider wired to a real network. */
  readonly rewardedAds: boolean;
  /** In-app purchases. Phase 0 has no billing provider and an empty catalog. */
  readonly purchases: boolean;
  /** Grid/line diagnostics: draw the design frame and touch targets. */
  readonly layoutDebugOverlay: boolean;
}

/**
 * Runtime flags. `debugTools` follows the Vite build mode so a production build can
 * never expose cheats (see docs/DEVELOPMENT_RULES.md).
 */
export const FEATURE_FLAGS: FeatureFlags = {
  debugTools: import.meta.env?.DEV ?? false,
  rewardedAds: false,
  purchases: false,
  layoutDebugOverlay: false,
};

/**
 * STORE CATALOG
 * =============
 * Phase 0 is intentionally EMPTY: no product id exists in the codebase, and the mock
 * store reports no products, so the UI renders its "store unavailable" state.
 *
 * A future entry looks like:
 *   { productId: 'gems.small', displayName: 'Pouch of Gems', description: '...',
 *     kind: 'consumable', grants: { gems: 100 } }
 *
 * The `productId` here is the game's own key. Mapping it to a platform SKU is the
 * provider's job (`PurchaseService`), which is why no store id appears in game code.
 */
export const STORE_CATALOG: readonly StoreCatalogEntry[] = [];

/** Entitlement names the game understands (used by future remove-ads / premium gates). */
export const ENTITLEMENTS = {
  removeAds: 'entitlement.remove_ads',
  premiumDistrict: 'entitlement.premium_district',
} as const;
