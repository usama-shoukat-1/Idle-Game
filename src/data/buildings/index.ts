import type { BuildingDefinition } from '@/core/types/content';

/**
 * BUILDING CONTENT
 * ================
 * Phase 0 intentionally ships ZERO buildings.
 *
 * The first playable building (the Old Café) is a Phase 1 content task and must be
 * added here as data - never as logic in a scene or system. A registered building is
 * picked up automatically by BuildingSystem, UpgradeSystem, EconomySystem and the UI
 * because they only read `BuildingDefinition` fields.
 *
 * Minimal shape of the first entry (see docs/DATA_MODEL.md for the full contract):
 *
 *   {
 *     id: buildingId('building.old_town.cafe'),
 *     displayName: 'Old Café',
 *     stageId: STAGE_IDS.oldTownStreet,
 *     type: 'cafe',
 *     order: 0,
 *     baseIncome: { kind: 'perInterval', coinsPerInterval: 1, intervalMs: seconds(5) },
 *     restorationTiers: [ ... ],   // index === tier
 *     visualStates: [ ... ],
 *     unlockRequirements: [],
 *     synergyRules: [],
 *   }
 */
export const BUILDINGS: readonly BuildingDefinition[] = [];
