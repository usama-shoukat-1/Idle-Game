/**
 * Building system.
 *
 * Owns building runtime state and the income pipeline. The system knows nothing
 * about *which* buildings exist: everything comes from `BuildingDefinition` data
 * plus a pluggable list of income modifiers (upgrades, district synergy, boosts,
 * mastery, events). That is what keeps "no hard-coded building economy logic" true.
 *
 * Income is timestamp based: each building tracks `lastIncomeAt`, and accrual is
 * `incomePerSecond * elapsed`. Frames are irrelevant, so a suspended phone or a
 * hidden tab never loses (or duplicates) income.
 */

import type { Clock } from '@/core/Clock';
import type { BuildingDefinition, EconomyBalanceDefinition, UpgradeEffectDefinition } from '@/core/types/content';
import type { BuildingId } from '@/core/types/ids';
import type { BuildingState, GameState } from '@/core/types/gameState';
import type { GameStateStore } from '@/core/state/GameStateStore';
import { defaultBuildingState } from '@/core/state/defaultGameState';
import { createLogger } from '@/core/utils/logger';
import { clamp, isFiniteNumber, roundCurrency } from '@/core/utils/numbers';
import { sanitizeDuration, sanitizeTimestamp } from '@/core/utils/time';
import type { GameEventBus } from '@/systems/EventSystem';
import type { ContentRegistry } from '@/systems/ContentSystem/ContentRegistry';
import type { EconomySystem } from '@/systems/EconomySystem/EconomySystem';
import type { UpgradeAvailability } from '@/systems/UpgradeSystem/UpgradeSystem';
import { BuildingEntity } from '@/entities/Building/BuildingEntity';

/**
 * Upgrade lookups are injected after construction: BuildingSystem must not import
 * UpgradeSystem at runtime (UpgradeSystem already depends on BuildingSystem).
 */
export interface UpgradeAvailabilityProvider {
  listForBuilding(buildingId: BuildingId, at?: number): UpgradeAvailability[];
}

export interface BuildingIncomeContext {
  buildingId: BuildingId;
  definition: BuildingDefinition;
  state: BuildingState;
  at: number;
  /** Accumulated multiplier so far (base 1). */
  multiplier: number;
  /** Accumulated flat bonus so far. */
  bonus: number;
}

export type IncomeModifier = (context: BuildingIncomeContext) => number;

export interface IncomeBreakdown {
  buildingId: BuildingId;
  baseCoinsPerInterval: number;
  incomeIntervalMs: number;
  baseIncomePerSecond: number;
  incomePerSecond: number;
  /** Contribution of each registered modifier, keyed by modifier id. */
  modifiers: Record<string, number>;
  flatBonus: number;
  globalMultiplier: number;
  unlocked: boolean;
  at: number;
}

export interface BuildingSystemDeps {
  store: GameStateStore;
  events: GameEventBus;
  clock: Clock;
  content: ContentRegistry;
  economy: EconomySystem;
  balance: EconomyBalanceDefinition;
}

export class BuildingSystem {
  private readonly log = createLogger('buildings');
  private readonly modifiers = new Map<string, IncomeModifier>();
  /** Income accrued but not yet flushed into the wallet. */
  private pendingCoins = 0;
  private readonly pendingByBuilding: Record<BuildingId, number> = {};

  private upgradeProvider: UpgradeAvailabilityProvider | null = null;

  constructor(private readonly deps: BuildingSystemDeps) {}

  /** Wire the upgrade system in once (called by the composition root). */
  setUpgradeProvider(provider: UpgradeAvailabilityProvider): void {
    this.upgradeProvider = provider;
  }

  /* ------------------------------------------------------------ modifiers */

  /**
   * Register an income modifier. Modifiers compute a multiplier contribution
   * (1 = neutral). Registering is idempotent per id so hot-reload/duplicate
   * registration cannot double a bonus.
   */
  registerIncomeModifier(id: string, modifier: IncomeModifier): void {
    this.modifiers.set(id, modifier);
    this.log.debug(`income modifier registered: ${id}`);
  }

  unregisterIncomeModifier(id: string): void {
    this.modifiers.delete(id);
  }

  /* -------------------------------------------------------------- lookups */

  getDefinition(buildingId: BuildingId): BuildingDefinition | null {
    return this.deps.content.getBuilding(buildingId);
  }

  getState(buildingId: BuildingId): BuildingState | null {
    return this.deps.store.state.buildings[buildingId] ?? null;
  }

  /** All registered building definitions, in authoring order. */
  listDefinitions(): BuildingDefinition[] {
    return this.deps.content.listBuildings();
  }

  isUnlocked(buildingId: BuildingId): boolean {
    return this.getState(buildingId)?.unlocked ?? false;
  }

  /** Tier 1+ counts as "restored" for district progress purposes. */
  isRestored(buildingId: BuildingId): boolean {
    return (this.getState(buildingId)?.tier ?? 0) >= 1;
  }

  /** Visual state id currently shown for a building (falls back to tier state). */
  getVisualState(buildingId: BuildingId): string {
    const definition = this.getDefinition(buildingId);
    const state = this.getState(buildingId);
    if (!definition || !state) return 'unknown';
    if (state.visualStateId) return state.visualStateId;
    const tier = definition.restorationTiers.find((entry) => entry.tier === state.tier);
    return tier?.visualStateId ?? definition.visualStates[0]?.id ?? 'unknown';
  }

  /* ---------------------------------------------------------------- income */

  getIncomeBreakdown(buildingId: BuildingId, at = this.deps.clock.now()): IncomeBreakdown | null {
    const definition = this.getDefinition(buildingId);
    const state = this.getState(buildingId);
    if (!definition || !state) return null;

    const interval = state.incomeIntervalMsOverride && state.incomeIntervalMsOverride > 0
      ? state.incomeIntervalMsOverride
      : definition.incomeIntervalMs;

    const baseIncomePerSecond = interval > 0 ? (definition.baseIncome * 1000) / interval : 0;

    const context: BuildingIncomeContext = {
      buildingId,
      definition,
      state,
      at,
      multiplier: state.incomeMultiplier,
      bonus: state.incomeBonus,
    };

    const modifierValues: Record<string, number> = {};
    for (const [id, modifier] of this.modifiers) {
      let value = 1;
      try {
        value = modifier(context);
      } catch (error) {
        this.log.error(`income modifier "${id}" threw for "${buildingId}"`, error);
        value = 1;
      }
      if (!isFiniteNumber(value) || value < 0) value = 1;
      modifierValues[id] = value;
    }

    const modifierProduct = Object.values(modifierValues).reduce((total, value) => total * value, 1);
    const globalMultiplier = this.deps.balance.globalIncomeMultiplier;
    const perSecond = state.unlocked
      ? baseIncomePerSecond * context.multiplier * modifierProduct * globalMultiplier + context.bonus
      : 0;

    return {
      buildingId,
      baseCoinsPerInterval: definition.baseIncome,
      incomeIntervalMs: interval,
      baseIncomePerSecond,
      incomePerSecond: Math.max(0, roundCurrency(perSecond)),
      modifiers: modifierValues,
      flatBonus: context.bonus,
      globalMultiplier,
      unlocked: state.unlocked,
      at,
    };
  }

  getIncomePerSecond(buildingId: BuildingId, at = this.deps.clock.now()): number {
    return this.getIncomeBreakdown(buildingId, at)?.incomePerSecond ?? 0;
  }

  /** Sum of unlocked buildings' income rates (used by offline estimation + HUD). */
  getTotalIncomePerSecond(at = this.deps.clock.now()): number {
    return roundCurrency(
      this.listDefinitions().reduce((total, definition) => total + this.getIncomePerSecond(definition.id, at), 0),
    );
  }

  /**
   * Accrue income up to `at` for every unlocked building. Pure maths - no events,
   * no wallet writes - so it is safe to call every frame.
   */
  accrue(at = this.deps.clock.now()): number {
    const state = this.deps.store.state;
    let accrued = 0;

    for (const definition of this.listDefinitions()) {
      const building = state.buildings[definition.id];
      if (!building || !building.unlocked) continue;

      const last = sanitizeTimestamp(building.lastIncomeAt, at);
      const elapsedMs = Math.max(0, at - last);
      if (elapsedMs <= 0) continue;

      const perSecond = this.getIncomePerSecond(definition.id, at);
      const earned = roundCurrency((perSecond * elapsedMs) / 1000);
      building.lastIncomeAt = at;
      if (earned <= 0) continue;

      building.lifetimeEarned = roundCurrency(building.lifetimeEarned + earned);
      this.pendingCoins = roundCurrency(this.pendingCoins + earned);
      this.pendingByBuilding[definition.id] = roundCurrency((this.pendingByBuilding[definition.id] ?? 0) + earned);
      accrued = roundCurrency(accrued + earned);
      this.deps.events.emit('building:income-accrued', { buildingId: definition.id, coins: earned, at });
    }

    if (accrued > 0) this.deps.store.markDirty(at);
    return accrued;
  }

  get pending(): number {
    return this.pendingCoins;
  }

  /** Push accrued income into the wallet through the economy service. */
  flush(at = this.deps.clock.now()): number {
    if (this.pendingCoins <= 0) return 0;
    const amount = roundCurrency(this.pendingCoins);
    const result = this.deps.economy.add('coins', amount, 'building:income');
    if (!result.ok) {
      // Wallet rejected the credit (should be impossible) - keep it pending and
      // retry on the next flush instead of silently deleting player income.
      this.log.warn(`income flush rejected: ${result.message}`);
      return 0;
    }

    const breakdown = { ...this.pendingByBuilding };
    for (const key of Object.keys(this.pendingByBuilding)) delete this.pendingByBuilding[key];
    this.pendingCoins = 0;
    this.deps.events.emit('building:income-flushed', { coins: amount, breakdown, at });
    return amount;
  }

  /**
   * Read-only facade pairing the definition with its live state. UI and future
   * systems use this instead of re-deriving the same values.
   */
  getEntity(buildingId: BuildingId, at = this.deps.clock.now()): BuildingEntity | null {
    const definition = this.getDefinition(buildingId);
    if (!definition) return null;
    return new BuildingEntity(definition, {
      getState: () => {
        const state = this.getState(buildingId);
        return state ? { tier: state.tier, unlocked: state.unlocked, incomeMultiplier: state.incomeMultiplier } : null;
      },
      getIncomeBreakdown: () => this.getIncomeBreakdown(buildingId, at),
      getVisualState: () => this.getVisualState(buildingId),
      listUpgrades: () => this.upgradeProvider?.listForBuilding(buildingId, at) ?? [],
    });
  }

  /** Entities for every registered building, in authoring order. */
  listEntities(at = this.deps.clock.now()): BuildingEntity[] {
    return this.listDefinitions()
      .map((definition) => this.getEntity(definition.id, at))
      .filter((entity): entity is BuildingEntity => entity !== null);
  }

  /* -------------------------------------------------------------- mutation */

  /** Give every registered building its runtime record (idempotent). */
  syncFromContent(at = this.deps.clock.now()): void {
    const state = this.deps.store.state;
    let changed = false;
    for (const definition of this.listDefinitions()) {
      if (!state.buildings[definition.id]) {
        state.buildings[definition.id] = defaultBuildingState(definition, at);
        changed = true;
      }
    }
    if (changed) this.deps.store.markDirty(at);
  }

  unlock(buildingId: BuildingId, at = this.deps.clock.now()): boolean {
    const building = this.requireState(buildingId);
    if (building.unlocked) return false;
    this.deps.store.update((state) => {
      const target = state.buildings[buildingId];
      target.unlocked = true;
      target.unlockedAt = at;
      target.lastIncomeAt = at;
      state.stats.buildingsUnlocked += 1;
    }, at);
    // Unlocking makes a building's income flow; start from "now", never retroactively.
    this.log.info(`building unlocked: ${buildingId}`);
    this.deps.events.emit('building:unlocked', { buildingId, at });
    return true;
  }

  setTier(buildingId: BuildingId, tier: number, at = this.deps.clock.now()): boolean {
    const definition = this.requireDefinition(buildingId);
    const previous = this.requireState(buildingId).tier;
    const next = clamp(Math.trunc(tier), 0, Math.max(definition.maxTier, 1));
    if (next === previous) return false;

    const visualStateId =
      definition.restorationTiers.find((entry) => entry.tier === next)?.visualStateId ??
      this.getVisualState(buildingId);

    this.deps.store.update((state) => {
      const target = state.buildings[buildingId];
      target.tier = next;
      target.visualStateId = visualStateId;
      if (next > previous) state.stats.buildingsRestored = Math.max(state.stats.buildingsRestored, 0);
    }, at);

    this.deps.events.emit('building:tier-changed', { buildingId, from: previous, to: next, visualStateId });
    return true;
  }

  setVisualState(buildingId: BuildingId, visualStateId: string, at = this.deps.clock.now()): void {
    this.requireState(buildingId);
    this.deps.store.update((state) => {
      state.buildings[buildingId].visualStateId = visualStateId;
    }, at);
    this.deps.events.emit('building:visual-state-changed', { buildingId, visualStateId });
  }

  /**
   * Apply the data-driven effect list of a completed upgrade to a building.
   * Effect semantics live here (single implementation), so two upgrades with the
   * same effect type can never behave differently.
   */
  applyUpgradeEffects(
    buildingId: BuildingId,
    upgradeId: string,
    effects: readonly UpgradeEffectDefinition[],
    at = this.deps.clock.now(),
  ): void {
    this.requireState(buildingId);
    const applied: string[] = [];

    for (const effect of effects) {
      switch (effect.type) {
        case 'income-multiplier': {
          this.deps.store.update((state) => {
            const building = state.buildings[buildingId];
            building.incomeMultiplier = applyMode(building.incomeMultiplier, effect.value, effect.mode ?? 'add');
            if (effect.value < 0) building.incomeMultiplier = Math.max(0, building.incomeMultiplier);
          }, at);
          applied.push(`income-multiplier(${effect.value})`);
          break;
        }
        case 'income-add': {
          this.deps.store.update((state) => {
            const building = state.buildings[buildingId];
            building.incomeBonus = Math.max(0, building.incomeBonus + effect.value);
          }, at);
          applied.push(`income-add(${effect.value})`);
          break;
        }
        case 'income-interval': {
          this.deps.store.update((state) => {
            const building = state.buildings[buildingId];
            const current = building.incomeIntervalMsOverride ?? this.requireDefinition(buildingId).incomeIntervalMs;
            building.incomeIntervalMsOverride = Math.max(
              100,
              sanitizeDuration(applyMode(current, effect.value, effect.mode ?? 'set'), current),
            );
          }, at);
          applied.push(`income-interval(${effect.value})`);
          break;
        }
        case 'worker-slot': {
          this.deps.store.update((state) => {
            const building = state.buildings[buildingId];
            building.workerSlotsBonus = Math.max(0, building.workerSlotsBonus + Math.trunc(effect.value));
          }, at);
          applied.push(`worker-slot(${effect.value})`);
          break;
        }
        case 'visual-state': {
          if (effect.targetId) this.setVisualState(buildingId, effect.targetId, at);
          applied.push(`visual-state(${effect.targetId ?? 'none'})`);
          break;
        }
        case 'flag': {
          if (effect.targetId) {
            this.deps.store.update((state) => {
              state.flags[effect.targetId as string] = effect.value;
            }, at);
          }
          applied.push(`flag(${effect.targetId ?? 'none'})`);
          break;
        }
        // unlock-building / unlock-district / offline-capacity are handled by the
        // UpgradeSystem (they are not building-local).
        default:
          break;
      }
    }

    this.deps.store.update((state) => {
      const building = state.buildings[buildingId];
      if (!building.completedUpgradeIds.includes(upgradeId)) building.completedUpgradeIds.push(upgradeId);
      building.activeUpgradeId = null;
      building.purchaseCounts[upgradeId] = (building.purchaseCounts[upgradeId] ?? 0) + 1;
    }, at);

    this.log.debug(`applied effects of "${upgradeId}" to "${buildingId}": ${applied.join(', ') || 'none'}`);
  }

  /** Debug helper: recompute the district progress cache. */
  recomputeDistrictProgress(districtId: string, at = this.deps.clock.now()): void {
    const district = this.deps.content.getDistrict(districtId);
    if (!district) return;
    const definitions = district.buildingIds
      .map((id) => this.getDefinition(id))
      .filter((definition): definition is BuildingDefinition => Boolean(definition));
    const restored = definitions.filter((definition) => this.isRestored(definition.id)).length;
    const total = definitions.length;
    const progress = total > 0 ? roundCurrency(restored / total) : 0;

    this.deps.store.update((state) => {
      const entry = state.districts[districtId] ?? {
        districtId,
        unlocked: false,
        restoredBuildings: 0,
        totalBuildings: total,
        progress: 0,
        completedAt: null,
        synergyMultiplier: 1,
      };
      entry.totalBuildings = total;
      entry.restoredBuildings = restored;
      entry.progress = progress;
      entry.completedAt = total > 0 && restored >= total ? (entry.completedAt ?? at) : null;
      state.districts[districtId] = entry;
    }, at);

    this.deps.events.emit('progression:district-progress', {
      districtId,
      progress,
      restoredBuildings: restored,
      totalBuildings: total,
    });
  }

  /** Sum of all unlocked buildings' lifetime earnings (debug/stat use). */
  getLifetimeEarned(): number {
    return roundCurrency(
      Object.values(this.deps.store.state.buildings).reduce((total, building) => total + building.lifetimeEarned, 0),
    );
  }

  /** Counters used by the debug overlay. */
  getCounts(): { total: number; unlocked: number; restored: number } {
    const definitions = this.listDefinitions();
    return {
      total: definitions.length,
      unlocked: definitions.filter((definition) => this.isUnlocked(definition.id)).length,
      restored: definitions.filter((definition) => this.isRestored(definition.id)).length,
    };
  }

  /* ------------------------------------------------------------- internals */

  private requireDefinition(buildingId: BuildingId): BuildingDefinition {
    const definition = this.getDefinition(buildingId);
    if (!definition) throw new Error(`unknown building "${buildingId}"`);
    return definition;
  }

  private requireState(buildingId: BuildingId): BuildingState {
    const state = this.getState(buildingId);
    if (!state) throw new Error(`building "${buildingId}" has no runtime state`);
    return state;
  }

  /** Exposed for offline calculations that must not mutate state. */
  static computeAccrual(perSecond: number, elapsedMs: number): number {
    if (!isFiniteNumber(perSecond) || !isFiniteNumber(elapsedMs) || perSecond <= 0 || elapsedMs <= 0) return 0;
    return roundCurrency((perSecond * elapsedMs) / 1000);
  }

  /** Access to the raw state tree for save/offline helpers (read-only by convention). */
  get state(): GameState {
    return this.deps.store.state;
  }
}

function applyMode(current: number, value: number, mode: 'add' | 'set' | 'multiply'): number {
  if (!isFiniteNumber(value)) return current;
  switch (mode) {
    case 'set':
      return value;
    case 'multiply':
      return current * value;
    case 'add':
    default:
      return current + value;
  }
}
