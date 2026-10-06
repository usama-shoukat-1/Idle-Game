/**
 * Default economy balance.
 *
 * ⚠️ PHASE 0 PLACEHOLDER VALUES - NOT TUNED. These numbers exist so the systems
 * have a shape to read from; real balancing happens once the first playable
 * building exists (Phase 1+). Tuning must happen here (data), never inside systems.
 */

import type { EconomyBalanceDefinition } from '@/core/types/content';
import { HOUR, MINUTE } from '@/core/utils/time';

export const DEFAULT_BALANCE: EconomyBalanceDefinition = {
  id: 'default',
  displayName: 'Default Balance',
  startingCoins: 0,
  startingGems: 0,
  globalIncomeMultiplier: 1,
  incomeTickMs: 1_000,

  offline: {
    enabled: true,
    // Placeholder: a four-hour ceiling is a common mobile-first starting point.
    maxOfflineMs: 4 * HOUR,
    // Below a minute there is nothing worth interrupting the player for.
    minElapsedMs: MINUTE,
    // Placeholder efficiency. Explicitly not a tuned economy decision.
    efficiency: 0.5,
    enhancedEfficiency: 1,
    enhancedDurationMs: 30 * MINUTE,
  },

  // Redevelopment/prestige is out of scope for Phase 0; the flag documents intent.
  redevelopment: { enabled: false, currencyId: 'blueprints' },
};
