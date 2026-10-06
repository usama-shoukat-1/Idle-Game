/**
 * Building content pack.
 *
 * ⚠️ PHASE 0: intentionally EMPTY. The first playable building (the Old Café) is
 * Phase 1 work and must be added here as data - not wired into scenes or systems.
 *
 * To add a building:
 *
 * ```ts
 * import type { BuildingDefinition } from '@/core/types/content';
 *
 * export const BUILDINGS: BuildingDefinition[] = [
 *   {
 *     id: 'building.old-cafe',
 *     displayName: 'Old Café',
 *     stageId: 'stage.old-town',
 *     districtId: 'district.main-street',
 *     type: 'cafe',
 *     rarity: 'common',
 *     order: 1,
 *     baseIncome: 1,
 *     incomeIntervalMs: 1000,
 *     maxTier: 3,
 *     restorationTiers: [
 *       { tier: 0, id: 'tier.derelict', displayName: 'Derelict', visualStateId: 'derelict', upgradeIds: [], incomeMultiplier: 1 },
 *       { tier: 1, id: 'tier.cleaned',  displayName: 'Cleaned up', visualStateId: 'cleaned', upgradeIds: ['upgrade.cafe.clean'], incomeMultiplier: 2 },
 *     ],
 *     visualStates: [
 *       { id: 'derelict', label: 'Derelict', order: 0 },
 *       { id: 'cleaned', label: 'Cleaned up', order: 1 },
 *     ],
 *     upgradeIds: ['upgrade.cafe.clean'],
 *     unlockRequirements: { stageId: 'stage.old-town' },
 *   },
 * ];
 * ```
 *
 * Then export it from `src/data/index.ts` - no engine file needs to change.
 */

import type { BuildingDefinition } from '@/core/types/content';

export const BUILDINGS: BuildingDefinition[] = [];
