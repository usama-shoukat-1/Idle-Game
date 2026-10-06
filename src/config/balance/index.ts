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

/** Numbers that are NOT yet tuned, with the intention recorded for Phase 1. */
export const BALANCE_TUNING_NOTES = {
  offlineEfficiency: 'Intentionally 0 in Phase 0: offline progression is wired but awards nothing until tuned.',
  startingWallet: 'Placeholder starter coins/gems so the economy and HUD are observable during QA.',
  acceleration: 'Placeholder gem-per-minute conversion for instant finishes.',
  rewardedRewards: 'Placeholder amounts; real rewarded-ad economy is designed with retention data.',
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
