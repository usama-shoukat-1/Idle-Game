/**
 * Save schema migrations.
 *
 * Rule: never edit an existing migration once a build has shipped it. Add a new
 * entry keyed by the version it migrates *from* (N upgrades data from schema N to
 * N+1) and bump `SAVE_SCHEMA_VERSION`.
 *
 * Example (when the schema moves to 2):
 *
 * ```ts
 * const migrations: SaveMigrationTable = {
 *   1: (data) => {
 *     const record = data as Record<string, unknown>;
 *     return { ...record, newSection: { /* defaults *\/ } };
 *   },
 * };
 * ```
 */

import { createLogger } from '@/core/utils/logger';
import { SAVE_SCHEMA_VERSION } from '@/core/types/save';

export type SaveMigration = (data: unknown) => unknown;
export type SaveMigrationTable = Record<number, SaveMigration>;

/** Phase 0 has a single schema version, so there is nothing to migrate yet. */
export const SAVE_MIGRATIONS: SaveMigrationTable = {};

export interface MigrationOutcome {
  data: unknown;
  /** Version the payload started at. */
  fromVersion: number;
  /** True when at least one migration ran. */
  migrated: boolean;
  /** Set when the payload is newer than this build understands. */
  fromFuture: boolean;
  error?: string;
}

const log = createLogger('save:migrations');

export function runMigrations(
  data: unknown,
  fromVersion: number,
  targetVersion: number = SAVE_SCHEMA_VERSION,
  table: SaveMigrationTable = SAVE_MIGRATIONS,
): MigrationOutcome {
  if (fromVersion > targetVersion) {
    return {
      data,
      fromVersion,
      migrated: false,
      fromFuture: true,
      error: `save schema v${fromVersion} is newer than supported v${targetVersion}`,
    };
  }

  let current = data;
  let version = fromVersion;
  let migrated = false;

  while (version < targetVersion) {
    const migration = table[version];
    if (!migration) {
      // No migration registered: the validator will repair field by field, which
      // is the documented Phase 0 behaviour for unknown/legacy payloads.
      log.warn(`no migration registered for v${version} -> v${version + 1}; relying on repair`);
      break;
    }
    try {
      current = migration(current);
    } catch (error) {
      return {
        data: current,
        fromVersion,
        migrated,
        fromFuture: false,
        error: `migration v${version} -> v${version + 1} failed: ${String(error)}`,
      };
    }
    version += 1;
    migrated = true;
    log.info(`migrated save v${version - 1} -> v${version}`);
  }

  return { data: current, fromVersion, migrated, fromFuture: false };
}
