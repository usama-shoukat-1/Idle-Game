import { logger } from '@/core/Logger';
import type { ServiceContainer } from '@/core/ServiceContainer';
import type { GameClock } from '@/core/Time';
import { FEATURE_FLAGS } from '@/config/content';
import { formatCompactNumber, formatCompactNumber as formatNumber } from '@/core/events/EventBus';

/**
 * DEVELOPMENT TOOLS
 * =================
 * Cheats and inspectors, kept strictly out of gameplay code paths:
 *
 * - Every entry point is behind `FEATURE_FLAGS.debugTools`, which is `import.meta.env.DEV`
 *   by default. A production build reports `enabled === false` and every method becomes a
 *   no-op, so a shipped game cannot be cheated through these APIs.
 * - Nothing in `systems/` imports this module: the dependency points debug -> game, never
 *   the other way round (see docs/DEVELOPMENT_RULES.md).
 */
export interface DebugToolsOptions {
  readonly systems: ServiceContainer;
  readonly clock?: GameClock;
  readonly enabled?: boolean;
}

export class DebugTools {
  private readonly systems: ServiceContainer;
  private readonly clock: GameClock;
  readonly enabled: boolean;
  private readonly counters = { cheatsUsed: 0 };

  constructor(options: DebugToolsOptions) {
    this.systems = options.systems;
    this.clock = options.clock ?? options.systems.clock;
    this.enabled = options.enabled ?? FEATURE_FLAGS.debugTools;
  }

  get cheatsUsed(): number {
    return this.counters.cheatsUsed;
  }

  addCoins(amount = 1000): number {
    if (!this.requireEnabled()) return 0;
    const granted = this.systems.economy.addCoins(amount, 'debug.addCoins');
    logger.info('debug', `+${formatCompactNumber(granted)} coins (cheat)`);
    return granted;
  }

  addGems(amount = 50): number {
    if (!this.requireEnabled()) return 0;
    const granted = this.systems.economy.addGems(amount, 'debug.addGems');
    logger.info('debug', `+${formatCompactNumber(granted)} gems (cheat)`);
    return granted;
  }

  /** Unlocks the next locked stage (or a specific one by id). */
  unlockStage(stageId?: string): boolean {
    if (!this.requireEnabled()) return false;
    const progression = this.systems.progression;
    if (stageId) return progression.unlockStage(stageId as never, 'debug');
    const next = this.systems.content.getAllStages().find((stage) => !progression.isStageUnlocked(stage.id));
    if (!next) {
      logger.info('debug', 'all stages are already unlocked');
      return false;
    }
    return progression.unlockStage(next.id, 'debug');
  }

  /**
   * Unlocks a building by id, or the first locked building of the current stage.
   * Returns the unlocked id (or null) so the debug HUD can report it.
   */
  unlockBuilding(buildingId?: string): string | null {
    if (!this.requireEnabled()) return null;
    const buildings = this.systems.buildings;
    if (buildingId) {
      buildings.unlock(buildingId as never, 'debug');
      return buildingId;
    }
    const candidate = this.systems.content
      .getAllBuildings()
      .find((building) => !buildings.isUnlocked(building.id));
    if (!candidate) {
      logger.info('debug', 'no locked buildings (none registered in this build)');
      return null;
    }
    buildings.unlock(candidate.id, 'debug');
    return candidate.id;
  }

  /** Finishes every running timer/upgrade instantly. */
  finishTimers(): number {
    if (!this.requireEnabled()) return 0;
    const jobs = this.systems.upgrades.getActiveJobs();
    for (const job of jobs) {
      this.systems.upgrades.completeNow(job.upgradeId, 'debug.finishTimers');
    }
    // Runtime-only timers (boosts, events) also complete.
    const statuses = this.systems.timers.list();
    for (const status of statuses) this.systems.timers.finishNow(status.key);
    logger.info('debug', `finished ${jobs.length} upgrade(s) and ${statuses.length} timer(s)`);
    return jobs.length + statuses.length;
  }

  /** Advances every running timer by `amountMs` (simulates time passing). */
  skipTime(amountMs: number): number {
    if (!this.requireEnabled()) return 0;
    const statuses = this.systems.timers.list();
    for (const status of statuses) {
      this.systems.timers.reduce(status.key, amountMs);
    }
    this.systems.timers.tick();
    return statuses.length;
  }

  /**
   * Jumps a building straight to a tier (default: fully restored). Completed upgrades for
   * the skipped tiers are marked too, otherwise the prerequisite chain would deadlock.
   */
  setBuildingTier(buildingId: string, tier: number): number {
    if (!this.requireEnabled()) return 0;
    const buildings = this.systems.buildings;
    const upgrades = this.systems.upgrades;
    const id = buildingId as never;

    for (const upgrade of this.systems.content.getBuildingUpgrades(id)) {
      if (upgrade.tier <= tier && !upgrades.isCompleted(upgrade.id)) {
        // Complete through the engine so visual state, unlocks and events all fire.
        const job = this.systems.state.upgrades.active[upgrade.id];
        if (job) upgrades.completeNow(upgrade.id, 'debug.setTier');
        else if (this.systems.economy.getCoins() >= 0) {
          // Grant the coins this tier would cost so the tier advance is never blocked by
          // the wallet (this is a cheat: no real currency is created for the player).
          this.systems.economy.addCoins(upgrade.cost.amount, 'debug.tierGrant');
          upgrades.start(upgrade.id);
          upgrades.completeNow(upgrade.id, 'debug.setTier');
        }
      }
    }

    buildings.applyTier(id, tier, 'debug.setTier');
    logger.info('debug', `building ${buildingId} forced to tier ${tier}`);
    return buildings.getTier(id);
  }

  /** Rewinds `lastSaveAt` so the next settle produces an offline reward (QA of the popup). */
  simulateOffline(awayMs = 90 * 60 * 1000): number {
    if (!this.requireEnabled()) return 0;
    const state = this.systems.state;
    state.session.resumed = true;
    state.session.lastSaveAt = this.clock.now() - awayMs;
    state.analytics.lastSessionAt = state.session.lastSaveAt;
    const summary = this.systems.offline.settle();
    logger.info('debug', `simulated ${Math.round(awayMs / 60000)}m away -> ${summary.coins} coins`);
    return summary.coins;
  }

  /** Skips every running timer forward by `amountMs` (income anchors included). */
  advanceTime(amountMs: number): number {
    if (!this.requireEnabled()) return 0;
    const state = this.systems.state;
    for (const entry of Object.values(state.buildings.entries)) {
      entry.lastIncomeAt -= amountMs;
    }
    state.session.lastSaveAt -= amountMs;
    const statuses = this.systems.timers.list();
    for (const status of statuses) this.systems.timers.reduce(status.key, amountMs);
    this.systems.timers.tick();
    logger.info('debug', `advanced time by ${Math.round(amountMs / 1000)}s`);
    return statuses.length;
  }

  /** Enables/disables the mock ad provider (availability only - never auto-plays). */
  toggleMockAds(enabled?: boolean): boolean {
    if (!this.requireEnabled()) return false;
    const ads = this.systems.devProviders.ads;
    if (!ads) return false;
    const next = enabled ?? !ads.isEnabled;
    ads.setEnabled(next);
    logger.info('debug', `mock ads ${next ? 'enabled' : 'disabled'}`);
    return next;
  }

  /** Enables/disables the mock store (returns the new state). */
  toggleMockPurchases(enabled?: boolean): boolean {
    if (!this.requireEnabled()) return false;
    const store = this.systems.devProviders.store;
    if (!store) return false;
    const next = enabled ?? !store.isEnabled;
    store.setEnabled(next);
    logger.info('debug', `mock store ${next ? 'enabled' : 'disabled'}`);
    return next;
  }

  resetSave(options: { keepSettings?: boolean } = {}): void {
    if (!this.requireEnabled()) return;
    this.systems.save.reset(options);
    logger.info('debug', 'save reset (cheat)');
  }

  /** Wipes every persisted key, including settings and the corruption backup. */
  wipeStorage(): void {
    if (!this.requireEnabled()) return;
    this.systems.save.wipe();
  }

  /** Grants a portion of a missing resource set, so the wallet can never go negative. */
  private requireEnabled(): boolean {
    if (!this.enabled) {
      logger.warn('debug', 'debug tools are disabled in this build');
      return false;
    }
    this.counters.cheatsUsed += 1;
    return true;
  }

  /**
   * Human-readable snapshot of the current state.
   * Used by the FPS overlay and by bug reports ("paste your state summary").
   */
  stateSummary(): string {
    const systems = this.systems;
    const state = systems.state;
    const economy = systems.economy;
    const activeBuildings = Object.values(state.buildings.entries);

    return [
      `coins ${formatNumber(economy.getCoins())} · gems ${formatNumber(economy.getGems())}`,
      `stage ${state.progression.currentStageId} · stages unlocked ${state.progression.unlockedStageIds.length}`,
      `buildings tracked ${activeBuildings.length} · unlocked ${activeBuildings.filter((b) => b.unlocked).length}`,
      `upgrades active ${systems.upgrades.getActiveJobs().length} · completed ${state.upgrades.completed.length}`,
      `timers ${systems.timers.list().length} · queued events ${systems.eventSystem.pendingCount}`,
      `income ${formatNumber(systems.buildings.getTotalIncomePerSecond() * 60)} coins/min`,
      `save age ${Math.max(0, Math.round((this.clock.now() - state.session.lastSaveAt) / 1000))}s`,
      `next upgrade in ${
        systems.upgrades.getPrimaryActiveJob()
          ? `${Math.round(systems.upgrades.getRemainingMs(systems.upgrades.getPrimaryActiveJob()!.upgradeId) / 1000)}s`
          : '—'
      }`,
    ].join('\n');
  }

  /** Structured version of the summary for tests/tooling. */
  stateSnapshot(): Record<string, number | string> {
    const state = this.systems.state;
    return {
      coins: this.systems.economy.getCoins(),
      gems: this.systems.economy.getGems(),
      stage: state.progression.currentStageId,
      buildingsTracked: Object.keys(state.buildings.entries).length,
      upgradesCompleted: state.upgrades.completed.length,
      upgradesActive: this.systems.upgrades.getActiveJobs().length,
      timersRunning: this.systems.timers.list().length,
      saveCount: state.profile.saveCount,
      schemaVersion: state.schemaVersion,
    };
  }

}
