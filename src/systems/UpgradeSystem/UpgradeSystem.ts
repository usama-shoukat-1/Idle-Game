/**
 * Upgrade engine.
 *
 * One implementation handles instant upgrades, timed upgrades, prerequisites,
 * costs, gem acceleration and completion effects. Which upgrades exist (and what
 * they do) is entirely content data - this file only interprets definitions.
 *
 * Flow
 *   evaluate() -> start() -> [TimerSystem] -> timer:completed -> complete()
 *                       \-> instant (durationMs === 0) completes inline
 */

import type { Clock } from '@/core/Clock';
import type { CurrencyCost, UpgradeDefinition, UpgradeEffectDefinition } from '@/core/types/content';
import type { BuildingId, DistrictId, TimerId, UpgradeId } from '@/core/types/ids';
import type { ActiveUpgradeState } from '@/core/types/gameState';
import type { GameStateStore } from '@/core/state/GameStateStore';
import { createLogger } from '@/core/utils/logger';
import { roundCurrency } from '@/core/utils/numbers';
import { MS_PER_MINUTE } from '@/core/utils/time';
import type { GameEventBus, Subscription } from '@/systems/EventSystem';
import type { BuildingSystem } from '@/systems/BuildingSystem/BuildingSystem';
import type { ContentRegistry } from '@/systems/ContentSystem/ContentRegistry';
import type { EconomySystem } from '@/systems/EconomySystem/EconomySystem';
import type { ProgressionSystem } from '@/systems/ProgressionSystem/ProgressionSystem';
import type { TimerSystem } from '@/systems/TimerSystem/TimerSystem';

export type UpgradeStatusCode =
  | 'ok'
  | 'unknown-upgrade'
  | 'already-active'
  | 'already-completed'
  | 'max-purchases'
  | 'no-target'
  | 'target-locked'
  | 'prerequisites'
  | 'not-affordable';

export interface UpgradeAvailability {
  upgradeId: UpgradeId;
  ok: boolean;
  code: UpgradeStatusCode;
  message: string;
  cost: CurrencyCost;
  /** Gems needed to finish instantly right now (0 = instant/no acceleration). */
  skipCostGems: number;
  remainingMs: number;
  durationMs: number;
  buildingId: BuildingId | null;
  definition: UpgradeDefinition | null;
}

export interface UpgradeStartResult {
  ok: boolean;
  availability: UpgradeAvailability;
  timerId: TimerId | null;
  completedInstantly: boolean;
}

export interface UpgradeSystemDeps {
  store: GameStateStore;
  events: GameEventBus;
  clock: Clock;
  content: ContentRegistry;
  economy: EconomySystem;
  timers: TimerSystem;
  buildings: BuildingSystem;
  progression: ProgressionSystem;
}

export class UpgradeSystem {
  private readonly log = createLogger('upgrades');
  private readonly timerSubscription: Subscription;

  constructor(private readonly deps: UpgradeSystemDeps) {
    // Timed upgrades finish through the timer event, so a suspended device or a
    // page reload still completes the upgrade at the right timestamp.
    this.timerSubscription = this.deps.events.on('timer:completed', ({ timer }) => {
      if (timer.kind !== 'upgrade') return;
      const upgradeId = typeof timer.meta?.upgradeId === 'string' ? timer.meta.upgradeId : undefined;
      if (!upgradeId) return;
      this.complete(upgradeId, false, timer.updatedAt);
    });
  }

  dispose(): void {
    this.timerSubscription.off();
  }

  /* --------------------------------------------------------------- lookups */

  getDefinition(upgradeId: UpgradeId): UpgradeDefinition | null {
    return this.deps.content.getUpgrade(upgradeId);
  }

  getActive(upgradeId: UpgradeId): ActiveUpgradeState | null {
    return this.deps.store.state.upgrades.active[upgradeId] ?? null;
  }

  getActiveForBuilding(buildingId: BuildingId): ActiveUpgradeState | null {
    const active = Object.values(this.deps.store.state.upgrades.active);
    return active.find((entry) => entry.buildingId === buildingId) ?? null;
  }

  getRemainingMs(upgradeId: UpgradeId, at = this.deps.clock.now()): number {
    const active = this.getActive(upgradeId);
    if (!active) return 0;
    return this.deps.timers.getRemainingMs(active.timerId, at);
  }

  getProgress(upgradeId: UpgradeId) {
    const active = this.getActive(upgradeId);
    if (!active) return null;
    return this.deps.timers.getProgress(active.timerId);
  }

  /** Upgrade ids that make sense to show for a building, with live availability. */
  listForBuilding(buildingId: BuildingId, at = this.deps.clock.now()): UpgradeAvailability[] {
    const definition = this.deps.content.getBuilding(buildingId);
    if (!definition) return [];
    const ids = new Set<UpgradeId>([
      ...definition.upgradeIds,
      ...this.deps.content
        .listUpgrades()
        .filter((upgrade) => upgrade.target.kind === 'building' && upgrade.target.buildingId === buildingId)
        .map((upgrade) => upgrade.id),
    ]);
    return [...ids].map((upgradeId) => this.evaluate(upgradeId, at));
  }

  /* ------------------------------------------------------------- evaluation */

  evaluate(upgradeId: UpgradeId, at = this.deps.clock.now()): UpgradeAvailability {
    const definition = this.getDefinition(upgradeId);
    const base: UpgradeAvailability = {
      upgradeId,
      ok: false,
      code: 'unknown-upgrade',
      message: `unknown upgrade "${upgradeId}"`,
      cost: {},
      skipCostGems: 0,
      remainingMs: 0,
      durationMs: 0,
      buildingId: null,
      definition: definition ?? null,
    };

    if (!definition) return base;

    const buildingId = definition.target.kind === 'building' ? definition.target.buildingId : null;
    const availability: UpgradeAvailability = {
      ...base,
      ok: true,
      code: 'ok',
      message: 'ready',
      cost: { ...definition.cost },
      durationMs: Math.max(0, definition.durationMs),
      buildingId,
      definition,
    };

    const active = this.getActive(upgradeId);
    if (active) {
      const remainingMs = this.deps.timers.getRemainingMs(active.timerId, at);
      return {
        ...availability,
        ok: false,
        code: 'already-active',
        message: 'upgrade already in progress',
        remainingMs,
        skipCostGems: this.computeSkipCost(definition, remainingMs),
      };
    }

    // Repeatable non-building upgrades track their purchase count in flags, so a
    // district/global upgrade has the same max-purchase semantics as a building one.
    const purchases = buildingId
      ? (this.deps.store.state.buildings[buildingId]?.purchaseCounts[upgradeId] ?? 0)
      : Number(this.deps.store.state.flags[`upgrade-purchases:${upgradeId}`] ?? 0);

    if (!definition.repeatable && this.deps.store.state.upgrades.completed.includes(upgradeId)) {
      return { ...availability, ok: false, code: 'already-completed', message: 'already completed' };
    }
    if (definition.maxPurchases !== undefined && purchases >= definition.maxPurchases) {
      return { ...availability, ok: false, code: 'max-purchases', message: 'maximum purchases reached' };
    }

    if (buildingId) {
      const building = this.deps.store.state.buildings[buildingId];
      if (!building || !building.unlocked) {
        return { ...availability, ok: false, code: 'target-locked', message: 'target building is locked' };
      }
    } else if (definition.target.kind === 'district') {
      if (!this.deps.store.state.districts[definition.target.districtId]?.unlocked) {
        return { ...availability, ok: false, code: 'target-locked', message: 'target district is locked' };
      }
    }

    const prerequisites = this.deps.progression.checkUpgradePrerequisites(definition);
    if (!prerequisites.ok) {
      return { ...availability, ok: false, code: 'prerequisites', message: prerequisites.reasons.join(', ') };
    }

    if (!this.deps.economy.canAfford(definition.cost)) {
      return { ...availability, ok: false, code: 'not-affordable', message: 'cannot afford this upgrade' };
    }

    return availability;
  }

  /** Gems needed to skip the remaining time (0 when acceleration is disabled). */
  computeSkipCost(definition: UpgradeDefinition, remainingMs: number): number {
    if (!definition.gemSkipRatePerMinute || definition.gemSkipRatePerMinute <= 0 || remainingMs <= 0) return 0;
    const minutes = remainingMs / MS_PER_MINUTE;
    // Partial minutes round up: the player never gets a cheaper deal by waiting.
    return Math.max(1, Math.ceil(minutes * definition.gemSkipRatePerMinute));
  }

  /* --------------------------------------------------------------- mutation */

  /**
   * Start (and pay for) an upgrade. Instant upgrades complete inside this call;
   * timed upgrades register a timestamp-based timer.
   */
  start(upgradeId: UpgradeId, at = this.deps.clock.now()): UpgradeStartResult {
    const availability = this.evaluate(upgradeId, at);
    if (!availability.ok || !availability.definition) {
      this.deps.events.emit('upgrade:rejected', {
        upgradeId,
        buildingId: availability.buildingId,
        code: availability.code,
        message: availability.message,
      });
      return { ok: false, availability, timerId: null, completedInstantly: false };
    }

    const definition = availability.definition;
    const spend = this.deps.economy.spendCost(definition.cost, 'upgrade:purchase');
    if (!spend.ok) {
      const rejected = { ...availability, ok: false, code: 'not-affordable' as const, message: spend.message };
      this.deps.events.emit('upgrade:rejected', {
        upgradeId,
        buildingId: availability.buildingId,
        code: rejected.code,
        message: rejected.message,
      });
      return { ok: false, availability: rejected, timerId: null, completedInstantly: false };
    }

    if (definition.durationMs <= 0) {
      this.complete(upgradeId, true, at);
      const completed = this.evaluate(upgradeId, at);
      return {
        ok: true,
        availability: completed.ok ? completed : { ...completed, ok: true, code: 'ok', message: 'completed instantly' },
        timerId: null,
        completedInstantly: true,
      };
    }

    const timer = this.deps.timers.start({
      kind: 'upgrade',
      label: definition.displayName,
      durationMs: definition.durationMs,
      targetId: availability.buildingId ?? upgradeId,
      meta: { upgradeId, ...(availability.buildingId ? { buildingId: availability.buildingId } : {}) },
    });

    const active: ActiveUpgradeState = {
      upgradeId,
      buildingId: availability.buildingId,
      timerId: timer.id,
      startedAt: at,
      endsAt: timer.endsAt,
      durationMs: timer.durationMs,
      costPaid: { ...definition.cost },
      purchases: 1,
    };

    this.deps.store.update((state) => {
      state.upgrades.active[upgradeId] = active;
      if (availability.buildingId) {
        state.buildings[availability.buildingId].activeUpgradeId = upgradeId;
      }
    }, at);

    this.deps.events.emit('upgrade:started', {
      upgradeId,
      buildingId: availability.buildingId,
      timerId: timer.id,
      cost: { ...definition.cost },
      endsAt: timer.endsAt,
    });
    this.log.info(`upgrade started: ${upgradeId} -> ${timer.endsAt}`);

    return { ok: true, availability, timerId: timer.id, completedInstantly: false };
  }

  /**
   * Pay gems to finish a running upgrade immediately. Returns the gems charged
   * (0 when nothing happened).
   */
  skipWithGems(upgradeId: UpgradeId, at = this.deps.clock.now()): { ok: boolean; gemsSpent: number; message: string } {
    const definition = this.getDefinition(upgradeId);
    const active = this.getActive(upgradeId);
    if (!definition || !active) return { ok: false, gemsSpent: 0, message: 'no active upgrade' };

    const remainingMs = this.deps.timers.getRemainingMs(active.timerId, at);
    const cost = this.computeSkipCost(definition, remainingMs);
    if (cost <= 0) return { ok: false, gemsSpent: 0, message: 'gem acceleration is not available' };

    const spend = this.deps.economy.spend('gems', cost, 'upgrade:skip');
    if (!spend.ok) return { ok: false, gemsSpent: 0, message: spend.message };

    this.deps.timers.completeNow(active.timerId);
    // `timer:completed` synchronously triggers complete(), so the upgrade is done
    // by the time we return. Guard in case the timer had already finished.
    if (this.getActive(upgradeId)) this.complete(upgradeId, false, at);
    return { ok: true, gemsSpent: cost, message: 'upgrade accelerated' };
  }

  /** Cancel a running upgrade, optionally refunding the coins paid. */
  cancel(upgradeId: UpgradeId, refund = false, at = this.deps.clock.now()): boolean {
    const active = this.getActive(upgradeId);
    if (!active) return false;

    this.deps.timers.cancel(active.timerId, 'upgrade-cancelled');
    if (refund && active.costPaid.coins) {
      this.deps.economy.add('coins', active.costPaid.coins, 'upgrade:refund');
    }
    if (refund && active.costPaid.gems) {
      this.deps.economy.add('gems', active.costPaid.gems, 'upgrade:refund');
    }

    this.deps.store.update((state) => {
      delete state.upgrades.active[upgradeId];
      if (active.buildingId && state.buildings[active.buildingId]) {
        state.buildings[active.buildingId].activeUpgradeId = null;
      }
    }, at);

    this.deps.events.emit('upgrade:cancelled', { upgradeId, buildingId: active.buildingId, reason: 'cancelled' });
    return true;
  }

  /* ------------------------------------------------------------- completion */

  private complete(upgradeId: UpgradeId, instant: boolean, at: number): void {
    const definition = this.getDefinition(upgradeId);
    const active = this.getActive(upgradeId);

    // A timer can fire for an upgrade that content no longer knows about; clean up.
    if (!definition) {
      if (active) {
        this.deps.store.update((state) => {
          delete state.upgrades.active[upgradeId];
        }, at);
      }
      this.log.warn(`timer completed for unknown upgrade "${upgradeId}"`);
      return;
    }

    const buildingId = definition.target.kind === 'building' ? definition.target.buildingId : null;

    if (buildingId && this.deps.store.state.buildings[buildingId]) {
      this.deps.buildings.applyUpgradeEffects(buildingId, upgradeId, definition.effects, at);

      if (definition.tier > 0) {
        this.deps.buildings.setTier(buildingId, definition.tier, at);
      }
      if (definition.visualStateId) {
        this.deps.buildings.setVisualState(buildingId, definition.visualStateId, at);
      }
    }

    this.applyNonBuildingEffects(definition, at);

    this.deps.store.update((state) => {
      delete state.upgrades.active[upgradeId];
      if (buildingId && state.buildings[buildingId]) state.buildings[buildingId].activeUpgradeId = null;
      if (!definition.repeatable && !state.upgrades.completed.includes(upgradeId)) {
        state.upgrades.completed.push(upgradeId);
      }
      if (!buildingId) {
        const key = `upgrade-purchases:${upgradeId}`;
        state.flags[key] = Number(state.flags[key] ?? 0) + 1;
      }
      state.stats.upgradesCompleted += 1;
    }, at);

    this.log.info(`upgrade completed: ${upgradeId}${instant ? ' (instant)' : ''}`);
    this.deps.events.emit('upgrade:completed', {
      upgradeId,
      buildingId,
      tier: definition.tier,
      instant,
    });

    this.deps.progression.onUpgradeCompleted(buildingId, at);
  }

  /** Effects that are not local to a single building. */
  private applyNonBuildingEffects(definition: UpgradeDefinition, at: number): void {
    for (const effect of definition.effects as readonly UpgradeEffectDefinition[]) {
      switch (effect.type) {
        case 'unlock-building':
          if (effect.targetId) this.deps.buildings.unlock(effect.targetId, at);
          break;
        case 'unlock-district':
          if (effect.targetId) this.deps.progression.unlockDistrict(effect.targetId as DistrictId, at);
          break;
        case 'offline-capacity':
          this.deps.store.update((state) => {
            state.flags['offline:capacity-bonus-ms'] = Math.max(
              0,
              Number(state.flags['offline:capacity-bonus-ms'] ?? 0) + effect.value,
            );
          }, at);
          break;
        default:
          break;
      }
    }
  }

  /* ---------------------------------------------------------------- debug */

  /** Debug tool: finish every running upgrade instantly. */
  finishAllActive(at = this.deps.clock.now()): number {
    const active = Object.values(this.deps.store.state.upgrades.active);
    for (const entry of active) this.deps.timers.completeNow(entry.timerId);
    // Safety net in case a timer was missing from the timer store.
    for (const entry of active) {
      if (this.getActive(entry.upgradeId)) this.complete(entry.upgradeId, false, at);
    }
    return active.length;
  }

  getActiveCount(): number {
    return Object.keys(this.deps.store.state.upgrades.active).length;
  }

  getCompletedCount(): number {
    return this.deps.store.state.upgrades.completed.length;
  }

  /** Cost of the next data-driven upgrade for a building, for HUD display. */
  getNextUpgradeCost(buildingId: BuildingId): CurrencyCost | null {
    const next = this.listForBuilding(buildingId).find((entry) => entry.code === 'ok');
    return next ? { ...next.cost } : null;
  }

  /** Rounded currency helper used by UI code that displays costs. */
  static displayCost(cost: CurrencyCost, currency: 'coins' | 'gems'): number {
    return roundCurrency(cost[currency] ?? 0);
  }
}
