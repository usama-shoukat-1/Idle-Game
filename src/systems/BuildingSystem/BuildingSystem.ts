import { logger } from '@/core/Logger';
import type { GameClock } from '@/core/Time';
import type { ContentRegistry } from '@/core/content/ContentRegistry';
import type { EventBus } from '@/core/events/EventBus';
import type { BuildingDefinition, IncomeModel, SynergyRule } from '@/core/types/content';
import type { BuildingId, StageId } from '@/core/types/primitives';
import type { BuildingRuntimeState, GameState } from '@/core/types/state';
import { STATE_LIMITS } from '@/core/types/state';
import { computeElapsedMs } from '@/core/utils/TimeUtils';
import { clamp, percentToMultiplier } from '@/core/utils/NumberUtils';
import type { EconomySystem } from '@/systems/EconomySystem/EconomySystem';
import { evaluateRequirements, type RequirementContext } from '@/systems/ProgressionSystem/RequirementEvaluator';

/**
 * BUILDING SYSTEM - generic by construction.
 *
 * This class knows how to read a `BuildingDefinition` and mutate a
 * `BuildingRuntimeState`. It contains no reference to any specific building, stage or
 * art asset: the Old Café (or any future building) is registered as content and then
 * behaves exactly like every other building.
 *
 * Responsibilities:
 * - runtime state lifecycle (create on demand, unlock, tier, visual state)
 * - income math (base model x tier multiplier x synergy) and time-based accrual
 * - unlock evaluation against content requirements
 *
 * It does NOT: spend currency for tier advances (UpgradeSystem owns the cost flow),
 * render anything, persist anything, or decide balance values (content owns those).
 */

export interface AccrualOptions {
  /** Fraction of the earned rate actually granted (offline efficiency, penalties). */
  readonly efficiency?: number;
  /** Hard clamp on simulated time, protecting against absurd elapsed durations. */
  readonly maxElapsedMs?: number;
  /** Transaction reason tag for the economy log. */
  readonly reason?: string;
  /** When false, computes the amount without granting it (offline preview). */
  readonly dryRun?: boolean;
}

export interface AccrualResult {
  readonly perBuilding: ReadonlyArray<{ buildingId: BuildingId; coins: number; elapsedMs: number }>;
  readonly totalCoins: number;
  readonly totalElapsedMs: number;
}

export interface TierAdvanceCheck {
  readonly ok: boolean;
  readonly reason?: 'unknown-building' | 'not-unlocked' | 'max-tier' | 'tier-skip' | 'tier-out-of-range';
  readonly nextTier?: number;
}

export class BuildingSystem {
  constructor(
    private readonly state: GameState,
    private readonly content: ContentRegistry,
    private readonly economy: EconomySystem,
    private readonly events: EventBus,
    private readonly clock: GameClock,
  ) {}

  // --- Runtime state -------------------------------------------------------

  getRuntime(buildingId: BuildingId): BuildingRuntimeState | null {
    return this.state.buildings.entries[buildingId] ?? null;
  }

  /** Creates the runtime row for a building on first touch (idempotent). */
  ensureRuntime(buildingId: BuildingId): BuildingRuntimeState {
    const definition = this.content.getBuilding(buildingId);
    const existing = this.state.buildings.entries[buildingId];
    if (existing) return existing;

    const now = this.clock.now();
    const created: BuildingRuntimeState = {
      unlocked: false,
      tier: 0,
      visualState: definition.visualStates[0]?.key ?? 'default',
      lastIncomeAt: now,
      incomeProgress: 0,
      assignedWorkerId: null,
    };
    this.state.buildings.entries[buildingId] = created;
    return created;
  }

  isUnlocked(buildingId: BuildingId): boolean {
    return this.state.buildings.entries[buildingId]?.unlocked ?? false;
  }

  /** Explicit unlock (content requirements are evaluated by `refreshUnlocks`). */
  unlock(buildingId: BuildingId, reason: string): boolean {
    const runtime = this.ensureRuntime(buildingId);
    if (runtime.unlocked) return false;

    const definition = this.content.getBuilding(buildingId);
    runtime.unlocked = true;
    runtime.lastIncomeAt = this.clock.now();
    runtime.visualState = definition.restorationTiers[0]?.visualState ?? runtime.visualState;

    this.events.emit('building:unlocked', { buildingId, stageId: definition.stageId });
    logger.debug('building', `unlocked ${buildingId}`, { reason });
    return true;
  }

  getTier(buildingId: BuildingId): number {
    return this.state.buildings.entries[buildingId]?.tier ?? 0;
  }

  getVisualState(buildingId: BuildingId): string {
    const runtime = this.state.buildings.entries[buildingId];
    if (runtime?.visualState) return runtime.visualState;
    return this.content.getBuilding(buildingId).visualStates[0]?.key ?? 'default';
  }

  getMaxTier(buildingId: BuildingId): number {
    return this.content.getMaxTier(buildingId);
  }

  /** Validates whether the next tier can be applied (cost/currency is not our concern). */
  canAdvanceTier(buildingId: BuildingId): TierAdvanceCheck {
    const definition = this.content.tryGetBuilding(buildingId);
    if (!definition) return { ok: false, reason: 'unknown-building' };
    if (!this.isUnlocked(buildingId)) return { ok: false, reason: 'not-unlocked' };

    const currentTier = this.getTier(buildingId);
    const maxTier = this.content.getMaxTier(buildingId);
    const nextTier = currentTier + 1;

    if (nextTier > maxTier) return { ok: false, reason: 'max-tier', nextTier: currentTier };
    if (!this.content.getTier(buildingId, nextTier)) {
      return { ok: false, reason: 'tier-out-of-range', nextTier: currentTier };
    }
    return { ok: true, nextTier };
  }

  /**
   * Moves a building to `tier`. Called by UpgradeSystem on completion - the *only*
   * supported way to advance restoration tiers, so cost/duration/prerequisite logic
   * exists in exactly one place.
   */
  applyTier(buildingId: BuildingId, tier: number, reason: string): boolean {
    const definition = this.content.getBuilding(buildingId);
    const runtime = this.ensureRuntime(buildingId);

    const maxTier = this.content.getMaxTier(buildingId);
    const target = clamp(Math.floor(tier), 0, maxTier);
    if (target === runtime.tier) return false;

    const tierDefinition = this.content.getTier(buildingId, target);
    runtime.tier = target;
    runtime.visualState = tierDefinition?.visualState ?? runtime.visualState;
    // Income interval restarts so the player never gains or loses a partial tick.
    runtime.lastIncomeAt = this.clock.now();
    runtime.incomeProgress = 0;

    this.events.emit('building:tier-changed', {
      buildingId,
      tier: runtime.tier,
      visualState: runtime.visualState,
    });
    logger.debug('building', `${definition.id} advanced to tier ${runtime.tier}`, { reason });
    return true;
  }

  // --- Income --------------------------------------------------------------

  /** Coins per millisecond at the building's current tier + bonuses. */
  getIncomeRatePerMs(buildingId: BuildingId): number {
    const definition = this.content.getBuilding(buildingId);
    const tierMultiplier = this.getTierMultiplier(buildingId);
    const synergyMultiplier = percentToMultiplier(this.getSynergyBonusPercent(buildingId));
    const base = baseRatePerMs(definition.baseIncome);
    return base * tierMultiplier * synergyMultiplier;
  }

  getIncomePerSecond(buildingId: BuildingId): number {
    return this.getIncomeRatePerMs(buildingId) * 1000;
  }

  /** Absolute multiplier of the current tier (not cumulative - see docs/DATA_MODEL.md). */
  getTierMultiplier(buildingId: BuildingId): number {
    const tier = this.getTier(buildingId);
    const tierDefinition = this.content.getTier(buildingId, tier);
    return tierDefinition?.incomeMultiplier ?? 1;
  }

  /**
   * Synergy bonus for a building, derived from the district content of every building
   * sharing its stage. Rules are pure data, so new synergies never touch this code.
   */
  getSynergyBonusPercent(buildingId: BuildingId): number {
    const definition = this.content.getBuilding(buildingId);
    let bonus = 0;

    for (const other of this.content.getStageBuildings(definition.stageId)) {
      for (const rule of other.synergyRules) {
        if (!ruleAppliesTo(rule, buildingId)) continue;
        if (!this.isRuleActive(rule)) continue;
        bonus += rule.bonusPercent;
      }
    }
    return bonus;
  }

  /** Total income rate of every unlocked building (coins/second). */
  getTotalIncomePerSecond(stageId?: StageId): number {
    let total = 0;
    for (const building of this.content.getAllBuildings()) {
      if (stageId && building.stageId !== stageId) continue;
      if (!this.isUnlocked(building.id)) continue;
      total += this.getIncomePerSecond(building.id);
    }
    return total;
  }

  /** Progress of the current income interval, 0..1, for UI rings and timers. */
  getIncomeProgress(buildingId: BuildingId, nowMs = this.clock.now()): number {
    const runtime = this.state.buildings.entries[buildingId];
    if (!runtime) return 0;
    const definition = this.content.getBuilding(buildingId);
    const intervalMs = definition.baseIncome.kind === 'perInterval' ? definition.baseIncome.intervalMs : 0;
    if (intervalMs <= 0) return 1;
    const elapsed = clamp(nowMs - runtime.lastIncomeAt, 0, intervalMs);
    return elapsed / intervalMs;
  }

  /**
   * Time-based accrual for one building.
   *
   * Design: accrual is computed from `now - lastIncomeAt` and is *rate* based, not
   * interval based, because it must answer the same question after a 3-second frame
   * hitch, a background tab and a 6-hour offline gap. Fractional coins are carried
   * forward by only advancing `lastIncomeAt` by the time that was actually paid out.
   */
  accrueIncome(buildingId: BuildingId, options: AccrualOptions = {}): { coins: number; elapsedMs: number } {
    const runtime = this.state.buildings.entries[buildingId];
    if (!runtime || !runtime.unlocked) return { coins: 0, elapsedMs: 0 };

    const now = this.clock.now();
    const maxElapsed = options.maxElapsedMs ?? STATE_LIMITS.maxOfflineDurationMs;
    const elapsedMs = computeElapsedMs(runtime.lastIncomeAt, now, maxElapsed);
    if (elapsedMs <= 0) {
      // Clock moved backwards: re-anchor, never pay out negative time.
      if (runtime.lastIncomeAt > now) runtime.lastIncomeAt = now;
      return { coins: 0, elapsedMs: 0 };
    }

    const efficiency = clamp(options.efficiency ?? 1, 0, 1);
    const ratePerMs = this.getIncomeRatePerMs(buildingId) * efficiency;
    if (ratePerMs <= 0) {
      runtime.lastIncomeAt = now;
      return { coins: 0, elapsedMs };
    }

    const rawCoins = ratePerMs * elapsedMs;
    const coins = Math.floor(rawCoins);
    if (coins <= 0) {
      // Nothing payable yet: keep the anchor so the fraction is not lost. Only advance
      // when the accumulated fraction would exceed the payout threshold.
      if (!options.dryRun) runtime.lastIncomeAt = now - Math.floor(rawCoins / ratePerMs);
      return { coins: 0, elapsedMs };
    }

    if (!options.dryRun) {
      // Advance by exactly the time that was paid for; the remainder stays banked.
      const consumedMs = Math.floor(coins / ratePerMs);
      runtime.lastIncomeAt = Math.min(now, runtime.lastIncomeAt + Math.max(consumedMs, 1));
      runtime.incomeProgress = this.getIncomeProgress(buildingId, runtime.lastIncomeAt);

      const granted = this.economy.addCoins(coins, options.reason ?? 'building.income');
      this.events.emit('building:income-accrued', { buildingId, coins: granted, elapsedMs });
      return { coins: granted, elapsedMs };
    }

    return { coins, elapsedMs };
  }

  /** Accrues income for every unlocked building in one pass (see AccrualOptions). */
  accrueAll(options: AccrualOptions = {}): AccrualResult {
    const perBuilding: Array<{ buildingId: BuildingId; coins: number; elapsedMs: number }> = [];
    let totalCoins = 0;
    let totalElapsedMs = 0;

    for (const building of this.content.getAllBuildings()) {
      const result = this.accrueIncome(building.id, options);
      if (result.coins > 0) {
        perBuilding.push({ buildingId: building.id, coins: result.coins, elapsedMs: result.elapsedMs });
        totalCoins += result.coins;
      }
      totalElapsedMs = Math.max(totalElapsedMs, result.elapsedMs);
    }

    return { perBuilding, totalCoins, totalElapsedMs };
  }

  // --- Queries / unlocks ---------------------------------------------------

  getBuildingsForStage(stageId: StageId): readonly BuildingDefinition[] {
    return this.content.getStageBuildings(stageId);
  }

  getUnlockedBuildings(stageId?: StageId): readonly BuildingDefinition[] {
    return this.content
      .getAllBuildings()
      .filter((building) => (!stageId || building.stageId === stageId) && this.isUnlocked(building.id));
  }

  /** Unlocks every building whose content requirements are now satisfied. */
  refreshUnlocks(reason = 'requirements-met'): readonly BuildingId[] {
    const unlocked: BuildingId[] = [];
    const context = this.createRequirementContext();

    for (const building of this.content.getAllBuildings()) {
      if (this.isUnlocked(building.id)) continue;
      if (building.unlockRequirements.length === 0) continue; // explicit unlock only
      const status = evaluateRequirements(building.unlockRequirements, context);
      if (!status.satisfied) continue;
      this.unlock(building.id, reason);
      unlocked.push(building.id);
    }
    return unlocked;
  }

  /** Human-readable reason the player cannot access a building yet (tooltips). */
  getLockDescription(buildingId: BuildingId): string {
    const definition = this.content.tryGetBuilding(buildingId);
    if (!definition) return 'Unknown building';
    if (this.isUnlocked(buildingId)) return '';
    const status = evaluateRequirements(definition.unlockRequirements, this.createRequirementContext());
    return status.satisfied ? '' : status.description;
  }

  private isRuleActive(rule: SynergyRule): boolean {
    if (rule.requires.length === 0) return false;
    return rule.requires.every((requirement) => {
      if (!this.isUnlocked(requirement.buildingId)) return false;
      return this.getTier(requirement.buildingId) >= requirement.minTier;
    });
  }

  private createRequirementContext(): RequirementContext {
    return {
      state: this.state,
      content: this.content,
      isBuildingUnlocked: (id) => this.isUnlocked(id),
      isUpgradeCompleted: (id) => this.state.upgrades.completed.includes(id),
      getCurrency: (currency) => this.economy.getBalance(currency),
      getStageProgress: (id) => {
        const progress = this.state.progression.stages[id];
        return progress ? { mastery: progress.mastery, unlocked: progress.unlocked } : null;
      },
    };
  }
}

/** Base rate in coins/ms for an income model. `flat` is a one-shot, so its rate is 0. */
export function baseRatePerMs(model: IncomeModel): number {
  switch (model.kind) {
    case 'perInterval':
      return model.intervalMs > 0 ? model.coinsPerInterval / model.intervalMs : 0;
    case 'perSecond':
      return model.coinsPerSecond / 1000;
    case 'flat':
      return 0;
    default:
      return 0;
  }
}

function ruleAppliesTo(rule: SynergyRule, buildingId: BuildingId): boolean {
  if (rule.appliesTo.length === 0) return true;
  return rule.appliesTo.includes(buildingId);
}
