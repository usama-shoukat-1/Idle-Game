/**
 * Stage + district + mastery content packs.
 *
 * ⚠️ PHASE 0: intentionally EMPTY. Districts define the world structure
 * (WORLD -> STAGES -> DISTRICTS -> BUILDINGS). Adding the first district and stage
 * here is all that is required for progression to start working; the systems
 * already interpret the data.
 */

import type { DistrictDefinition, MasteryTrackDefinition, StageDefinition } from '@/core/types/content';

export const STAGES: StageDefinition[] = [];
export const DISTRICTS: DistrictDefinition[] = [];
export const MASTERY_TRACKS: MasteryTrackDefinition[] = [];
