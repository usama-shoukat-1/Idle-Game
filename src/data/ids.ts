import { buildingId, stageId, upgradeId } from '@/core/types/primitives';

/**
 * CONTENT IDS
 * ===========
 * Ids live in their own module because content files reference each other (a stage lists
 * its buildings, a building names its stage, an upgrade targets a building). Keeping the
 * keys here means those data files can import ids without importing each other - i.e. no
 * import cycles, whatever order content is later split into.
 *
 * Ids are stable, stringly-typed, and never shown to the player.
 */

export const STAGE_IDS = {
  /** Phase 1 stage: the Old Café's street. */
  oldNeighborhood: stageId('stage_old_neighborhood'),
} as const;

export const DISTRICT_IDS = {
  oldTown: 'district.old_town',
} as const;

export const BUILDING_IDS = {
  oldCafe: buildingId('building_old_cafe'),
} as const;

export const UPGRADE_IDS = {
  oldCafeTier: (tier: number): ReturnType<typeof upgradeId> =>
    upgradeId(`old_cafe_tier_${String(tier).padStart(2, '0')}`),
  oldCafeTier01: upgradeId('old_cafe_tier_01'),
  oldCafeTier02: upgradeId('old_cafe_tier_02'),
  oldCafeTier03: upgradeId('old_cafe_tier_03'),
  oldCafeTier04: upgradeId('old_cafe_tier_04'),
  oldCafeTier05: upgradeId('old_cafe_tier_05'),
  oldCafeTier06: upgradeId('old_cafe_tier_06'),
  oldCafeTier07: upgradeId('old_cafe_tier_07'),
  oldCafeTier08: upgradeId('old_cafe_tier_08'),
  oldCafeTier09: upgradeId('old_cafe_tier_09'),
  oldCafeTier10: upgradeId('old_cafe_tier_10'),
} as const;
