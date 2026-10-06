import { MAX_TRANSACTION_LOG, SAVE_SCHEMA_VERSION, STORAGE_KEYS } from '@/core/constants/GameConstants';
import type { BoostState, GameState, TransactionLogEntry } from '@/core/types/state';
import { STATE_LIMITS } from '@/core/types/state';
import type { BuildingId, StageId, UpgradeId, WorkerId } from '@/core/types/primitives';
import { isBoolean, isObject, isStringArray, ValidationResult } from '@/core/utils/Validation';
import { isFiniteNumber } from '@/core/utils/NumberUtils';
import { normalizeCurrencyAmount } from '@/core/utils/NumberUtils';

/**
 * SAVE SCHEMA
 * ===========
 * The persisted envelope is deliberately separate from the in-memory `GameState`:
 *
 *   { schemaVersion, savedAt, gameVersion, checksum?, state }
 *
 * Why an envelope: migration chains must be able to read *which* schema produced a blob
 * before they can repair it, and the timestamp must be trustworthy even if the state
 * body is partly unreadable.
 *
 * Serialisation rules:
 * - Only data listed here is written, so runtime-only fields can never leak into a save.
 * - Validation is structural (types + ranges), not semantic: unknown/newer content ids
 *   are tolerated and reported through `issues` so play can continue with defaults.
 */

export interface SaveEnvelope {
  readonly schemaVersion: number;
  readonly savedAt: number;
  readonly gameVersion: string;
  /** ISO string so a save is debuggable from DevTools without tooling. */
  readonly savedAtIso: string;
  readonly state: GameState;
  /** Cheap corruption detector (djb2 of the serialised state). Not security. */
  readonly checksum: string;
}

export interface DeserializeResult {
  readonly state: GameState | null;
  readonly issues: readonly string[];
  readonly schemaVersion: number;
}

export interface SerializeOptions {
  readonly gameVersion: string;
  readonly now: number;
}

export function serializeState(state: GameState, options: SerializeOptions): string {
  const snapshot: GameState = {
    ...state,
    schemaVersion: state.schemaVersion,
    session: { ...state.session, lastSaveAt: options.now },
    profile: { ...state.profile, saveCount: state.profile.saveCount + 1 },
    transactions: state.transactions.slice(-MAX_TRANSACTION_LOG),
  };

  const envelope: SaveEnvelope = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: options.now,
    savedAtIso: new Date(options.now).toISOString(),
    gameVersion: options.gameVersion,
    state: snapshot,
    checksum: checksum(JSON.stringify(snapshot)),
  };

  return JSON.stringify(envelope);
}

/** Parses + structurally validates a save blob. Never throws. */
export function deserializeState(raw: string | null): DeserializeResult {
  if (!raw) return { state: null, issues: ['empty payload'], schemaVersion: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: null, issues: ['payload is not valid JSON'], schemaVersion: 0 };
  }

  if (!isObject(parsed)) {
    return { state: null, issues: ['payload is not an object'], schemaVersion: 0 };
  }

  const schemaVersion = isFiniteNumber(parsed.schemaVersion) ? parsed.schemaVersion : 0;
  const issues: string[] = [];

  if (!isObject(parsed.state)) {
    return { state: null, issues: ['envelope has no state object'], schemaVersion };
  }

  if (typeof parsed.checksum === 'string') {
    const expected = checksum(JSON.stringify(parsed.state));
    if (expected !== parsed.checksum) {
      // A checksum mismatch is not fatal: the structural validator below still decides
      // whether the state is usable. Report it so the corruption is visible in logs.
      issues.push('checksum mismatch (state may have been edited or partially written)');
    }
  }

  const state = parsed.state as unknown as GameState;
  const report = validateStateShape(state);
  if (!report.isValid) {
    issues.push(...report.all.map((issue) => `${issue.path}: ${issue.message}`));
  }

  return { state, issues, schemaVersion };
}

/**
 * Structural validation + repair of the state tree.
 *
 * Returns a ValidationResult describing what is wrong; `sanitizeState` then clamps the
 * fields that can be safely repaired (numbers, arrays, missing slices) so a partially
 * damaged save degrades instead of bricking the game.
 */
export function validateStateShape(state: GameState): ValidationResult {
  const result = new ValidationResult();

  result
    .expect(isFiniteNumber(state.schemaVersion), 'schemaVersion', 'must be a number')
    .expect(isObject(state.profile), 'profile', 'must be an object')
    .expect(isObject(state.wallet), 'wallet', 'must be an object')
    .expect(isObject(state.buildings), 'buildings', 'must be an object')
    .expect(isObject(state.upgrades), 'upgrades', 'must be an object')
    .expect(isObject(state.workers), 'workers', 'must be an object')
    .expect(isObject(state.progression), 'progression', 'must be an object')
    .expect(isObject(state.session), 'session', 'must be an object')
    .expect(isObject(state.settings), 'settings', 'must be an object')
    .expect(isObject(state.tutorial), 'tutorial', 'must be an object')
    .expect(isObject(state.boosts), 'boosts', 'must be an object')
    .expect(Array.isArray(state.boosts?.active), 'boosts.active', 'must be an array')
    .expect(isObject(state.offline), 'offline', 'must be an object');

  if (isObject(state.wallet)) {
    result
      .expect(isFiniteNumber(state.wallet.coins), 'wallet.coins', 'must be a number')
      .expect(isFiniteNumber(state.wallet.gems), 'wallet.gems', 'must be a number')
      .expect(
        state.wallet.coins <= STATE_LIMITS.maxCurrencyValue,
        'wallet.coins',
        'exceeds the sanity ceiling (corrupted save?)',
      )
      .expect(
        state.wallet.gems <= STATE_LIMITS.maxCurrencyValue,
        'wallet.gems',
        'exceeds the sanity ceiling (corrupted save?)',
      );
  }

  if (isObject(state.session)) {
    result
      .expect(isFiniteNumber(state.session.lastSaveAt), 'session.lastSaveAt', 'must be a number')
      .expect(isFiniteNumber(state.session.startedAt), 'session.startedAt', 'must be a number')
      .expect(
        state.session.lastSaveAt >= 0,
        'session.lastSaveAt',
        'must not be negative',
      );
  }

  if (isObject(state.upgrades)) {
    result.expect(isObject(state.upgrades.active), 'upgrades.active', 'must be an object/map');
    result.expect(Array.isArray(state.upgrades.completed), 'upgrades.completed', 'must be an array');
  }

  if (isObject(state.buildings)) {
    result.expect(isObject(state.buildings.entries), 'buildings.entries', 'must be an object/map');
  }

  if (isObject(state.progression)) {
    result.expect(typeof state.progression.currentStageId === 'string', 'progression.currentStageId', 'must be a string');
    result.expect(Array.isArray(state.progression.unlockedStageIds), 'progression.unlockedStageIds', 'must be an array');
  }

  if (isObject(state.tutorial)) {
    result
      .expect(isBoolean(state.tutorial.completed), 'tutorial.completed', 'must be a boolean')
      .expect(isStringArray(state.tutorial.completedStepIds), 'tutorial.completedStepIds', 'must be a string array');
  }

  if (isObject(state.offline) && state.offline.pending !== null) {
    const pending = state.offline.pending;
    const validPending =
      isObject(pending) &&
      isFiniteNumber(pending.coins) &&
      isFiniteNumber(pending.effectiveElapsedMs) &&
      isFiniteNumber(pending.computedAt);
    result.expect(validPending, 'offline.pending', 'must be null or a well-formed reward');
  }

  if (!Array.isArray(state.transactions)) {
    result.issue('transactions', 'must be an array');
  }

  return result;
}

/**
 * Repairs recoverable problems in place and returns the list of repairs performed.
 * Called after a successful migration, before the state reaches any system.
 */
export function sanitizeState(state: GameState, contentStageIds: readonly StageId[]): string[] {
  const repairs: string[] = [];
  const economyDefaults = { coins: 0, gems: 0 };

  state.wallet = {
    coins: normalizeCurrencyAmount(state.wallet?.coins ?? economyDefaults.coins),
    gems: normalizeCurrencyAmount(state.wallet?.gems ?? economyDefaults.gems),
  };

  if (!Array.isArray(state.transactions)) {
    state.transactions = [];
    repairs.push('transactions reset to []');
  } else if (state.transactions.length > STATE_LIMITS.maxTransactionLogEntries) {
    state.transactions = state.transactions.slice(-STATE_LIMITS.maxTransactionLogEntries);
    repairs.push('transaction log trimmed');
  }

  state.transactions = state.transactions.filter((entry): entry is TransactionLogEntry =>
    Boolean(entry && isFiniteNumber(entry.at) && isFiniteNumber(entry.delta)),
  );

  if (!state.buildings || !isObject(state.buildings.entries)) {
    state.buildings = { entries: {} };
    repairs.push('buildings reset');
  }

  if (!state.upgrades || !isObject(state.upgrades.active)) {
    state.upgrades = { active: {}, completed: [] };
    repairs.push('upgrades reset');
  }

  state.upgrades.completed = (state.upgrades.completed ?? []).filter(
    (id): id is UpgradeId => typeof id === 'string',
  );

  // Drop in-flight jobs whose timestamps are nonsense instead of trusting them.
  for (const [id, job] of Object.entries(state.upgrades.active)) {
    const validJob =
      job &&
      isFiniteNumber(job.startedAt) &&
      isFiniteNumber(job.completesAt) &&
      job.completesAt >= job.startedAt &&
      isFiniteNumber(job.startedAt);
    if (!validJob) {
      delete state.upgrades.active[id as UpgradeId];
      repairs.push(`invalid upgrade job "${id}" removed`);
    }
  }

  if (!state.workers || !isObject(state.workers.entries)) {
    state.workers = { entries: {} };
    repairs.push('workers reset');
  }
  for (const [id, worker] of Object.entries(state.workers.entries)) {
    if (!worker || typeof worker.id !== 'string') {
      delete state.workers.entries[id as WorkerId];
      repairs.push(`invalid worker "${id}" removed`);
    }
  }

  if (!state.progression || !isObject(state.progression.stages)) {
    state.progression = { currentStageId: contentStageIds[0] ?? ('' as StageId), stages: {}, unlockedStageIds: [] };
    repairs.push('progression reset');
  }

  const known = new Set<string>(contentStageIds);
  for (const [id, progress] of Object.entries(state.progression.stages)) {
    if (!known.has(id)) {
      // Stage no longer exists in content (removed or renamed): drop it rather than
      // letting an unknown stage reach the progression system.
      delete state.progression.stages[id as StageId];
      repairs.push(`unknown stage "${id}" removed`);
      continue;
    }
    progress.mastery = Math.max(0, Math.min(1e9, Number(progress.mastery) || 0));
    progress.synergy = Math.max(0, Math.min(1e6, Number(progress.synergy) || 0));
  }

  state.progression.unlockedStageIds = (state.progression.unlockedStageIds ?? []).filter((id) =>
    known.has(id),
  );
  if (!known.has(state.progression.currentStageId)) {
    state.progression.currentStageId = contentStageIds[0] ?? ('' as StageId);
    repairs.push('currentStageId reset to the first stage');
  }
  for (const id of contentStageIds) {
    if (!state.progression.stages[id]) {
      state.progression.stages[id] = { unlocked: false, completed: false, mastery: 0, synergy: 0 };
      repairs.push(`stage "${id}" progress created`);
    }
  }

  // Unknown building entries are kept (content may not be loaded yet at this point) but
  // their numeric fields are clamped so they can never poison income maths.
  for (const [id, entry] of Object.entries(state.buildings.entries)) {
    if (!entry || typeof entry !== 'object') {
      delete state.buildings.entries[id as BuildingId];
      repairs.push(`invalid building entry "${id}" removed`);
      continue;
    }
    entry.tier = Math.max(0, Math.floor(Number(entry.tier) || 0));
    entry.unlocked = Boolean(entry.unlocked);
    entry.lastIncomeAt = Number.isFinite(entry.lastIncomeAt) ? entry.lastIncomeAt : 0;
    entry.incomeProgress = Math.min(1, Math.max(0, Number(entry.incomeProgress) || 0));
    if (typeof entry.visualState !== 'string') entry.visualState = '';
  }

  // --- Temporary boosts (Phase 1) -----------------------------------------
  if (!state.boosts || !Array.isArray(state.boosts.active)) {
    state.boosts = { active: [] };
    repairs.push('boosts reset');
  }
  state.boosts.active = state.boosts.active
    .filter((boost): boost is BoostState => {
      const valid =
        Boolean(boost) &&
        typeof boost.id === 'string' &&
        typeof boost.kind === 'string' &&
        isFiniteNumber(boost.amount) &&
        isFiniteNumber(boost.startedAt) &&
        isFiniteNumber(boost.expiresAt) &&
        boost.expiresAt >= boost.startedAt;
      return valid;
    })
    .slice(0, STATE_LIMITS.maxActiveBoosts);
  if (state.boosts.active.length > STATE_LIMITS.maxActiveBoosts) {
    repairs.push('excess boosts dropped');
  }

  // --- Pending offline reward ----------------------------------------------
  if (!state.offline || typeof state.offline !== 'object') {
    state.offline = { pending: null, lastCollectedAt: 0 };
    repairs.push('offline state reset');
  }
  state.offline.lastCollectedAt = isFiniteNumber(state.offline.lastCollectedAt)
    ? state.offline.lastCollectedAt
    : 0;

  const pending = state.offline.pending;
  if (pending) {
    const plausible =
      isFiniteNumber(pending.coins) &&
      pending.coins >= 0 &&
      pending.coins <= STATE_LIMITS.maxPendingOfflineCoins &&
      isFiniteNumber(pending.effectiveElapsedMs) &&
      pending.effectiveElapsedMs >= 0 &&
      isFiniteNumber(pending.computedAt);
    if (!plausible) {
      state.offline.pending = null;
      repairs.push('implausible pending offline reward discarded');
    } else {
      state.offline.pending = {
        ...pending,
        coins: Math.floor(pending.coins),
        perBuilding: Array.isArray(pending.perBuilding) ? pending.perBuilding : [],
        boosted: Boolean(pending.boosted),
        capped: Boolean(pending.capped),
      };
    }
  }

  // `settings` is deliberately NOT repaired here: SaveSystem merges missing slices with
  // DEFAULT_SETTINGS after migration, which is the single owner of default values.

  return repairs;
}

/** Cheap non-cryptographic hash, used only to detect accidental corruption. */
export function checksum(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export const SAVE_KEYS = STORAGE_KEYS;
