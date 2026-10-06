import { MS_PER_HOUR, MS_PER_MINUTE, asDurationMs, seconds } from '@/core/types/primitives';
import type { EconomyBalanceConfig } from '@/core/types/content';

/**
 * ECONOMY BALANCE
 * ===============
 * Every number the economy uses lives here so balancing is a content change, never a
 * code change.
 *
 * NOTE (Phase 0): the values below are PLACEHOLDERS that exist to prove the systems
 * work end to end. They are explicitly NOT the final game balance - income curves,
 * offline efficiency, upgrade costs, prestige pacing and monetisation values are all
 * Phase 1+ work. `offline.efficiency: 0` is deliberate: offline progression is wired up
 * but awards nothing until it is tuned.
 */
export const ECONOMY_BALANCE: EconomyBalanceConfig = {
  /** Placeholder starter wallet so the HUD and economy APIs are observable in QA. */
  startingCoins: 50,
  startingGems: 5,

  /** Overflow guards for the wallet (not balance values). */
  maxCoins: 1e18,
  maxGems: 1e9,

  offline: {
    /** Clamp offline time to 14 days: beyond that the simulation is meaningless. */
    maxDurationMs: asDurationMs(14 * 24 * MS_PER_HOUR),
    /** PLACEHOLDER: share of the online rate earned while away. Tuned in Phase 1. */
    efficiency: 0,
    /** Do not bother the player with a summary for a 30 second absence. */
    minimumDurationMs: asDurationMs(2 * MS_PER_MINUTE),
  },

  /** PLACEHOLDER gem-acceleration conversion. Phase 1 tunes this against the curve. */
  acceleration: {
    gemsPerMinute: 1,
    minimumGems: 1,
  },

  /**
   * Rewarded-ad rewards are CONTENT, not code. These two entries let QA exercise the
   * mock ad flow; the real reward economy is designed later.
   */
  rewardedRewards: [
    {
      id: 'reward.bonus_coins',
      kind: 'coins',
      amount: 100,
      cooldownMs: asDurationMs(0),
      displayName: 'Bonus Coins',
      description: 'PLACEHOLDER: watch an ad to receive a small pile of coins.',
    },
    {
      id: 'reward.time_skip',
      kind: 'timeSkip',
      amount: seconds(15),
      cooldownMs: asDurationMs(0),
      displayName: 'Quick Finish',
      description: 'PLACEHOLDER: watch an ad to cut 15 seconds off the current upgrade.',
    },
  ],
};
