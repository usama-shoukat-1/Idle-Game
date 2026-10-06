import { MS_PER_HOUR, MS_PER_MINUTE, asDurationMs } from '@/core/types/primitives';
import type { EconomyBalanceConfig } from '@/core/types/content';

/**
 * ECONOMY BALANCE - PHASE 1 (Old Café vertical slice)
 * ==================================================
 * Every number the economy uses lives here, so balancing is always a content change and
 * never a code change. The systems read generic fields; nothing below is hard-coded in a
 * scene, a system or the UI.
 *
 * These are the *starting* Phase 1 values from the design brief, not final commercial
 * tuning: the curve is deliberately generous early (a new player sees two restorations in
 * the first couple of minutes) and gated on waiting later, which is the point of an idle
 * game. See docs/PHASE_1_OLD_CAFE.md for the full table and the reasoning.
 */
export const ECONOMY_BALANCE: EconomyBalanceConfig = {
  /** New players start with enough coins for the first restoration step (75). */
  startingCoins: 500,
  startingGems: 0,

  /** Overflow guards for the wallet (not balance values). */
  maxCoins: 1e18,
  maxGems: 1e9,

  offline: {
    /** Offline income is capped at 4 hours: come back daily, not monthly. */
    maxDurationMs: asDurationMs(4 * MS_PER_HOUR),
    /** Phase 1 pays the full rate while away (the cap, not the rate, is the limiter). */
    efficiency: 1,
    /** Ignore absences shorter than a minute - not worth a popup. */
    minimumDurationMs: asDurationMs(1 * MS_PER_MINUTE),
  },

  /**
   * Gem acceleration: 1 gem per remaining minute, clamped so the cost can never exceed
   * the remaining time. Placeholder monetisation balance, kept in content on purpose.
   */
  acceleration: {
    gemsPerMinute: 1,
    minimumGems: 1,
  },

  /**
   * Rewarded-ad rewards. All four are strictly opt-in and all four are data:
   * amounts, caps, durations and cooldowns can be retuned without touching code.
   */
  rewardedRewards: [
    {
      id: 'reward.bonus_coins',
      kind: 'coins',
      /** Fallback when no upgrade is available to scale from. */
      amount: 50,
      dynamic: {
        kind: 'percentOfNextUpgradeCost',
        percent: 8,
        minAmount: 50,
        maxAmount: 500,
      },
      cooldownMs: asDurationMs(5 * MS_PER_MINUTE),
      displayName: 'Bonus Coins',
      description: 'Coins scaled to your next restoration step.',
      actionLabel: 'WATCH AD → BONUS COINS',
    },
    {
      id: 'reward.upgrade_speedup',
      kind: 'timeSkip',
      /** Fallback when the dynamic rule cannot be evaluated. */
      amount: asDurationMs(15 * MS_PER_MINUTE),
      dynamic: {
        kind: 'percentOfRemainingUpgradeTime',
        percent: 25,
        // Never remove more than 15 minutes per view: long upgrades stay long.
        maxAmount: asDurationMs(15 * MS_PER_MINUTE),
      },
      cooldownMs: asDurationMs(5 * MS_PER_MINUTE),
      displayName: 'Speed Up',
      description: 'Cut a quarter off the current restoration (max 15 minutes).',
      actionLabel: 'WATCH AD → SPEED UP',
    },
    {
      id: 'reward.income_boost',
      kind: 'incomeMultiplier',
      amount: 2,
      durationMs: asDurationMs(30 * MS_PER_MINUTE),
      cooldownMs: asDurationMs(20 * MS_PER_MINUTE),
      displayName: 'Double Income',
      description: 'Doubles the café income for 30 minutes.',
      actionLabel: 'WATCH AD → 2× INCOME',
    },
    {
      id: 'reward.offline_double',
      kind: 'offlineBoost',
      amount: 2,
      /** Only ever offered from the offline summary popup, once per absence. */
      cooldownMs: asDurationMs(0),
      displayName: 'Double Offline Earnings',
      description: 'Doubles the offline earnings you are about to collect.',
      actionLabel: 'WATCH AD → 2× REWARD',
    },
  ],
};
