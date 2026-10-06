import { SAVE_SCHEMA_VERSION } from '@/core/constants/GameConstants';
import { logger } from '@/core/Logger';
import type { GameState } from '@/core/types/state';

/**
 * SAVE MIGRATIONS
 * ===============
 * A migration is a pure function that upgrades a state from version N to N+1.
 *
 * Rules for every future migration (see docs/SAVE_SYSTEM.md):
 * 1. Never mutate the input in place - return a new object.
 * 2. Be idempotent-safe: running a migration twice must not double-apply bonuses.
 * 3. Never throw on missing fields: fall back to the safe default and let
 *    `sanitizeState` finish the repairs.
 * 4. Add a test in tests/save-system.test.ts.
 *
 * Phase 0 ships schema version 1 (the initial schema) and an empty chain: there is
 * nothing older to migrate from yet. The plumbing below is what makes future schema
 * changes safe, and it is exercised by tests that migrate from synthetic old versions.
 */

export type MigrationFn = (state: Record<string, unknown>) => Record<string, unknown>;

export interface Migration {
  readonly from: number;
  readonly to: number;
  readonly description: string;
  readonly migrate: MigrationFn;
}

/** The ordered chain. Append-only. */
export const MIGRATIONS: readonly Migration[] = [
  // Example of the shape a future migration takes (kept as documentation, not code):
  //
  // {
  //   from: 1,
  //   to: 2,
  //   description: 'add district synergy multipliers',
  //   migrate: (state) => ({ ...state, synergy: { multipliers: {} } }),
  // },
];

export interface MigrationOutcome {
  readonly state: Record<string, unknown>;
  readonly applied: readonly string[];
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly failed?: string;
}

/**
 * Runs the migration chain until the state reaches `SAVE_SCHEMA_VERSION`.
 * Unknown *future* versions are NOT migrated backwards; the caller decides whether to
 * reject them (see SaveSystem.load).
 */
export function runMigrations(
  state: Record<string, unknown>,
  fromVersion: number,
  targetVersion: number = SAVE_SCHEMA_VERSION,
): MigrationOutcome {
  const applied: string[] = [];
  let current = state;
  let version = fromVersion;

  if (version > targetVersion) {
    return {
      state,
      applied,
      fromVersion,
      toVersion: version,
      failed: `save is from a newer build (schema ${version} > ${targetVersion})`,
    };
  }

  // Bound the loop so a malformed chain can never hang the boot sequence.
  let guard = 0;
  while (version < targetVersion && guard < 64) {
    guard += 1;
    const step = MIGRATIONS.find((migration) => migration.from === version);
    if (!step) {
      return {
        state: current,
        applied,
        fromVersion,
        toVersion: version,
        failed: `no migration path from schema ${version} to ${targetVersion}`,
      };
    }
    try {
      current = step.migrate(current);
      version = step.to;
      current = { ...current, schemaVersion: version };
      applied.push(`${step.from}->${step.to}: ${step.description}`);
    } catch (error) {
      logger.error('save', `migration ${step.from}->${step.to} failed`, error);
      return {
        state: current,
        applied,
        fromVersion,
        toVersion: version,
        failed: `migration ${step.from}->${step.to} threw`,
      };
    }
  }

  return { state: current, applied, fromVersion, toVersion: version };
}

/** Typed view of a migrated record, used right before sanitisation. */
export function asGameState(record: Record<string, unknown>): GameState {
  return record as unknown as GameState;
}
