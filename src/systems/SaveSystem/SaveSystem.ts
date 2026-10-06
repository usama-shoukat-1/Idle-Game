/**
 * Versioned local save system.
 *
 * Responsibilities: serialize/deserialize the envelope, run migrations, validate
 * and repair untrusted payloads, and expose reset for development. Nothing else
 * in the codebase is allowed to touch browser storage directly.
 */

import type { Clock } from '@/core/Clock';
import type { GameConfig } from '@/core/GameConfig';
import type { GameState } from '@/core/types/gameState';
import type {
  LoadResult,
  SaveInfo,
  SaveReason,
  SaveResult,
  SaveStatus,
  StorageAdapter,
} from '@/core/types/save';
import { SAVE_SCHEMA_VERSION } from '@/core/types/save';
import type { ValidationResult } from '@/core/utils/validation';
import { collectIssueMessages } from '@/core/utils/validation';
import { createLogger } from '@/core/utils/logger';
import type { GameEventBus } from '@/systems/EventSystem';
import { createSaveEnvelope, parseSaveEnvelope, stringifyEnvelope } from './SaveSchema';
import { runMigrations } from './SaveMigrations';

export type StateValidator = (raw: unknown, now: number) => ValidationResult<GameState>;

export interface SaveSystemDeps {
  storage: StorageAdapter;
  clock: Clock;
  config: GameConfig;
  events: GameEventBus;
  /** Creates the pristine state used for reset and for unrepairable payloads. */
  createDefaultState: () => GameState;
  validate: StateValidator;
}

export class SaveSystem {
  private readonly log = createLogger('save');
  private lastSaveAt = 0;
  private saveCount = 0;

  constructor(private readonly deps: SaveSystemDeps) {}

  get storageName(): string {
    return this.deps.storage.name;
  }

  get stats(): { lastSaveAt: number; saveCount: number } {
    return { lastSaveAt: this.lastSaveAt, saveCount: this.saveCount };
  }

  hasSave(): boolean {
    return this.deps.storage.getItem(this.deps.config.storage.key) !== null;
  }

  /** Current save metadata without fully loading/repairing the state. */
  peek(): SaveStatus {
    const raw = this.deps.storage.getItem(this.deps.config.storage.key);
    if (raw === null) return { kind: 'no-save' };
    const parsed = parseSaveEnvelope(raw);
    if (!parsed) return { kind: 'no-save' };
    return {
      kind: 'ready',
      info: {
        schemaVersion: parsed.schemaVersion,
        savedAt: parsed.savedAt,
        appVersion: parsed.appVersion,
      },
    };
  }

  save(state: GameState, reason: SaveReason = 'manual'): SaveResult {
    const now = this.deps.clock.now();
    try {
      const envelope = createSaveEnvelope(state, now, this.deps.config.appVersion, SAVE_SCHEMA_VERSION);
      this.deps.storage.setItem(this.deps.config.storage.key, stringifyEnvelope(envelope));
      this.lastSaveAt = now;
      this.saveCount += 1;
      const info: SaveInfo = {
        schemaVersion: envelope.schemaVersion,
        savedAt: envelope.savedAt,
        appVersion: envelope.appVersion,
      };
      this.deps.events.emit('save:saved', { info, reason });
      this.log.debug(`saved (${reason}) at ${new Date(now).toISOString()}`);
      return { ok: true, info };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.events.emit('save:error', { message });
      this.log.error(`save failed (${reason})`, error);
      return { ok: false, info: null, error: message };
    }
  }

  load(): LoadResult {
    const now = this.deps.clock.now();
    const raw = this.deps.storage.getItem(this.deps.config.storage.key);

    if (raw === null) {
      return {
        ok: true,
        state: this.deps.createDefaultState(),
        info: null,
        migratedFrom: null,
        issues: [],
      };
    }

    const parsed = parseSaveEnvelope(raw);
    if (!parsed) {
      this.log.error('save payload is unreadable - starting fresh');
      return {
        ok: false,
        state: this.deps.createDefaultState(),
        info: null,
        migratedFrom: null,
        issues: ['save payload was not valid JSON'],
        error: 'unreadable-save',
      };
    }

    const migration = runMigrations(parsed.data, parsed.schemaVersion);
    if (migration.error) {
      this.log.warn(migration.error);
    }

    const validation = this.deps.validate(migration.data, now);
    const issues = [...collectIssueMessages(validation.issues)];
    if (!validation.ok) {
      this.log.warn('save required repairs', issues);
    }

    const info: SaveInfo = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: parsed.savedAt,
      appVersion: parsed.appVersion,
    };

    this.deps.events.emit('save:loaded', {
      info,
      migratedFrom: migration.migrated ? migration.fromVersion : null,
    });

    return {
      ok: validation.ok,
      state: validation.value,
      info,
      migratedFrom: migration.migrated ? migration.fromVersion : null,
      issues,
    };
  }

  /** Development/QA reset. Removes the payload and returns a fresh state. */
  reset(): GameState {
    const now = this.deps.clock.now();
    this.deps.storage.removeItem(this.deps.config.storage.key);
    this.lastSaveAt = 0;
    this.saveCount = 0;
    this.deps.events.emit('save:reset', { at: now });
    this.log.info('save reset');
    return this.deps.createDefaultState();
  }

  /** Raw text export (used by debug tools to copy a save out of the device). */
  exportRaw(state: GameState): string {
    return stringifyEnvelope(
      createSaveEnvelope(state, this.deps.clock.now(), this.deps.config.appVersion, SAVE_SCHEMA_VERSION),
    );
  }

  /** Import raw JSON produced by `exportRaw` (through the normal repair path). */
  importRaw(text: string): LoadResult {
    const parsed = parseSaveEnvelope(text);
    if (!parsed) {
      return {
        ok: false,
        state: null,
        info: null,
        migratedFrom: null,
        issues: [],
        error: 'import payload was not valid JSON',
      };
    }
    const migration = runMigrations(parsed.data, parsed.schemaVersion);
    const validation = this.deps.validate(migration.data, this.deps.clock.now());
    return {
      ok: validation.ok,
      state: validation.value,
      info: { schemaVersion: SAVE_SCHEMA_VERSION, savedAt: parsed.savedAt, appVersion: parsed.appVersion },
      migratedFrom: migration.migrated ? migration.fromVersion : null,
      issues: collectIssueMessages(validation.issues),
    };
  }
}
