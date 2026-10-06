/**
 * Economy content pack (balances, monetization catalogue).
 *
 * The active balance lives in `src/config/balance` because it is a tuning
 * decision rather than content. This pack is where additional balance variants
 * (A/B, seasonal, hard mode) and the monetization catalogue will live.
 *
 * ⚠️ PHASE 0: no products and no rewarded-ad placements are shipped, and any
 * future entry must never contain real store/AdMob identifiers - those come from
 * the platform adapter at runtime.
 */

import type { EconomyBalanceDefinition, ProductCatalogEntry, RewardedAdPlacementDefinition } from '@/core/types/content';
import { DEFAULT_BALANCE } from '@/config/balance/defaultBalance';

/** Balance variants available to the game (the active one is chosen by GameConfig). */
export const BALANCES: EconomyBalanceDefinition[] = [DEFAULT_BALANCE];

/** Gem packs / boosts / remove-ads / premium content. Empty until monetization ships. */
export const PRODUCTS: ProductCatalogEntry[] = [];

/** Opt-in rewarded placements (bonus coins, time skip, boost, offline boost). */
export const AD_PLACEMENTS: RewardedAdPlacementDefinition[] = [];
