/**
 * Save-state validation + repair.
 *
 * Saves are untrusted input: they may come from an older version, a partially
 * written write, a hand-edited localStorage entry or a corrupted device. Instead
 * of rejecting the payload we repair it field by field and report what changed,
 * so a player loses as little progress as possible.
 */

import type {
  BuildingState,
  DistrictProgressState,
  GameState,
  SettingsState,
  StatsState,
  TimestampsState,
  TutorialState,
  WorkerState,
} from '@/core/types/gameState';
import type {
  ContentSnapshot,
  EconomyBalanceDefinition,
} from '@/core/types/content';
import type { ActiveUpgradeState, BoostState, EventInstanceState, EntitlementState, AdPlacementState } from '@/core/types/gameState';
import type { TimerState } from '@/core/types/timers';
import type { CurrencyKind } from '@/core/types/economy';
import { SAVE_SCHEMA_VERSION } from '@/core/types/save';
import {
  asBoolean,
  asNumber,
  asRecord,
  asString,
  isRecord,
  issue,
  oneOf,
  type ValidationIssue,
  type ValidationResult,
} from '@/core/utils/validation';
import { sanitizeDuration, sanitizeTimestamp } from '@/core/utils/time';
import { clamp, clamp01, roundCurrency, toSafeInteger } from '@/core/utils/numbers';
import { defaultBuildingState, defaultDistrictProgress } from './defaultGameState';

export interface RepairContext {
  now: number;
  balance: EconomyBalanceDefinition;
  content: ContentSnapshot;
  /** Pristine state used as the fallback for anything unrepairable. */
  defaults: GameState;
}

export function validateAndRepairGameState(
  raw: unknown,
  ctx: RepairContext,
): ValidationResult<GameState> {
  const issues: ValidationIssue[] = [];
  const defaults = ctx.defaults;

  if (!isRecord(raw)) {
    issues.push(issue('state', 'save data was not an object - using defaults', 'error', raw));
    return { value: defaults, issues, ok: false };
  }

  const source = raw as Record<string, unknown>;
  const state: GameState = {
    ...defaults,
    currencies: { ...defaults.currencies },
    progression: { ...defaults.progression, unlockedStageIds: [...defaults.progression.unlockedStageIds], unlockedDistrictIds: [...defaults.progression.unlockedDistrictIds], stageProgress: {} },
    buildings: {},
    upgrades: { active: {}, completed: [...defaults.upgrades.completed] },
    timers: {},
    workers: [],
    districts: {},
    mastery: {},
    boosts: [],
    events: { active: [], completedIds: [] },
    entitlements: {},
    ads: { placements: {} },
    tutorial: { ...defaults.tutorial, completedStepIds: [] },
    stats: { ...defaults.stats, lifetimeEarned: { coins: 0, gems: 0 }, lifetimeSpent: { coins: 0, gems: 0 }, reasonCounters: {} },
    timestamps: { ...defaults.timestamps },
    flags: {},
    settings: { ...defaults.settings },
  };

  state.schemaVersion = toSafeInteger(source.schemaVersion, SAVE_SCHEMA_VERSION);

  repairCurrencies(source, state, ctx, issues);
  repairProgression(source, state, ctx, issues);
  repairBuildings(source, state, ctx, issues);
  repairUpgrades(source, state, ctx, issues);
  repairTimers(source, state, issues);
  repairWorkers(source, state, issues);
  repairDistricts(source, state, ctx, issues);
  repairMastery(source, state, ctx, issues);
  repairBoosts(source, state, issues);
  repairEvents(source, state, issues);
  repairEntitlements(source, state, issues);
  repairAds(source, state, issues);
  repairSettings(source, state, issues);
  repairTutorial(source, state, issues);
  repairStats(source, state, issues);
  repairTimestamps(source, state, ctx, issues);
  repairFlags(source, state, issues);
  state.rngSeed = toSafeInteger(source.rngSeed, defaults.rngSeed);

  const ok = !issues.some((entry) => entry.severity === 'error');
  return { value: state, issues, ok };
}

/* ------------------------------------------------------------------ helpers */

interface NumberOptions {
  min?: number;
  max?: number;
  integer?: boolean;
  severity?: ValidationIssue['severity'];
}

function readNumber(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  path: string,
  issues: ValidationIssue[],
  options: NumberOptions = {},
): number {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(issue(path, `expected a finite number, got ${typeof value}`, options.severity ?? 'warning', value));
    return fallback;
  }
  let result = value;
  if (options.integer) result = Math.trunc(result);
  if (options.min !== undefined && result < options.min) result = options.min;
  if (options.max !== undefined) result = Math.min(result, options.max);
  return result;
}

function readBoolean(
  source: Record<string, unknown>,
  key: string,
  fallback: boolean,
  path: string,
  issues: ValidationIssue[],
): boolean {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    issues.push(issue(path, `expected a boolean, got ${typeof value}`, 'warning', value));
    return fallback;
  }
  return value;
}

function readStringArray(
  source: Record<string, unknown>,
  key: string,
  fallback: string[],
  path: string,
  issues: ValidationIssue[],
  known?: ReadonlySet<string>,
): string[] {
  const value = source[key];
  if (value === undefined) return fallback;
  if (!Array.isArray(value)) {
    issues.push(issue(path, 'expected an array of strings', 'warning', value));
    return fallback;
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      issues.push(issue(path, 'dropped a non-string entry', 'warning', entry));
      continue;
    }
    if (known && !known.has(entry)) {
      issues.push(issue(path, `dropped unknown id "${entry}"`, 'warning', entry));
      continue;
    }
    if (!result.includes(entry)) result.push(entry);
  }
  return result;
}

/* ----------------------------------------------------------------- sections */

function repairCurrencies(
  source: Record<string, unknown>,
  state: GameState,
  ctx: RepairContext,
  issues: ValidationIssue[],
): void {
  const currencies = asRecord<unknown>(source.currencies);
  if (!currencies) {
    if (source.currencies !== undefined) {
      issues.push(issue('currencies', 'missing or invalid - using balance defaults', 'warning', source.currencies));
    }
    state.currencies = {
      coins: roundCurrency(ctx.balance.startingCoins),
      gems: roundCurrency(ctx.balance.startingGems),
    };
    return;
  }
  state.currencies = {
    coins: roundCurrency(readNumber(currencies, 'coins', ctx.balance.startingCoins, 'currencies.coins', issues, { min: 0 })),
    gems: roundCurrency(readNumber(currencies, 'gems', ctx.balance.startingGems, 'currencies.gems', issues, { min: 0 })),
  };
}

function repairProgression(
  source: Record<string, unknown>,
  state: GameState,
  ctx: RepairContext,
  issues: ValidationIssue[],
): void {
  const progression = asRecord<unknown>(source.progression);
  if (!progression) {
    if (source.progression !== undefined) {
      issues.push(issue('progression', 'invalid - using defaults', 'warning', source.progression));
    }
    return;
  }

  const stageIds = new Set(ctx.content.stages.map((stage) => stage.id));
  const districtIds = new Set(ctx.content.districts.map((district) => district.id));

  const currentStageId = asString(progression.currentStageId, state.progression.currentStageId);
  if (stageIds.size > 0 && !stageIds.has(currentStageId)) {
    issues.push(issue('progression.currentStageId', `unknown stage "${currentStageId}"`, 'warning', currentStageId));
    state.progression.currentStageId =
      ctx.content.stages.slice().sort((a, b) => a.order - b.order)[0]?.id ?? state.progression.currentStageId;
  } else {
    state.progression.currentStageId = currentStageId;
  }

  state.progression.unlockedStageIds = readStringArray(
    progression,
    'unlockedStageIds',
    state.progression.unlockedStageIds,
    'progression.unlockedStageIds',
    issues,
    stageIds.size > 0 ? stageIds : undefined,
  );
  state.progression.unlockedDistrictIds = readStringArray(
    progression,
    'unlockedDistrictIds',
    state.progression.unlockedDistrictIds,
    'progression.unlockedDistrictIds',
    issues,
    districtIds.size > 0 ? districtIds : undefined,
  );

  const progress = asRecord<number>(progression.stageProgress);
  if (progress) {
    for (const [stageId, value] of Object.entries(progress)) {
      state.progression.stageProgress[stageId] = clamp01(asNumber(value, 0));
    }
  }
}

function repairBuildings(
  source: Record<string, unknown>,
  state: GameState,
  ctx: RepairContext,
  issues: ValidationIssue[],
): void {
  const rawBuildings = asRecord<unknown>(source.buildings);
  const definitions = new Map(ctx.content.buildings.map((definition) => [definition.id, definition]));

  // Seed every registered building from content so nothing is ever missing.
  for (const definition of ctx.content.buildings) {
    state.buildings[definition.id] = defaultBuildingState(definition, ctx.now);
  }

  if (!rawBuildings) {
    if (source.buildings !== undefined) {
      issues.push(issue('buildings', 'invalid - rebuilding from content defaults', 'warning', source.buildings));
    }
    return;
  }

  for (const [buildingId, rawBuilding] of Object.entries(rawBuildings)) {
    if (!isRecord(rawBuilding)) {
      issues.push(issue(`buildings.${buildingId}`, 'entry is not an object - dropped', 'warning', rawBuilding));
      continue;
    }
    const definition = definitions.get(buildingId);
    const base: BuildingState =
      state.buildings[buildingId] ?? {
        ...defaultBuildingState(
          {
            // Unknown-but-present entry: keep the record so temporarily removed
            // content does not erase player progress.
            id: buildingId,
            displayName: buildingId,
            stageId: '',
            districtId: '',
            type: 'utility',
            rarity: 'common',
            order: 0,
            baseIncome: 0,
            incomeIntervalMs: 1000,
            maxTier: 0,
            restorationTiers: [],
            visualStates: [],
            upgradeIds: [],
          },
          ctx.now,
        ),
      };

    if (!definition) {
      issues.push(issue(`buildings.${buildingId}`, 'not present in the content registry - kept as-is', 'warning'));
    }

    base.id = buildingId;
    base.unlocked = readBoolean(rawBuilding, 'unlocked', base.unlocked, `buildings.${buildingId}.unlocked`, issues);
    base.unlockedAt = rawBuilding.unlockedAt === null
      ? null
      : sanitizeTimestamp(rawBuilding.unlockedAt, base.unlockedAt ?? ctx.now);
    base.tier = readNumber(rawBuilding, 'tier', base.tier, `buildings.${buildingId}.tier`, issues, {
      min: 0,
      max: definition?.maxTier ?? 999,
      integer: true,
    });
    base.visualStateId = typeof rawBuilding.visualStateId === 'string' ? rawBuilding.visualStateId : null;
    base.activeUpgradeId = typeof rawBuilding.activeUpgradeId === 'string' ? rawBuilding.activeUpgradeId : null;
    base.completedUpgradeIds = readStringArray(
      rawBuilding,
      'completedUpgradeIds',
      base.completedUpgradeIds,
      `buildings.${buildingId}.completedUpgradeIds`,
      issues,
    );
    base.incomeMultiplier = readNumber(rawBuilding, 'incomeMultiplier', base.incomeMultiplier, `buildings.${buildingId}.incomeMultiplier`, issues, { min: 0 });
    base.incomeBonus = readNumber(rawBuilding, 'incomeBonus', base.incomeBonus, `buildings.${buildingId}.incomeBonus`, issues, { min: 0 });
    base.incomeIntervalMsOverride =
      rawBuilding.incomeIntervalMsOverride === null
        ? null
        : rawBuilding.incomeIntervalMsOverride === undefined
          ? null
          : sanitizeDuration(rawBuilding.incomeIntervalMsOverride, definition?.incomeIntervalMs ?? 1000);
    base.workerSlotsBonus = readNumber(rawBuilding, 'workerSlotsBonus', base.workerSlotsBonus, `buildings.${buildingId}.workerSlotsBonus`, issues, { min: 0, integer: true });
    base.lastIncomeAt = sanitizeTimestamp(rawBuilding.lastIncomeAt, ctx.now);
    base.lifetimeEarned = readNumber(rawBuilding, 'lifetimeEarned', base.lifetimeEarned, `buildings.${buildingId}.lifetimeEarned`, issues, { min: 0 });
    base.workerIds = readStringArray(rawBuilding, 'workerIds', base.workerIds, `buildings.${buildingId}.workerIds`, issues);
    base.redevelopmentCount = readNumber(rawBuilding, 'redevelopmentCount', base.redevelopmentCount, `buildings.${buildingId}.redevelopmentCount`, issues, { min: 0, integer: true });

    const purchases = asRecord<unknown>(rawBuilding.purchaseCounts);
    base.purchaseCounts = {};
    if (purchases) {
      for (const [upgradeId, count] of Object.entries(purchases)) {
        base.purchaseCounts[upgradeId] = clamp(toSafeInteger(count, 0), 0, 100_000);
      }
    }

    // Trim an upgrade pointer that no longer exists in active upgrades.
    if (base.activeUpgradeId && !state.upgrades.active[base.activeUpgradeId]) {
      // `active` is repaired later in the pipeline; validated there.
      base.activeUpgradeId = base.activeUpgradeId ?? null;
    }

    state.buildings[buildingId] = base;
  }
}

function repairUpgrades(
  source: Record<string, unknown>,
  state: GameState,
  ctx: RepairContext,
  issues: ValidationIssue[],
): void {
  const upgrades = asRecord<unknown>(source.upgrades);
  if (!upgrades) {
    if (source.upgrades !== undefined) {
      issues.push(issue('upgrades', 'invalid - using defaults', 'warning', source.upgrades));
    }
    return;
  }

  const knownUpgrades = new Set(ctx.content.upgrades.map((upgrade) => upgrade.id));
  state.upgrades.completed = readStringArray(
    upgrades,
    'completed',
    state.upgrades.completed,
    'upgrades.completed',
    issues,
    knownUpgrades.size > 0 ? knownUpgrades : undefined,
  );

  const active = asRecord<unknown>(upgrades.active);
  if (!isRecord(active)) return;

  for (const [upgradeId, rawActive] of Object.entries(active)) {
    if (!isRecord(rawActive)) {
      issues.push(issue(`upgrades.active.${upgradeId}`, 'entry is not an object - dropped', 'warning', rawActive));
      continue;
    }
    const timerId = asString(rawActive.timerId, '');
    if (!timerId) {
      issues.push(issue(`upgrades.active.${upgradeId}`, 'missing timerId - dropped', 'warning', rawActive));
      continue;
    }
    const startedAt = sanitizeTimestamp(rawActive.startedAt, ctx.now);
    const entry: ActiveUpgradeState = {
      upgradeId,
      buildingId: typeof rawActive.buildingId === 'string' ? rawActive.buildingId : null,
      timerId,
      startedAt,
      endsAt: sanitizeTimestamp(rawActive.endsAt, startedAt),
      durationMs: sanitizeDuration(rawActive.durationMs, 0),
      costPaid: {
        coins: asNumber(asRecord<unknown>(rawActive.costPaid)?.coins, 0),
        gems: asNumber(asRecord<unknown>(rawActive.costPaid)?.gems, 0),
      },
      purchases: clamp(toSafeInteger(rawActive.purchases, 0), 0, 100_000),
    };
    state.upgrades.active[upgradeId] = entry;
  }
}

const TIMER_KINDS = ['upgrade', 'construction', 'event', 'boost', 'automation', 'custom'] as const;
const TIMER_STATUSES = ['running', 'paused', 'completed', 'cancelled'] as const;

function repairTimers(
  source: Record<string, unknown>,
  state: GameState,
  issues: ValidationIssue[],
): void {
  const timers = asRecord<unknown>(source.timers);
  if (!timers) {
    if (source.timers !== undefined) {
      issues.push(issue('timers', 'invalid - starting with no timers', 'warning', source.timers));
    }
    return;
  }

  for (const [timerId, rawTimer] of Object.entries(timers)) {
    if (!isRecord(rawTimer)) {
      issues.push(issue(`timers.${timerId}`, 'entry is not an object - dropped', 'warning', rawTimer));
      continue;
    }
    const startedAt = sanitizeTimestamp(rawTimer.startedAt, Date.now());
    const timer: TimerState = {
      id: timerId,
      kind: oneOf(rawTimer.kind, TIMER_KINDS, 'custom'),
      label: asString(rawTimer.label, ''),
      status: oneOf(rawTimer.status, TIMER_STATUSES, 'cancelled'),
      startedAt,
      endsAt: sanitizeTimestamp(rawTimer.endsAt, startedAt),
      durationMs: sanitizeDuration(rawTimer.durationMs, 0),
      createdAt: sanitizeTimestamp(rawTimer.createdAt, startedAt),
      updatedAt: sanitizeTimestamp(rawTimer.updatedAt, startedAt),
    };
    if (typeof rawTimer.targetId === 'string') timer.targetId = rawTimer.targetId;
    if (typeof rawTimer.pausedRemainingMs === 'number') {
      timer.pausedRemainingMs = sanitizeDuration(rawTimer.pausedRemainingMs, 0);
    }
    const meta = asRecord<string | number | boolean>(rawTimer.meta);
    if (meta) timer.meta = meta;

    if (timer.endsAt < timer.startedAt) {
      issues.push(issue(`timers.${timerId}.endsAt`, 'ends before it starts - clamped', 'warning', timer.endsAt));
      timer.endsAt = timer.startedAt + timer.durationMs;
    }

    state.timers[timerId] = timer;
  }
}

function repairWorkers(
  source: Record<string, unknown>,
  state: GameState,
  issues: ValidationIssue[],
): void {
  const workers = source.workers;
  if (workers === undefined) return;
  if (!Array.isArray(workers)) {
    issues.push(issue('workers', 'expected an array - dropped', 'warning', workers));
    return;
  }
  const result: WorkerState[] = [];
  for (const [index, rawWorker] of workers.entries()) {
    if (!isRecord(rawWorker)) {
      issues.push(issue(`workers[${index}]`, 'entry is not an object - dropped', 'warning', rawWorker));
      continue;
    }
    const id = asString(rawWorker.id, '');
    if (!id) {
      issues.push(issue(`workers[${index}].id`, 'missing id - dropped', 'warning', rawWorker));
      continue;
    }
    result.push({
      id,
      definitionId: asString(rawWorker.definitionId, ''),
      assignedBuildingId: typeof rawWorker.assignedBuildingId === 'string' ? rawWorker.assignedBuildingId : null,
      hiredAt: sanitizeTimestamp(rawWorker.hiredAt, Date.now()),
      level: toSafeInteger(rawWorker.level, 1),
    });
  }
  state.workers = result;
}

function repairDistricts(
  source: Record<string, unknown>,
  state: GameState,
  ctx: RepairContext,
  issues: ValidationIssue[],
): void {
  for (const district of ctx.content.districts) {
    state.districts[district.id] =
      state.districts[district.id] ?? defaultDistrictProgress(district.id, district.buildingIds.length, false);
  }

  const districts = asRecord<unknown>(source.districts);
  if (!districts) {
    if (source.districts !== undefined) {
      issues.push(issue('districts', 'invalid - rebuilding from content', 'warning', source.districts));
    }
    return;
  }

  for (const [districtId, rawDistrict] of Object.entries(districts)) {
    if (!isRecord(rawDistrict)) {
      issues.push(issue(`districts.${districtId}`, 'entry is not an object - dropped', 'warning', rawDistrict));
      continue;
    }
    const base: DistrictProgressState =
      state.districts[districtId] ?? defaultDistrictProgress(districtId, 0, false);
    base.districtId = districtId;
    base.unlocked = readBoolean(rawDistrict, 'unlocked', base.unlocked, `districts.${districtId}.unlocked`, issues);
    base.restoredBuildings = readNumber(rawDistrict, 'restoredBuildings', base.restoredBuildings, `districts.${districtId}.restoredBuildings`, issues, { min: 0, integer: true });
    base.totalBuildings = readNumber(rawDistrict, 'totalBuildings', base.totalBuildings, `districts.${districtId}.totalBuildings`, issues, { min: 0, integer: true });
    base.progress = clamp01(readNumber(rawDistrict, 'progress', base.progress, `districts.${districtId}.progress`, issues, { min: 0, max: 1 }));
    base.completedAt = rawDistrict.completedAt === null ? null : sanitizeTimestamp(rawDistrict.completedAt, ctx.now);
    base.synergyMultiplier = readNumber(rawDistrict, 'synergyMultiplier', base.synergyMultiplier, `districts.${districtId}.synergyMultiplier`, issues, { min: 0 });
    state.districts[districtId] = base;
  }
}

function repairMastery(
  source: Record<string, unknown>,
  state: GameState,
  ctx: RepairContext,
  issues: ValidationIssue[],
): void {
  for (const track of ctx.content.masteryTracks) {
    state.mastery[track.id] = state.mastery[track.id] ?? { trackId: track.id, level: 0, xp: 0 };
  }
  const mastery = asRecord<unknown>(source.mastery);
  if (!mastery) {
    if (source.mastery !== undefined) issues.push(issue('mastery', 'invalid - using defaults', 'warning', source.mastery));
    return;
  }
  for (const [trackId, rawTrack] of Object.entries(mastery)) {
    if (!isRecord(rawTrack)) continue;
    state.mastery[trackId] = {
      trackId,
      level: readNumber(rawTrack, 'level', 0, `mastery.${trackId}.level`, issues, { min: 0, integer: true }),
      xp: readNumber(rawTrack, 'xp', 0, `mastery.${trackId}.xp`, issues, { min: 0 }),
    };
  }
}

const BOOST_KINDS = ['income-multiplier', 'offline-efficiency', 'upgrade-speed'] as const;

function repairBoosts(
  source: Record<string, unknown>,
  state: GameState,
  issues: ValidationIssue[],
): void {
  const boosts = source.boosts;
  if (boosts === undefined) return;
  if (!Array.isArray(boosts)) {
    issues.push(issue('boosts', 'expected an array - dropped', 'warning', boosts));
    return;
  }
  const result: BoostState[] = [];
  for (const [index, rawBoost] of boosts.entries()) {
    if (!isRecord(rawBoost)) continue;
    const id = asString(rawBoost.id, '');
    if (!id) {
      issues.push(issue(`boosts[${index}]`, 'missing id - dropped', 'warning', rawBoost));
      continue;
    }
    // Expired boosts are simply not restored.
    if (asNumber(rawBoost.endsAt, 0) <= Date.now() && asNumber(rawBoost.endsAt, 0) > 0) continue;
    const boost: BoostState = {
      id,
      kind: oneOf(rawBoost.kind, BOOST_KINDS, 'income-multiplier'),
      multiplier: asNumber(rawBoost.multiplier, 1),
      startedAt: sanitizeTimestamp(rawBoost.startedAt, Date.now()),
      endsAt: sanitizeTimestamp(rawBoost.endsAt, Date.now()),
      source: asString(rawBoost.source, 'unknown'),
    };
    if (typeof rawBoost.targetId === 'string') boost.targetId = rawBoost.targetId;
    result.push(boost);
  }
  state.boosts = result;
}

function repairEvents(
  source: Record<string, unknown>,
  state: GameState,
  issues: ValidationIssue[],
): void {
  const events = asRecord<unknown>(source.events);
  if (!events) {
    if (source.events !== undefined) issues.push(issue('events', 'invalid - using defaults', 'warning', source.events));
    return;
  }
  state.events.completedIds = readStringArray(events, 'completedIds', [], 'events.completedIds', issues);

  const active = events.active;
  if (!Array.isArray(active)) {
    if (active !== undefined) issues.push(issue('events.active', 'expected an array - dropped', 'warning', active));
    return;
  }
  const result: EventInstanceState[] = [];
  for (const [index, rawEvent] of active.entries()) {
    if (!isRecord(rawEvent)) continue;
    const eventId = asString(rawEvent.eventId, '');
    if (!eventId) {
      issues.push(issue(`events.active[${index}]`, 'missing eventId - dropped', 'warning', rawEvent));
      continue;
    }
    result.push({
      eventId,
      startedAt: sanitizeTimestamp(rawEvent.startedAt, Date.now()),
      endsAt: sanitizeTimestamp(rawEvent.endsAt, Date.now()),
      claimedRewardIds: Array.isArray(rawEvent.claimedRewardIds)
        ? rawEvent.claimedRewardIds.filter((entry): entry is string => typeof entry === 'string')
        : [],
    });
  }
  state.events.active = result;
}

function repairEntitlements(
  source: Record<string, unknown>,
  state: GameState,
  issues: ValidationIssue[],
): void {
  const entitlements = asRecord<unknown>(source.entitlements);
  if (!entitlements) {
    if (source.entitlements !== undefined) {
      issues.push(issue('entitlements', 'invalid - using defaults', 'warning', source.entitlements));
    }
    return;
  }
  for (const [id, rawEntitlement] of Object.entries(entitlements)) {
    if (!isRecord(rawEntitlement)) continue;
    const entry: EntitlementState = {
      active: asBoolean(rawEntitlement.active, false),
      purchasedAt: sanitizeTimestamp(rawEntitlement.purchasedAt, Date.now()),
      expiresAt: rawEntitlement.expiresAt === null ? null : sanitizeTimestamp(rawEntitlement.expiresAt, Date.now()),
    };
    state.entitlements[id] = entry;
  }
}

function repairAds(source: Record<string, unknown>, state: GameState, issues: ValidationIssue[]): void {
  const ads = asRecord<unknown>(source.ads);
  if (!ads) {
    if (source.ads !== undefined) issues.push(issue('ads', 'invalid - using defaults', 'warning', source.ads));
    return;
  }
  const placements = asRecord<unknown>(ads.placements);
  if (!placements) return;
  for (const [placementId, rawPlacement] of Object.entries(placements)) {
    if (!isRecord(rawPlacement)) continue;
    const entry: AdPlacementState = {
      lastShownAt: sanitizeTimestamp(rawPlacement.lastShownAt, 0),
      shownToday: clamp(toSafeInteger(rawPlacement.shownToday, 0), 0, 10_000),
      dayKey: asString(rawPlacement.dayKey, ''),
    };
    state.ads.placements[placementId] = entry;
  }
}

function repairSettings(source: Record<string, unknown>, state: GameState, issues: ValidationIssue[]): void {
  const settings = asRecord<unknown>(source.settings);
  if (!settings) {
    if (source.settings !== undefined) issues.push(issue('settings', 'invalid - using defaults', 'warning', source.settings));
    return;
  }
  const defaults = state.settings as SettingsState;
  state.settings = {
    masterVolume: clamp(readNumber(settings, 'masterVolume', defaults.masterVolume, 'settings.masterVolume', issues), 0, 1),
    musicVolume: clamp(readNumber(settings, 'musicVolume', defaults.musicVolume, 'settings.musicVolume', issues), 0, 1),
    sfxVolume: clamp(readNumber(settings, 'sfxVolume', defaults.sfxVolume, 'settings.sfxVolume', issues), 0, 1),
    muted: readBoolean(settings, 'muted', defaults.muted, 'settings.muted', issues),
    hapticsEnabled: readBoolean(settings, 'hapticsEnabled', defaults.hapticsEnabled, 'settings.hapticsEnabled', issues),
    reducedMotion: readBoolean(settings, 'reducedMotion', defaults.reducedMotion, 'settings.reducedMotion', issues),
    showFloatingNumbers: readBoolean(settings, 'showFloatingNumbers', defaults.showFloatingNumbers, 'settings.showFloatingNumbers', issues),
    language: asString(settings.language, defaults.language),
  };
}

function repairTutorial(source: Record<string, unknown>, state: GameState, issues: ValidationIssue[]): void {
  const tutorial = asRecord<unknown>(source.tutorial);
  if (!tutorial) {
    if (source.tutorial !== undefined) issues.push(issue('tutorial', 'invalid - using defaults', 'warning', source.tutorial));
    return;
  }
  const defaults: TutorialState = state.tutorial;
  state.tutorial = {
    completed: readBoolean(tutorial, 'completed', defaults.completed, 'tutorial.completed', issues),
    skipped: readBoolean(tutorial, 'skipped', defaults.skipped, 'tutorial.skipped', issues),
    currentStepId: typeof tutorial.currentStepId === 'string' ? tutorial.currentStepId : null,
    completedStepIds: readStringArray(tutorial, 'completedStepIds', [], 'tutorial.completedStepIds', issues),
  };
}

function repairStats(source: Record<string, unknown>, state: GameState, issues: ValidationIssue[]): void {
  const stats = asRecord<unknown>(source.stats);
  if (!stats) {
    if (source.stats !== undefined) issues.push(issue('stats', 'invalid - using defaults', 'warning', source.stats));
    return;
  }
  const defaults: StatsState = state.stats;
  const lifetimeEarned = { coins: 0, gems: 0 } as Record<CurrencyKind, number>;
  const lifetimeSpent = { coins: 0, gems: 0 } as Record<CurrencyKind, number>;
  const earned = asRecord<number>(stats.lifetimeEarned);
  const spent = asRecord<number>(stats.lifetimeSpent);
  for (const currency of ['coins', 'gems'] as const) {
    lifetimeEarned[currency] = Math.max(0, asNumber(earned?.[currency], 0));
    lifetimeSpent[currency] = Math.max(0, asNumber(spent?.[currency], 0));
  }

  const reasonCounters: StatsState['reasonCounters'] = {};
  const rawCounters = asRecord<unknown>(stats.reasonCounters);
  if (rawCounters) {
    for (const [key, rawCounter] of Object.entries(rawCounters)) {
      if (!isRecord(rawCounter)) continue;
      reasonCounters[key] = {
        count: clamp(toSafeInteger(rawCounter.count, 0), 0, 10_000_000),
        total: asNumber(rawCounter.total, 0),
      };
    }
  }

  state.stats = {
    sessionsStarted: readNumber(stats, 'sessionsStarted', defaults.sessionsStarted, 'stats.sessionsStarted', issues, { min: 0, integer: true }),
    playTimeMs: readNumber(stats, 'playTimeMs', defaults.playTimeMs, 'stats.playTimeMs', issues, { min: 0 }),
    totalTaps: readNumber(stats, 'totalTaps', defaults.totalTaps, 'stats.totalTaps', issues, { min: 0, integer: true }),
    buildingsUnlocked: readNumber(stats, 'buildingsUnlocked', defaults.buildingsUnlocked, 'stats.buildingsUnlocked', issues, { min: 0, integer: true }),
    buildingsRestored: readNumber(stats, 'buildingsRestored', defaults.buildingsRestored, 'stats.buildingsRestored', issues, { min: 0, integer: true }),
    upgradesCompleted: readNumber(stats, 'upgradesCompleted', defaults.upgradesCompleted, 'stats.upgradesCompleted', issues, { min: 0, integer: true }),
    offlineRewardsClaimed: readNumber(stats, 'offlineRewardsClaimed', defaults.offlineRewardsClaimed, 'stats.offlineRewardsClaimed', issues, { min: 0, integer: true }),
    rewardedAdsWatched: readNumber(stats, 'rewardedAdsWatched', defaults.rewardedAdsWatched, 'stats.rewardedAdsWatched', issues, { min: 0, integer: true }),
    lifetimeEarned,
    lifetimeSpent,
    reasonCounters,
  };
}

function repairTimestamps(
  source: Record<string, unknown>,
  state: GameState,
  ctx: RepairContext,
  issues: ValidationIssue[],
): void {
  const timestamps = asRecord<unknown>(source.timestamps);
  const defaults: TimestampsState = state.timestamps;
  if (!timestamps) {
    if (source.timestamps !== undefined) {
      issues.push(issue('timestamps', 'invalid - using current time', 'warning', source.timestamps));
    }
    state.timestamps = {
      createdAt: ctx.now,
      updatedAt: ctx.now,
      lastSessionTime: ctx.now,
      sessionStartedAt: ctx.now,
      lastOfflineComputedAt: null,
      lastOfflineClaimedAt: null,
    };
    return;
  }

  const lastSessionTime = sanitizeTimestamp(timestamps.lastSessionTime, ctx.now);
  if (timestamps.lastSessionTime !== undefined && lastSessionTime !== timestamps.lastSessionTime) {
    issues.push(issue('timestamps.lastSessionTime', 'invalid or implausible timestamp - reset to now', 'warning', timestamps.lastSessionTime));
  }

  state.timestamps = {
    ...defaults,
    createdAt: sanitizeTimestamp(timestamps.createdAt, ctx.now),
    updatedAt: sanitizeTimestamp(timestamps.updatedAt, ctx.now),
    lastSessionTime,
    sessionStartedAt: sanitizeTimestamp(timestamps.sessionStartedAt, ctx.now),
    lastOfflineComputedAt:
      timestamps.lastOfflineComputedAt === null || timestamps.lastOfflineComputedAt === undefined
        ? null
        : sanitizeTimestamp(timestamps.lastOfflineComputedAt, ctx.now),
    lastOfflineClaimedAt:
      timestamps.lastOfflineClaimedAt === null || timestamps.lastOfflineClaimedAt === undefined
        ? null
        : sanitizeTimestamp(timestamps.lastOfflineClaimedAt, ctx.now),
  };
}

function repairFlags(source: Record<string, unknown>, state: GameState, issues: ValidationIssue[]): void {
  const flags = asRecord<string | number | boolean>(source.flags);
  if (!flags) {
    if (source.flags !== undefined) issues.push(issue('flags', 'invalid - dropped', 'warning', source.flags));
    return;
  }
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (typeof value === 'string' || typeof value === 'boolean') {
      result[key] = value;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value;
      continue;
    }
    issues.push(issue(`flags.${key}`, 'unsupported flag value - dropped', 'warning', value));
  }
  state.flags = result;
}
