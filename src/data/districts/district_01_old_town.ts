import type { StageId } from '@/core/types/primitives';
import type { DistrictDefinition, StageDefinition } from '@/core/types/content';
import { asDurationMs } from '@/core/types/primitives';
import { BUILDING_IDS, DISTRICT_IDS, STAGE_IDS } from '@/data/ids';

export { DISTRICT_IDS, STAGE_IDS } from '@/data/ids';

/**
 * District 01 - the first city district.
 *
 * Phase 1 opens the neighbourhood stage and registers the Old Café as its first building.
 * The stage structure (and the placeholder second stage) stays exactly as Phase 0 defined
 * it: adding the next location is still a content edit, not an engine change.
 */

export const STAGE_OLD_NEIGHBORHOOD: StageDefinition = {
  id: STAGE_IDS.oldNeighborhood,
  displayName: 'Old Neighborhood',
  description: 'A quiet street of shuttered shops. Restoring the café reopens it.',
  order: 0,
  // Phase 1: the Old Café is the stage's first (and only) building.
  buildingIds: [BUILDING_IDS.oldCafe],
  unlockRequirements: [],
  synergy: {
    masteryMax: 100,
    synergyScalePercent: 0,
  },
};

/**
 * Placeholder for the Phase 1 opening flow. Registered but not yet used by any
 * building; it only proves that stage gating is data-driven.
 */
export const STAGE_OLD_TOWN_SQUARE: StageDefinition = {
  id: 'stage.old_town.square' as StageId,
  displayName: 'Old Town Square',
  description: 'Unlocked after the street is restored and district synergy reaches its first threshold.',
  order: 1,
  buildingIds: [],
  unlockRequirements: [
    { kind: 'stage', id: STAGE_IDS.oldNeighborhood },
    { kind: 'mastery', id: STAGE_IDS.oldNeighborhood, value: 0 },
  ],
  synergy: {
    masteryMax: 100,
    synergyScalePercent: 0,
  },
};

export const DISTRICTS: readonly DistrictDefinition[] = [
  {
    id: DISTRICT_IDS.oldTown,
    displayName: 'Old Town',
    description: 'A weathered district of shuttered storefronts. Restoring it reopens the city.',
    order: 0,
    stageIds: [STAGE_IDS.oldNeighborhood, STAGE_OLD_TOWN_SQUARE.id],
    theme: {
      backgroundTint: '#2b3547',
      accentColour: '#f2b544',
    },
  },
];

export const STAGES: readonly StageDefinition[] = [STAGE_OLD_NEIGHBORHOOD, STAGE_OLD_TOWN_SQUARE];

/** Default stage a brand new save starts in. */
export const DEFAULT_STAGE_ID: StageId = STAGE_IDS.oldNeighborhood;

/** Neutral duration helper kept for content authors to copy from. */
export const CONTENT_DURATION_EXAMPLE_MS = asDurationMs(0);
