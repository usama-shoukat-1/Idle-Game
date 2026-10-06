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
  /** Rewarded ads. Phase 1 wires the opt-in flow to a MOCK provider only. */
  readonly rewardedAds: boolean;
  /** In-app purchases. Phase 1 ships a MOCK store with a development gem catalog. */
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
  /**
   * Phase 1 ships OPT-IN rewarded ads against the mock provider: the flow, cooldowns,
   * analytics and rewards are real, the network is not. Flipping this off hides every ad
   * affordance without touching gameplay code.
   */
  rewardedAds: true,
  /** Same story for the store: a mock provider and a development gem catalog. */
  purchases: true,
  layoutDebugOverlay: false,
};

/**
 * STORE CATALOG
 * =============
 * Development catalog: the mock store reports these three products. No real product id is
 * ever referenced - see docs/MONETIZATION_ARCHITECTURE.md.
 *
/**
 * PHASE 1 DEVELOPMENT CATALOG (MOCK ONLY)
 * ======================================
 * Three gem packs the mock store offers so the purchase flow, the entitlement bookkeeping
 * and the gem economy can be exercised end to end. The `productId`s are the game's own
 * keys; the platform SKU (and the real price) is resolved by the provider - which is why
 * no App Store / Play Store identifier appears anywhere in this repository.
 *
 * These are NOT final commercial values (see docs/MONETIZATION_ARCHITECTURE.md).
 */
export const STORE_CATALOG: readonly StoreCatalogEntry[] = [
  {
    productId: 'gems.small',
    displayName: 'Handful of Gems',
    description: 'A small pouch of gems for instant finishes.',
    kind: 'consumable',
    grants: { gems: 100 },
  },
  {
    productId: 'gems.medium',
    displayName: 'Bag of Gems',
    description: 'A tidy bag of gems, best value for mid-game upgrades.',
    kind: 'consumable',
    grants: { gems: 600 },
  },
  {
    productId: 'gems.large',
    displayName: 'Crate of Gems',
    description: 'A whole crate of gems for players who never want to wait.',
    kind: 'consumable',
    grants: { gems: 1500 },
  },
];

/** Mock price labels shown while the store is a development stub. */
export const MOCK_STORE_PRICES: Readonly<Record<string, string>> = {
  'gems.small': 'mock · 99¢',
  'gems.medium': 'mock · $4.99',
  'gems.large': 'mock · $9.99',
};

/** Entitlement names the game understands (used by future remove-ads / premium gates). */
export const ENTITLEMENTS = {
  removeAds: 'entitlement.remove_ads',
  premiumDistrict: 'entitlement.premium_district',
} as const;
