import type { EconomyBalanceConfig } from '@/core/types/content';
import type { ContentRegistry } from '@/core/content/ContentRegistry';

/**
 * BALANCE TUNING SURFACE
 * ======================
 * Canonical balance values live with the content that uses them
 * (`src/data/economy/balance.ts`). This module is the *tuning* surface: one place to see
 * and override the numbers during development without editing content files.
 *
 * Rules:
 * - Balance changes are content changes: never spread balance maths through systems.
 * - Overrides are only applied when `applyDevBalanceOverrides` is called explicitly by
 *   debug tooling, so release behaviour is exactly what content says.
 */
export { ECONOMY_BALANCE } from '@/data/economy/balance';

/** Honest notes about which numbers are tuned and which are still placeholders. */
export const BALANCE_TUNING_NOTES = {
  restorationTable: 'Phase 1 Old Café tiers are set from the design brief and verified by tests (13,750 coins total).',
  offlineEfficiency: 'Phase 1 pays 100% of the live rate, capped at 4 hours.',
  startingWallet: '500 coins / 0 gems: enough for the first two (instant) restoration steps.',
  acceleration: 'Placeholder monetisation balance (1 gem per remaining minute, minimum 1); not final.',
  rewardedRewards: 'Phase 1 values (8% bonus coins clamped 50-500, 25% speed-up capped at 15 min, 2x/30 min boost).',
} as const;

/** Development-only overrides. Empty by design - add entries while tuning locally. */
export const DEV_BALANCE_OVERRIDES: Partial<EconomyBalanceConfig> = {};

/** Applies `DEV_BALANCE_OVERRIDES` on top of loaded content (debug builds only). */
export function applyDevBalanceOverrides(content: ContentRegistry): boolean {
  const overrides = DEV_BALANCE_OVERRIDES;
  if (Object.keys(overrides).length === 0) return false;
  content.overrideEconomyBalance(overrides);
  return true;
}
