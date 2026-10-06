import type { UpgradeDefinition } from '@/core/types/content';
import { asDurationMs } from '@/core/types/primitives';
import { BUILDING_IDS, UPGRADE_IDS } from '@/data/ids';
import { OLD_CAFE_TIERS } from '@/data/buildings/building_old_cafe';

/**
 * OLD CAFÉ RESTORATION UPGRADES (tier 1..10)
 * ==========================================
 * One upgrade per restoration tier, chained by prerequisites so the café can only be
 * restored in order. Every number is read from the single balance table in
 * `building_old_cafe.ts`, so a rebalance is one edit and can never desync the two.
 *
 * Tier 1 and 2 are instant (they teach the loop immediately); tier 3 onwards is timed and
 * therefore survives a reload through the deadline-based TimerSystem.
 */

export const OLD_CAFE_UPGRADE_IDS = {
  tier01: UPGRADE_IDS.oldCafeTier01,
  tier02: UPGRADE_IDS.oldCafeTier02,
  tier03: UPGRADE_IDS.oldCafeTier03,
  tier04: UPGRADE_IDS.oldCafeTier04,
  tier05: UPGRADE_IDS.oldCafeTier05,
  tier06: UPGRADE_IDS.oldCafeTier06,
  tier07: UPGRADE_IDS.oldCafeTier07,
  tier08: UPGRADE_IDS.oldCafeTier08,
  tier09: UPGRADE_IDS.oldCafeTier09,
  tier10: UPGRADE_IDS.oldCafeTier10,
} as const;

const UPGRADE_IDS_BY_TIER = [
  OLD_CAFE_UPGRADE_IDS.tier01,
  OLD_CAFE_UPGRADE_IDS.tier02,
  OLD_CAFE_UPGRADE_IDS.tier03,
  OLD_CAFE_UPGRADE_IDS.tier04,
  OLD_CAFE_UPGRADE_IDS.tier05,
  OLD_CAFE_UPGRADE_IDS.tier06,
  OLD_CAFE_UPGRADE_IDS.tier07,
  OLD_CAFE_UPGRADE_IDS.tier08,
  OLD_CAFE_UPGRADE_IDS.tier09,
  OLD_CAFE_UPGRADE_IDS.tier10,
] as const;

function createUpgrades(): readonly UpgradeDefinition[] {
  return OLD_CAFE_TIERS.map((row, index) => {
    const previous = index > 0 ? UPGRADE_IDS_BY_TIER[index - 1]! : null;
    return {
      id: UPGRADE_IDS_BY_TIER[index]!,
      displayName: row.displayName,
      description: row.detail,
      targetBuildingId: BUILDING_IDS.oldCafe,
      tier: row.tier,
      cost: { currency: 'coins', amount: row.cost },
      durationMs: asDurationMs(row.durationMs),
      incomeMultiplier: row.incomePerMinute,
      unlocks: [],
      visualState: row.visualState,
      prerequisites: previous ? [previous] : [],
      options: {
        // Both accelerations are offered; the UI decides when they are worth showing.
        gemAcceleration: true,
        rewardedTimeSkip: true,
      },
    } satisfies UpgradeDefinition;
  });
}

export const UPGRADES_OLD_CAFE: readonly UpgradeDefinition[] = createUpgrades();
