import type { ContentRegistry } from '@/core/content/ContentRegistry';
import { DisposableBag } from '@/core/Disposable';
import { logger } from '@/core/Logger';
import { AUTOSAVE_INTERVAL_MS, SAVE_ON_HIDDEN, SAVE_SCHEMA_VERSION, STORAGE_KEYS } from '@/core/constants/GameConstants';
import type { EventBus } from '@/core/events/EventBus';
import { DEFAULT_SETTINGS, DEFAULT_TUTORIAL } from '@/core/types/settings';
import type { GameState } from '@/core/types/state';
import type { StorageDriver } from '@/core/types/services';
import type { GameClock } from '@/core/Time';
import { createDefaultGameState, structuredCloneSafe } from './GameStateFactory';
import { asGameState, runMigrations } from './Migrations';
import { deserializeState, sanitizeState, serializeState, validateStateShape } from './SaveSchema';

/**
 * THE save system. The only writer and reader of persisted game state.
 *
 * Contract (see docs/SAVE_SYSTEM.md):
 * - `save()` / `load()` / `hasSave()` / `reset()` / `migrate()` are the public API.
 * - Scenes and systems never touch storage or `JSON.stringify` a save themselves.
 * - Every load path ends in a *valid* `GameState`: corrupted saves fall back to a fresh
 *   default state (after archiving the bad blob so it can be inspected), and recoverable
 *   problems are repaired by `sanitizeState`.
 * - The save timestamp is the anchor for offline progression, so it is written on every
 *   save and on visibility change.
 */

export interface SaveSystemOptions {
  readonly storage: StorageDriver;
  readonly content: ContentRegistry;
  readonly clock: GameClock;
  /** Optional: save-system lifecycle events (kept narrow on purpose). */
  readonly events?: EventBus;
  readonly gameVersion?: string;
  /** Autosave cadence in ms. `0` disables the periodic autosave (tests). */
  readonly autosaveIntervalMs?: number;
  /** Set false in tests so no window/document listeners are registered. */
  readonly handleVisibility?: boolean;
}

export interface LoadResult {
  readonly state: GameState;
  readonly status: 'fresh' | 'loaded' | 'recovered';
  readonly issues: readonly string[];
  readonly migratedFrom: number | null;
}

export interface SaveResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly bytes?: number;
}

export class SaveSystem {
  private readonly bag = new DisposableBag();
  private readonly storage: StorageDriver;
  private readonly content: ContentRegistry;
  private readonly clock: GameClock;
  private readonly gameVersion: string;
  private readonly autosaveIntervalMs: number;

  private state: GameState | null = null;
  private dirty = false;
  private lastSaveResult: SaveResult = { ok: true };

  constructor(options: SaveSystemOptions) {
    this.storage = options.storage;
    this.content = options.content;
    this.clock = options.clock;
    this.gameVersion = options.gameVersion ?? '0.1.0';
    this.autosaveIntervalMs = options.autosaveIntervalMs ?? AUTOSAVE_INTERVAL_MS;

    if (options.handleVisibility !== false) {
      this.watchVisibility();
    }
    this.startAutosave();
  }

  /** The live state reference. Systems hold this too; the save system owns its lifetime. */
  get current(): GameState {
    if (!this.state) {
      throw new Error('SaveSystem.load() must be called before accessing current state');
    }
    return this.state;
  }

  get hasState(): boolean {
    return this.state !== null;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  get lastResult(): SaveResult {
    return this.lastSaveResult;
  }

  /** True when a readable save blob exists in storage. */
  hasSave(): boolean {
    return this.storage.read(STORAGE_KEYS.save) !== null;
  }

  /** Epoch ms of the last successful save, or null when there is none. */
  getLastSavedAt(): number | null {
    const envelope = this.peekEnvelope();
    return envelope?.savedAt ?? null;
  }

  /**
   * Loads the save if present, otherwise creates a fresh state.
   * Always resolves - the game must be playable even with a hostile storage layer.
   */
  load(): LoadResult {
    const now = this.clock.now();
    const raw = this.storage.read(STORAGE_KEYS.save);
    const issues: string[] = [];

    if (raw === null) {
      this.setState(this.createFreshState(now, false), issues);
      logger.info('save', 'no save found - starting a new game');
      return { state: this.current, status: 'fresh', issues, migratedFrom: null };
    }

    const parsed = deserializeState(raw);
    issues.push(...parsed.issues);

    if (!parsed.state) {
      // Unreadable blob: archive it instead of destroying evidence, then start fresh.
      this.archiveCorrupted(raw);
      this.setState(this.createFreshState(now, false), issues);
      logger.warn('save', `save could not be parsed (${parsed.issues.join(', ')}) - started a new game`);
      return { state: this.current, status: 'recovered', issues, migratedFrom: parsed.schemaVersion };
    }

    let migratedFrom: number | null = null;
    let candidate = parsed.state as unknown as Record<string, unknown>;

    if (parsed.schemaVersion !== SAVE_SCHEMA_VERSION) {
      const outcome = runMigrations(candidate, parsed.schemaVersion);
      if (outcome.failed) {
        // A save from the future (or an unmigratable past) is treated as unrecoverable.
        this.archiveCorrupted(raw);
        this.setState(this.createFreshState(now, false), issues);
        issues.push(outcome.failed);
        logger.warn('save', `${outcome.failed} - started a new game`);
        return { state: this.current, status: 'recovered', issues, migratedFrom: parsed.schemaVersion };
      }
      candidate = outcome.state;
      migratedFrom = parsed.schemaVersion;
      logger.info('save', `migrated save ${outcome.fromVersion} -> ${outcome.toVersion}`, outcome.applied);
    }

    const state = asGameState(candidate);
    state.schemaVersion = SAVE_SCHEMA_VERSION;

    // Repair pass, then merge defaults for slices the player never had.
    const repairs = sanitizeState(state, this.content.getAllStages().map((stage) => stage.id));
    issues.push(...repairs);
    this.applyDefaults(state);

    const validation = validateStateShape(state);
    if (!validation.isValid) {
      issues.push(...validation.all.map((issue) => `${issue.path}: ${issue.message}`));
      logger.warn('save', `loaded state has recoverable problems: ${validation.toString()}`);
      if (repairs.length === 0) {
        // Nothing was repairable: treat as a damaged save and fall back to a fresh state.
        this.archiveCorrupted(raw);
        this.setState(this.createFreshState(now, false), issues);
        return { state: this.current, status: 'recovered', issues, migratedFrom };
      }
    }

    // Continuing an existing run: remember it, so systems can tell "resumed" from "new".
    state.session.resumed = true;
    state.profile.sessionCount += 1;
    state.session.startedAt = now;

    this.setState(state, issues);
    return { state: this.current, status: 'loaded', issues, migratedFrom };
  }

  /** Persists the current state. Never throws; callers get a result object. */
  save(reason = 'manual'): SaveResult {
    if (!this.state) {
      this.lastSaveResult = { ok: false, reason: 'no state loaded' };
      return this.lastSaveResult;
    }

    const now = this.clock.now();
    this.state.session.lastSaveAt = now;
    this.state.analytics.lastSessionAt = now;

    let payload: string;
    try {
      payload = serializeState(this.state, { gameVersion: this.gameVersion, now });
    } catch (error) {
      logger.error('save', 'serialisation failed', error);
      this.lastSaveResult = { ok: false, reason: 'serialisation failed' };
      return this.lastSaveResult;
    }

    const ok = this.storage.write(STORAGE_KEYS.save, payload);
    this.lastSaveResult = ok
      ? { ok: true, bytes: payload.length }
      : { ok: false, reason: `storage write failed (${this.storage.name})` };

    if (ok) {
      this.dirty = false;
      logger.debug('save', `saved (${reason})`, { bytes: payload.length });
    } else {
      // Quota/permission problems must be visible: offline progression depends on it.
      logger.warn('save', `save failed: ${this.lastSaveResult.reason}`);
    }

    return this.lastSaveResult;
  }

  /** Marks state as changed so the next autosave/visibility event persists it. */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Wipes persisted data and restarts from a fresh state. Debug/QA + "new game".
   *
   * The new state is written *into* the existing object rather than replacing it: every
   * system holds a `GameState` reference, and swapping the reference would leave them
   * mutating a detached object (a subtle, very confusing class of bug).
   */
  reset(options: { keepSettings?: boolean } = {}): GameState {
    const now = this.clock.now();
    const previous = this.state;
    const fresh = this.createFreshState(now, false);
    if (options.keepSettings && previous) {
      fresh.settings = structuredCloneSafe(previous.settings);
    }

    const target = this.state ?? fresh;
    if (this.state) replaceStateContents(this.state, fresh);

    this.setState(target, ['save reset']);
    this.save('reset');
    logger.info('save', 'save reset');
    return target;
  }

  /** Removes every persisted key this game owns (used by the debug panel). */
  wipe(): void {
    for (const key of this.storage.keys()) {
      this.storage.remove(key);
    }
    logger.info('save', 'all persisted data removed');
  }

  dispose(): void {
    this.bag.dispose();
  }

  // --- internals -----------------------------------------------------------

  private setState(state: GameState, issues: string[]): void {
    this.state = state;
    this.dirty = false;
    if (issues.length > 0) {
      logger.debug('save', `state issues: ${issues.join('; ')}`);
    }
  }

  private createFreshState(now: number, resumed: boolean): GameState {
    const state = createDefaultGameState({ now, content: this.content });
    state.session.resumed = resumed;
    state.profile.sessionCount = 1;
    return state;
  }

  /** Merges missing slices with defaults so old saves gain new fields safely. */
  private applyDefaults(state: GameState): void {
    if (!state.settings || typeof state.settings !== 'object') {
      state.settings = structuredCloneSafe(DEFAULT_SETTINGS);
    } else {
      state.settings = {
        ...structuredCloneSafe(DEFAULT_SETTINGS),
        ...state.settings,
        audio: { ...DEFAULT_SETTINGS.audio, ...(state.settings.audio ?? {}) },
        display: { ...DEFAULT_SETTINGS.display, ...(state.settings.display ?? {}) },
        gameplay: { ...DEFAULT_SETTINGS.gameplay, ...(state.settings.gameplay ?? {}) },
      };
    }

    if (!state.tutorial || typeof state.tutorial !== 'object') {
      state.tutorial = structuredCloneSafe(DEFAULT_TUTORIAL);
    } else {
      state.tutorial = { ...structuredCloneSafe(DEFAULT_TUTORIAL), ...state.tutorial };
      if (!Array.isArray(state.tutorial.completedStepIds)) state.tutorial.completedStepIds = [];
    }

    if (!state.analytics || typeof state.analytics !== 'object') {
      state.analytics = {
        totalCoinsEarned: 0,
        totalCoinsSpent: 0,
        totalGemsEarned: 0,
        totalGemsSpent: 0,
        lastSessionAt: state.session?.lastSaveAt ?? this.clock.now(),
      };
    }

    if (!state.profile || typeof state.profile !== 'object') {
      state.profile = {
        playerId: 'recovered',
        createdAt: this.clock.now(),
        saveCount: 0,
        sessionCount: 0,
      };
    }

    if (!state.redevelopment || typeof state.redevelopment !== 'object') {
      state.redevelopment = { level: 0, points: 0 };
    }

    if (!state.session || typeof state.session !== 'object') {
      const now = this.clock.now();
      state.session = { startedAt: now, lastSaveAt: now, playTimeMs: 0, resumed: true };
    }

    // Workers are content-driven: make sure every known worker has a state row.
    for (const worker of this.content.getWorkers()) {
      if (!state.workers.entries[worker.id]) {
        state.workers.entries[worker.id] = { id: worker.id, unlocked: false, assignedBuildingId: null };
      }
    }
  }

  private archiveCorrupted(raw: string): void {
    const ok = this.storage.write(STORAGE_KEYS.backup, raw);
    if (!ok) logger.warn('save', 'could not archive the corrupted save (storage write failed)');
    this.storage.remove(STORAGE_KEYS.save);
  }

  private peekEnvelope(): { savedAt: number; schemaVersion: number } | null {
    const raw = this.storage.read(STORAGE_KEYS.save);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { savedAt?: number; schemaVersion?: number };
      if (typeof parsed.savedAt !== 'number') return null;
      return { savedAt: parsed.savedAt, schemaVersion: parsed.schemaVersion ?? 0 };
    } catch {
      return null;
    }
  }

  private startAutosave(): void {
    if (this.autosaveIntervalMs <= 0) return;
    const timer = globalThis.setInterval(() => {
      if (this.dirty && this.state) this.save('autosave');
    }, this.autosaveIntervalMs);
    this.bag.add(() => globalThis.clearInterval(timer));
  }

  private watchVisibility(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const onVisibilityChange = (): void => {
      if (SAVE_ON_HIDDEN && document.visibilityState === 'hidden' && this.state) {
        // Mobile browsers may kill the tab without further warning: always persist here.
        this.save('visibility-hidden');
      }
    };
    const onPageHide = (): void => {
      if (SAVE_ON_HIDDEN && this.state) this.save('pagehide');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    this.bag.add(() => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    });
  }
}


/**
 * Copies every top-level key of `source` onto `target`, removing keys that no longer exist.
 * `GameState` is a plain JSON tree, so this is a faithful in-place replacement.
 */
export function replaceStateContents(target: GameState, source: GameState): void {
  for (const key of Object.keys(target) as Array<keyof GameState>) {
    if (!(key in source)) {
      delete (target as unknown as Record<string, unknown>)[key as string];
    }
  }
  for (const [key, value] of Object.entries(source)) {
    (target as unknown as Record<string, unknown>)[key] = value;
  }
}
