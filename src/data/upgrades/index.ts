import type { UpgradeDefinition } from '@/core/types/content';

/**
 * UPGRADE CONTENT
 * ===============
 * Phase 0 ships no upgrades: the UpgradeSystem engine (instant, timed, prerequisites,
 * gem acceleration hooks, completion events) is fully implemented and tested against
 * synthetic definitions in tests/upgrade-engine.test.ts.
 *
 * Every upgrade must target an existing building and must be referenced by the tier it
 * unlocks. Adding one is a data change only.
 */
export const UPGRADES: readonly UpgradeDefinition[] = [];
