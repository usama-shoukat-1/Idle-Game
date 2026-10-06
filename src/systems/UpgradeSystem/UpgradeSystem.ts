import { logger } from '@/core/Logger';
import type { GameClock } from '@/core/Time';
import type { ContentRegistry } from '@/core/content/ContentRegistry';
import type { EventBus } from '@/core/events/EventBus';
import type { BuildingId, UpgradeId } from '@/core/types/primitives';
import type { GameState, UpgradeJobState } from '@/core/types/state';
import { computeElapsedMs } from '@/core/utils/TimeUtils';
import { normalizeCurrencyAmount } from '@/core/utils/NumberUtils';
import type { EconomySystem } from '@/systems/EconomySystem/EconomySystem';
import type { BuildingSystem } from '@/systems/BuildingSystem/BuildingSystem';
import { TimerSystem, timerKeys } from '@/systems/TimerSystem/TimerSystem';
import type { Cost } from '@/core/types/settings';

/**
 * REUSABLE UPGRADE ENGINE
 * =======================
 * One engine drives every restoration step in the game, whether it is an instant
 * purchase or a multi-hour construction job:
 *
 *   check -> pay -> (instant ? apply : persist job + start timer) -> apply -> announce
 *
 * Because the engine only reads `UpgradeDefinition` fields, adding content never
 * touches this file. Phase 0 registers no upgrades; `tests/upgrade-engine.test.ts`
 * exercises instant, timed, prerequisite, insufficient-funds, gem-acceleration,
 * time-skip and reload-rehydration paths against synthetic definitions.
 *
 * Persistence: running jobs live in `GameState.upgrades.active` (epoch timestamps)
 * and are re-registered into TimerSystem by `rehydrate()` on load. A job whose
 * `completesAt` already passed while the game was closed is applied immediately, which
 * is what makes "upgrades finish while you are away" work with zero extra machinery.
 */

export type UpgradeCheckReason =
  | 'unknown-upgrade'
  | 'already-completed'
  | 'already-running'
  | 'missing-prerequisite'
  | 'building-locked'
  | 'tier-not-available'
  | 'insufficient-funds';

export interface UpgradeCheck {
  readonly ok: boolean;
  readonly reason?: UpgradeCheckReason;
  /** Player-facing text for the blocking reason. */
  readonly message?: string;
}

export type UpgradeStatus = 'locked' | 'available' | 'running' | 'completed';

export class UpgradeSystem {
  constructor(
    private readonly state: GameState,
    private readonly content: ContentRegistry,
    private readonly economy: EconomySystem,
    private readonly timers: TimerSystem,
    private readonly buildings: BuildingSystem,
    private readonly events: EventBus,
    private readonly clock: GameClock,
  ) {}

  /**
   * Re-attaches persisted jobs to the timer system after a load, applying any job that
   * finished while the game was closed.
   */
  rehydrate(): { resumed: number; completedOffline: number } {
    let resumed = 0;
    let completedOffline = 0;
    const now = this.clock.now();

    for (const job of Object.values({ ...this.state.upgrades.active })) {
      const definition = this.content.tryGetUpgrade(job.upgradeId);
      if (!definition) {
        delete this.state.upgrades.active[job.upgradeId];
        logger.warn('upgrade', `dropping job for unknown upgrade "${job.upgradeId}"`);
        continue;
      }

      if (job.completesAt <= now) {
        // Completed while the game was closed: keep the building's income anchor so the
        // offline payout can still cover the whole absence (see OfflineIncomeSystem).
        this.applyCompletion(job.upgradeId, 'rehydrate.offline-complete', {
          preserveIncomeAnchor: true,
        });
        completedOffline += 1;
        continue;
      }

      this.registerTimer(job.upgradeId);
      resumed += 1;
    }

    return { resumed, completedOffline };
  }

  getStatus(upgradeId: UpgradeId): UpgradeStatus {
    if (this.state.upgrades.completed.includes(upgradeId)) return 'completed';
    if (this.state.upgrades.active[upgradeId]) return 'running';
    return this.canStart(upgradeId).ok ? 'available' : 'locked';
  }

  isRunning(upgradeId: UpgradeId): boolean {
    return Boolean(this.state.upgrades.active[upgradeId]);
  }

  isCompleted(upgradeId: UpgradeId): boolean {
    return this.state.upgrades.completed.includes(upgradeId);
  }

  getActiveJobs(): readonly UpgradeJobState[] {
    return Object.values(this.state.upgrades.active);
  }

  getActiveJobForBuilding(buildingId: BuildingId): UpgradeJobState | null {
    return (
      Object.values(this.state.upgrades.active).find((job) => job.buildingId === buildingId) ?? null
    );
  }

  getRemainingMs(upgradeId: UpgradeId): number {
    const job = this.state.upgrades.active[upgradeId];
    if (!job) return 0;
    return this.timers.has(timerKeys.upgrade(upgradeId))
      ? this.timers.getRemainingMs(timerKeys.upgrade(upgradeId))
      : Math.max(0, job.completesAt - this.clock.now());
  }

  /** Progress of a running job in 0..1 (0 for unknown jobs). */
  getProgress(upgradeId: UpgradeId): number {
    const job = this.state.upgrades.active[upgradeId];
    if (!job) return 0;
    const duration = job.completesAt - job.startedAt;
    if (duration <= 0) return 1;
    const elapsed = computeElapsedMs(job.startedAt, this.clock.now(), duration);
    return Math.min(1, elapsed / duration);
  }

  /** Validates every requirement *except* affordability. */
  canStart(upgradeId: UpgradeId): UpgradeCheck {
    const definition = this.content.tryGetUpgrade(upgradeId);
    if (!definition) {
      return { ok: false, reason: 'unknown-upgrade', message: 'Unknown upgrade' };
    }
    if (this.isCompleted(upgradeId)) {
      return { ok: false, reason: 'already-completed', message: 'Already restored' };
    }
    if (this.isRunning(upgradeId)) {
      return { ok: false, reason: 'already-running', message: 'Work already in progress' };
    }

    const missing = definition.prerequisites.find((id) => !this.isCompleted(id));
    if (missing) {
      const prerequisite = this.content.tryGetUpgrade(missing);
      return {
        ok: false,
        reason: 'missing-prerequisite',
        message: `Requires ${prerequisite?.displayName ?? missing}`,
      };
    }

    if (!this.buildings.isUnlocked(definition.targetBuildingId)) {
      return { ok: false, reason: 'building-locked', message: 'Building is still locked' };
    }

    const buildingTier = this.buildings.getTier(definition.targetBuildingId);
    if (definition.tier > buildingTier + 1) {
      return { ok: false, reason: 'tier-not-available', message: 'Previous tier required' };
    }

    if (!this.economy.canAfford(definition.cost)) {
      return { ok: false, reason: 'insufficient-funds', message: 'Not enough funds' };
    }

    return { ok: true };
  }

  /**
   * Starts an upgrade.
   * @returns a check result; `ok: true` means the upgrade was started *or* (for
   *          instant upgrades) already completed.
   */
  start(upgradeId: UpgradeId): UpgradeCheck {
    const definition = this.content.tryGetUpgrade(upgradeId);
    if (!definition) return { ok: false, reason: 'unknown-upgrade', message: 'Unknown upgrade' };

    // Checks already include affordability; keep the explicit guard so a future caller
    // that bypasses `canStart` still cannot spend into the negative.
    const check = this.canStart(upgradeId);
    if (!check.ok) return check;

    const paid = this.economy.spend(definition.cost, `upgrade.start:${upgradeId}`);
    if (!paid) {
      return { ok: false, reason: 'insufficient-funds', message: 'Not enough funds' };
    }

    if (definition.durationMs <= 0) {
      this.applyCompletion(upgradeId, 'upgrade.instant');
      return { ok: true };
    }

    const now = this.clock.now();
    const job: UpgradeJobState = {
      upgradeId,
      buildingId: definition.targetBuildingId,
      startedAt: now,
      completesAt: now + definition.durationMs,
      applied: false,
    };
    this.state.upgrades.active[upgradeId] = job;
    this.registerTimer(upgradeId);

    this.events.emit('upgrade:started', {
      upgradeId,
      buildingId: definition.targetBuildingId,
      completesAt: job.completesAt,
    });
    logger.debug('upgrade', `started ${upgradeId}`, { durationMs: definition.durationMs });
    return { ok: true };
  }

  /** Forces a running job to finish now (timer expiry, gem acceleration, debug tool). */
  completeNow(upgradeId: UpgradeId, reason = 'upgrade.forced'): boolean {
    if (!this.state.upgrades.active[upgradeId]) return false;
    this.timers.cancel(timerKeys.upgrade(upgradeId));
    return this.applyCompletion(upgradeId, reason);
  }

  /**
   * Shortens a running job - the hook behind rewarded-ad speed-ups and any future
   * boost. Returns the number of milliseconds actually removed.
   *
   * @param source analytics tag: 'ad' for rewarded speed-ups, 'debug' for cheats.
   */
  reduceRemaining(upgradeId: UpgradeId, reduceMs: number, source: 'ad' | 'debug' = 'ad'): number {
    const job = this.state.upgrades.active[upgradeId];
    if (!job) return 0;

    const before = this.getRemainingMs(upgradeId);
    const key = timerKeys.upgrade(upgradeId);
    if (!this.timers.has(key)) {
      this.registerTimer(upgradeId);
    }
    this.timers.reduce(key, reduceMs);
    const after = this.getRemainingMs(upgradeId);

    // A fully reduced job completes immediately (still through the timer system, so
    // completion ordering and events stay identical to the normal path).
    if (after <= 0) this.timers.tick();

    const applied = Math.max(0, before - after);
    if (applied > 0) {
      this.events.emit('upgrade:speed-up', { upgradeId, source, appliedMs: applied });
    }
    return applied;
  }

  /** Cost in gems to finish a running job instantly (content-driven conversion). */
  getAccelerationCost(upgradeId: UpgradeId): Cost | null {
    const job = this.state.upgrades.active[upgradeId];
    if (!job) return null;
    const balance = this.content.getEconomyBalance().acceleration;
    const remainingMs = this.getRemainingMs(upgradeId);
    const remainingMinutes = remainingMs / 60_000;

    // Phase 1 rule (content-driven): 1 gem per remaining minute, floored at the configured
    // minimum and clamped so the cost can never exceed what the remaining time is worth.
    const raw = Math.max(balance.minimumGems, Math.ceil(remainingMinutes * balance.gemsPerMinute));
    const clamped = Math.min(normalizeCurrencyAmount(raw), Math.max(1, normalizeCurrencyAmount(remainingMs)));
    return { currency: 'gems', amount: clamped };
  }

  /**
   * Finishes a running job with gems. Returns false when the player cannot afford it or
   * the upgrade does not allow acceleration.
   */
  accelerate(upgradeId: UpgradeId): boolean {
    const definition = this.content.tryGetUpgrade(upgradeId);
    if (!definition || definition.options?.gemAcceleration === false) return false;

    const cost = this.getAccelerationCost(upgradeId);
    if (!cost) return false;
    if (!this.economy.canAfford(cost)) return false;

    const remainingBefore = this.getRemainingMs(upgradeId);
    if (!this.economy.spend(cost, `upgrade.accelerate:${upgradeId}`)) return false;

    const completed = this.completeNow(upgradeId, 'upgrade.accelerated');
    if (completed && remainingBefore > 0) {
      // Gem finishes are speed-ups too: same analytics event, different source.
      this.events.emit('upgrade:speed-up', {
        upgradeId,
        source: 'gems',
        appliedMs: remainingBefore,
      });
    }
    return completed;
  }

  /** Cancels a running job. Costs are not refunded (Phase 1 decides the policy). */
  cancel(upgradeId: UpgradeId): boolean {
    const job = this.state.upgrades.active[upgradeId];
    if (!job) return false;
    delete this.state.upgrades.active[upgradeId];
    this.timers.cancel(timerKeys.upgrade(upgradeId));
    this.events.emit('upgrade:cancelled', { upgradeId, buildingId: job.buildingId });
    return true;
  }

  /** The upgrade the player is most likely to want to speed up (longest running job). */
  getPrimaryActiveJob(): UpgradeJobState | null {
    const jobs = this.getActiveJobs();
    if (jobs.length === 0) return null;
    return jobs.reduce((slowest, job) => (job.completesAt < slowest.completesAt ? job : slowest));
  }

  // --- internals -----------------------------------------------------------

  private registerTimer(upgradeId: UpgradeId): void {
    const job = this.state.upgrades.active[upgradeId];
    if (!job) return;
    // Pass the absolute deadline so a rehydrated job finishes at exactly the same moment as
    // it would have if the game had never been closed.
    this.timers.start(timerKeys.upgrade(upgradeId), Math.max(0, job.completesAt - this.clock.now()), {
      label: 'upgrade',
      startedAt: job.startedAt,
      completesAt: job.completesAt,
      onComplete: () => this.completeNow(upgradeId, 'upgrade.timer'),
    });
  }

  /** Applies an upgrade's effects exactly once and announces the completion. */
  private applyCompletion(
    upgradeId: UpgradeId,
    reason: string,
    options: { preserveIncomeAnchor?: boolean } = {},
  ): boolean {
    const definition = this.content.tryGetUpgrade(upgradeId);
    if (!definition) return false;

    const hadJob = Boolean(this.state.upgrades.active[upgradeId]);
    delete this.state.upgrades.active[upgradeId];
    this.timers.cancel(timerKeys.upgrade(upgradeId));

    if (!this.state.upgrades.completed.includes(upgradeId)) {
      this.state.upgrades.completed.push(upgradeId);
    }

    // Effects are content-driven: the tier and visual state come from the definition.
    this.buildings.applyTier(definition.targetBuildingId, definition.tier, `upgrade:${upgradeId}`, {
      preserveIncomeAnchor: options.preserveIncomeAnchor,
    });

    // `unlocks` may name buildings or (later) features. Anything the runtime does not
    // recognise is reported instead of silently ignored.
    for (const unlockId of definition.unlocks) {
      if (this.content.tryGetBuilding(unlockId as BuildingId)) {
        this.buildings.unlock(unlockId as BuildingId, `upgrade:${upgradeId}`);
      } else {
        logger.debug('upgrade', `unlock "${unlockId}" is not a building in this build`);
      }
    }

    this.buildings.refreshUnlocks(`upgrade:${upgradeId}`);

    this.events.emit('upgrade:completed', {
      upgradeId,
      buildingId: definition.targetBuildingId,
      tier: definition.tier,
    });
    logger.debug('upgrade', `completed ${upgradeId}`, { reason, hadJob });
    return true;
  }
}

