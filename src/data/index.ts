import type { ContentBundle } from '@/core/content/ContentRegistry';
import { BUILDINGS } from './buildings';
import { UPGRADES } from './upgrades';
import { WORKERS } from './workers';
import { DISTRICTS, STAGES } from './districts/district_01_old_town';
import { ECONOMY_BALANCE } from './economy/balance';

export { BUILDINGS } from './buildings';
export { UPGRADES } from './upgrades';
export { WORKERS } from './workers';
export { DISTRICTS, STAGES, DISTRICT_IDS, STAGE_IDS, DEFAULT_STAGE_ID } from './districts/district_01_old_town';
export { ECONOMY_BALANCE } from './economy/balance';
export { GAME_EVENTS, type GameEventScheduleDefinition } from './events';

/**
 * THE content bundle.
 *
 * This is the only place content modules are aggregated. The registry in
 * `src/core/content/ContentRegistry` never imports from `src/data`, so content stays replaceable (e.g. a future remote
 * content pack or a live-ops payload can assemble the same bundle).
 */
export const DEFAULT_CONTENT: ContentBundle = {
  districts: DISTRICTS,
  stages: STAGES,
  buildings: BUILDINGS,
  upgrades: UPGRADES,
  workers: WORKERS,
  economy: ECONOMY_BALANCE,
};
