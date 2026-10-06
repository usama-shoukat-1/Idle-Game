/**
 * Content packs -> registry.
 *
 * The single place that assembles content for the runtime. Adding a new building
 * or upgrade never requires touching this file (the arrays grow), and adding a new
 * pack type is one import + one line.
 */

import { ContentRegistry, type ContentRegistryInput } from '@/systems/ContentSystem/ContentRegistry';
import { BUILDINGS } from './buildings';
import { UPGRADES } from './upgrades';
import { DISTRICTS, MASTERY_TRACKS, STAGES } from './districts';
import { EVENTS } from './events';
import { AD_PLACEMENTS, BALANCES, PRODUCTS } from './economy';

export const CONTENT_PACKS: ContentRegistryInput = {
  buildings: BUILDINGS,
  upgrades: UPGRADES,
  stages: STAGES,
  districts: DISTRICTS,
  masteryTracks: MASTERY_TRACKS,
  events: EVENTS,
  balances: BALANCES,
  products: PRODUCTS,
  adPlacements: AD_PLACEMENTS,
};

/** Build a registry from the shipped content packs. */
export function buildContentRegistry(input: ContentRegistryInput = CONTENT_PACKS): ContentRegistry {
  const registry = new ContentRegistry();
  registry.load(input);
  registry.validate();
  return registry;
}

export { BUILDINGS, UPGRADES, STAGES, DISTRICTS, MASTERY_TRACKS, EVENTS, BALANCES, PRODUCTS, AD_PLACEMENTS };
