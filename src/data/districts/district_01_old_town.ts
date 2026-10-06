import { stageId, type StageId } from '@/core/types/primitives';
import type { DistrictDefinition, StageDefinition } from '@/core/types/content';
import { asDurationMs } from '@/core/types/primitives';

/**
 * District 01 - the first city district.
 *
 * Phase 0 registers the *structure* only: one district with one stage and an empty
 * building list. Phase 1 fills `buildingIds` and adds the Old Café content without any
 * change to engine code.
 */

export const STAGE_IDS = {
  oldTownStreet: stageId('stage.old_town.street'),
} as const;

export const DISTRICT_IDS = {
  oldTown: 'district.old_town',
} as const;

export const STAGE_OLD_TOWN_STREET: StageDefinition = {
  id: STAGE_IDS.oldTownStreet,
  displayName: 'Old Town Street',
  description: 'The first street the player reopens. Its district synergy feeds every later stage.',
  order: 0,
  // Intentionally empty in Phase 0 - the first building is added as pure content later.
  buildingIds: [],
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
  id: stageId('stage.old_town.square'),
  displayName: 'Old Town Square',
  description: 'Unlocked after the street is restored and district synergy reaches its first threshold.',
  order: 1,
  buildingIds: [],
  unlockRequirements: [
    { kind: 'stage', id: STAGE_IDS.oldTownStreet },
    { kind: 'mastery', id: STAGE_IDS.oldTownStreet, value: 0 },
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
    stageIds: [STAGE_IDS.oldTownStreet, STAGE_OLD_TOWN_SQUARE.id],
    theme: {
      backgroundTint: '#2b3547',
      accentColour: '#f2b544',
    },
  },
];

export const STAGES: readonly StageDefinition[] = [STAGE_OLD_TOWN_STREET, STAGE_OLD_TOWN_SQUARE];

/** Default stage a brand new save starts in. */
export const DEFAULT_STAGE_ID: StageId = STAGE_IDS.oldTownStreet;

/** Neutral duration helper kept for content authors to copy from. */
export const CONTENT_DURATION_EXAMPLE_MS = asDurationMs(0);
