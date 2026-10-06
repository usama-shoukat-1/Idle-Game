/**
 * Offline progression foundation.
 *
 * The system relies on a single reliable anchor: `timestamps.lastSessionTime`,
 * written on every save. On load it:
 *   1. completes/advances every timestamp-based timer (they never drift),
 *   2. estimates coins per building from the same income pipeline used in-session,
 *   3. applies the (untuned, config-driven) efficiency + cap,
 *   4. hands a report to the UI, which decides whether to present it.
 *
 * Invalid timestamps (negative, NaN, absurd future values) are sanitized by
 * `computeElapsed` and produce an empty 0ms window rather than a bogus payout.
 */

import type { Clock } from '@/core/Clock';
import type { EconomyBalanceDefinition } from '@/core/types/content';
import type { BuildingId, TimerId } from '@/core/types/ids';
import type { GameStateStore } from '@/core/state/GameStateStore';
import type { OfflineBuildingIncome, OfflineReport } from '@/core/types/offline';
import { createLogger } from '@/core/utils/logger';
import { roundCurrency } from '@/core/utils/numbers';
import { computeElapsed, sanitizeTimestamp } from '@/core/utils/time';
import type { GameEventBus } from '@/systems/EventSystem';
import type { BuildingSystem } from '@/systems/BuildingSystem/BuildingSystem';
import type { ContentRegistry } from '@/systems/ContentSystem/ContentRegistry';
import type { EconomySystem } from '@/systems/EconomySystem/EconomySystem';
import type { TimerSystem } from '@/systems/TimerSystem/TimerSystem';

export interface OfflineIncomeDeps {
  store: GameStateStore;
  events: GameEventBus;
  clock: Clock;
  content: ContentRegistry;
  buildings: BuildingSystem;
  economy: EconomySystem;
  timers: TimerSystem;
  balance: EconomyBalanceDefinition;
}

export class OfflineIncomeSystem {
  private readonly log = createLogger('offline');
  private lastReport: OfflineReport | null = null;

  constructor(private readonly deps: OfflineIncomeDeps) {}

  get lastComputedReport(): OfflineReport | null {
    return this.lastReport;
  }

  /**
   * Advance timers to `at`, completing those that finished while away and
   * emitting their normal completion events. Safe to call on every load.
   */
  syncTimers(at = this.deps.clock.now()): TimerId[] {
    const running = this.deps.timers.getAll('running');
    const due: TimerId[] = [];
    for (const timer of running) {
      if (timer.endsAt <= at) due.push(timer.id);
    }
    // `update` also emits timer:progress for the rest, which is exactly what the
    // UI needs after a reload.
    this.deps.timers.update(at);
    if (due.length > 0) this.log.info(`${due.length} timer(s) completed while away`);
    return due;
  }

  /**
   * Build an offline report without mutating state. Returns null when offline
   * progression is disabled in the balance definition.
   */
  computeReport(at = this.deps.clock.now()): OfflineReport | null {
    const { store, balance, buildings } = this.deps;

    if (!balance.offline.enabled) return null;

    const capacityBonus = Number(store.state.flags['offline:capacity-bonus-ms'] ?? 0);
    const maxOfflineMs = Math.max(0, balance.offline.maxOfflineMs + (Number.isFinite(capacityBonus) ? capacityBonus : 0));

    const elapsed = computeElapsed(store.state.timestamps.lastSessionTime, at, { maxMs: maxOfflineMs });
    const efficiency = this.resolveEfficiency(store.state.boosts, at);

    const perBuilding: OfflineBuildingIncome[] = [];
    let grossCoins = 0;
    let creditedCoins = 0;

    if (elapsed.cappedMs > 0) {
      for (const definition of this.deps.content.listBuildings()) {
        const building = store.state.buildings[definition.id];
        if (!building?.unlocked) continue;

        const incomePerSecond = buildings.getIncomePerSecond(definition.id, at);
        if (incomePerSecond <= 0) continue;

        const gross = roundCurrency((incomePerSecond * elapsed.cappedMs) / 1000);
        if (gross <= 0) continue;
        const credited = roundCurrency(gross * efficiency);

        perBuilding.push({
          buildingId: definition.id,
          incomePerSecond,
          creditedMs: elapsed.cappedMs,
          grossCoins: gross,
          creditedCoins: credited,
        });
        grossCoins = roundCurrency(grossCoins + gross);
        creditedCoins = roundCurrency(creditedCoins + credited);
      }
    }

    const { completedTimerIds, advancedTimerIds } = this.classifyTimers(at);

    const report: OfflineReport = {
      elapsed,
      grossCoins,
      creditedCoins,
      efficiency,
      perBuilding,
      completedTimerIds,
      advancedTimerIds,
      computedAt: at,
      claimed: false,
    };

    this.lastReport = report;
    this.deps.store.update((state) => {
      state.timestamps.lastOfflineComputedAt = at;
    }, at);

    this.deps.events.emit('offline:computed', { report });
    this.log.debug(
      `offline window=${Math.round(elapsed.elapsedMs / 1000)}s capped=${Math.round(elapsed.cappedMs / 1000)}s owed=${creditedCoins}`,
    );
    return report;
  }

  /** True when the report is long enough / valuable enough to show the player. */
  shouldPresent(report: OfflineReport): boolean {
    const threshold = Math.max(0, this.deps.balance.offline.minElapsedMs);
    if (report.elapsed.wasInvalid) return false;
    if (report.elapsed.cappedMs < threshold) return false;
    return report.creditedCoins > 0 || report.completedTimerIds.length > 0;
  }

  /** Credit the report's coins and move the anchors forward. */
  claim(report: OfflineReport, at = this.deps.clock.now()): OfflineReport {
    if (report.claimed) return report;

    if (report.creditedCoins > 0) {
      const result = this.deps.economy.add('coins', report.creditedCoins, 'offline:income');
      if (!result.ok) this.log.warn(`offline credit rejected: ${result.message}`);
    }

    this.deps.store.update((state) => {
      state.timestamps.lastSessionTime = at;
      state.timestamps.lastOfflineClaimedAt = at;
      state.stats.offlineRewardsClaimed += 1;
      for (const entry of report.perBuilding) {
        const building = state.buildings[entry.buildingId];
        if (building) {
          building.lastIncomeAt = at;
          building.lifetimeEarned = roundCurrency(building.lifetimeEarned + entry.creditedCoins);
        }
      }
    }, at);

    this.deps.timers.update(at);

    const claimed: OfflineReport = { ...report, claimed: true };
    this.lastReport = claimed;
    this.deps.events.emit('offline:claimed', { report: claimed });
    this.log.info(`offline reward claimed: ${claimed.creditedCoins} coins`);
    return claimed;
  }

  /**
   * Discard the elapsed window without rewarding it (below-threshold windows, or
   * offline progression disabled). Anchors still move so time is never credited
   * twice later.
   */
  absorb(at = this.deps.clock.now()): void {
    this.deps.store.update((state) => {
      state.timestamps.lastSessionTime = at;
      for (const building of Object.values(state.buildings)) building.lastIncomeAt = at;
    }, at);
    this.deps.timers.update(at);
    this.lastReport = null;
  }

  /**
   * Write the "session ended" anchor. Called on every save (autosave, hide,
   * shutdown) so the next load has a trustworthy timestamp.
   */
  anchor(at = this.deps.clock.now()): void {
    const sessionMs = Math.max(0, at - this.deps.store.state.timestamps.sessionStartedAt);
    this.deps.store.update((state) => {
      state.timestamps.lastSessionTime = sanitizeTimestamp(at, state.timestamps.lastSessionTime);
      state.stats.playTimeMs = roundCurrency(state.stats.playTimeMs + Math.min(sessionMs, 60 * 60 * 1000));
      state.timestamps.sessionStartedAt = at;
    }, at);
  }

  private resolveEfficiency(boosts: readonly { kind: string; multiplier: number; endsAt: number }[], at: number): number {
    const { offline } = this.deps.balance;
    const active = boosts.filter((boost) => boost.kind === 'offline-efficiency' && boost.endsAt > at);
    if (active.length === 0) return offline.efficiency;
    return Math.max(offline.efficiency, ...active.map((boost) => boost.multiplier));
  }

  private classifyTimers(at: number): { completedTimerIds: TimerId[]; advancedTimerIds: TimerId[] } {
    const completedTimerIds: TimerId[] = [];
    const advancedTimerIds: TimerId[] = [];
    for (const timer of this.deps.timers.getAll('running')) {
      if (timer.endsAt <= at) completedTimerIds.push(timer.id);
      else advancedTimerIds.push(timer.id);
    }
    return { completedTimerIds, advancedTimerIds };
  }

  /** Debug/QA helper: preview the report in a compact form. */
  summarize(report: OfflineReport | null): string {
    if (!report) return 'offline: disabled';
    const seconds = Math.round(report.elapsed.cappedMs / 1000);
    return `offline: ${seconds}s, owed ${report.creditedCoins} coins @ ${Math.round(report.efficiency * 100)}%`;
  }

  /** Building ids that contributed, for the future offline popup layout. */
  contributors(report: OfflineReport): BuildingId[] {
    return report.perBuilding.map((entry) => entry.buildingId);
  }
}
