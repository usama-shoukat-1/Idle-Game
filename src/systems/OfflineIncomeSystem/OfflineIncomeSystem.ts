import { logger } from '@/core/Logger';
import type { GameClock } from '@/core/Time';
import type { ContentRegistry } from '@/core/content/ContentRegistry';
import type { EventBus } from '@/core/events/EventBus';
import type { GameState } from '@/core/types/state';
import type { BuildingId } from '@/core/types/primitives';
import { computeElapsedMs, isPlausibleTimestamp } from '@/core/utils/TimeUtils';
import { clamp } from '@/core/utils/NumberUtils';
import type { BuildingSystem } from '@/systems/BuildingSystem/BuildingSystem';

/**
 * OFFLINE PROGRESSION FOUNDATION
 * ==============================
 * The player is away for minutes, hours or days. This system turns the gap between the
 * last save and the current load into a single, auditable transaction:
 *
 *   lastSessionTime -> currentTime -> elapsedTime -> offlineRewardCalculation
 *
 * Guard rails (all unit tested):
 * - a device clock that moved *backwards* yields 0 elapsed, never negative income;
 * - a corrupted or far-future `lastSaveAt` is rejected outright;
 * - elapsed time is clamped by the content-defined maximum offline window;
 * - the payout goes through EconomySystem with a distinct reason tag, so offline coins
 *   are separable from online income in analytics and in the wallet history;
 * - the actual rate uses the same income maths as live play (`BuildingSystem`), so
 *   there is no second, divergent implementation of "how much does a building earn".
 *
 * Phase 0 deliberately awards nothing: `economy.offline.efficiency` is 0 until Phase 1
 * tunes the curve. The architecture, timing and safety work regardless.
 */

export type OfflineSkipReason =
  | 'fresh-session'
  | 'no-anchor'
  | 'invalid-timestamp'
  | 'clock-backwards'
  | 'too-short'
  | 'zero-efficiency';

export interface OfflineSummary {
  readonly settledAt: number;
  readonly lastSessionAt: number;
  /** Raw elapsed time between last save and now, before clamping. */
  readonly elapsedMs: number;
  /** Elapsed time actually used for the payout (after clamping + validation). */
  readonly effectiveElapsedMs: number;
  readonly capMs: number;
  readonly efficiency: number;
  readonly coins: number;
  readonly perBuilding: ReadonlyArray<{ buildingId: BuildingId; coins: number; elapsedMs: number }>;
  readonly skipped: boolean;
  readonly skipReason?: OfflineSkipReason;
  /** True when the elapsed time hit the configured cap (UI shows "capped"). */
  readonly capped: boolean;
}

export class OfflineIncomeSystem {
  constructor(
    private readonly state: GameState,
    private readonly content: ContentRegistry,
    private readonly buildings: BuildingSystem,
    private readonly events: EventBus,
    private readonly clock: GameClock,
  ) {}

  /** True when a session should produce an offline summary at all. */
  isEligible(): boolean {
    return this.state.session.resumed;
  }

  /** Epoch ms of the last time the game was known to be running. */
  getLastSessionAt(): number | null {
    const candidates = [this.state.session.lastSaveAt, this.state.analytics.lastSessionAt];
    for (const candidate of candidates) {
      if (isPlausibleTimestamp(candidate, this.clock.now())) return candidate;
    }
    return null;
  }

  /** Computes (but does not grant) the offline reward - used for preview UIs. */
  preview(): OfflineSummary {
    return this.settle({ dryRun: true });
  }

  /**
   * Computes and grants the offline reward for this session. Safe to call more than
   * once: the second call sees a fresh anchor and settles to zero.
   */
  settle(options: { dryRun?: boolean } = {}): OfflineSummary {
    const balance = this.content.getEconomyBalance();
    const now = this.clock.now();
    const capMs = balance.offline.maxDurationMs;

    const base: Omit<OfflineSummary, 'skipped' | 'skipReason' | 'coins' | 'perBuilding' | 'effectiveElapsedMs' | 'elapsedMs' | 'capped' | 'lastSessionAt'> = {
      settledAt: now,
      capMs,
      efficiency: clamp(balance.offline.efficiency, 0, 1),
    };

    const skip = (reason: OfflineSkipReason, lastSessionAt: number | null): OfflineSummary => {
      const summary: OfflineSummary = {
        ...base,
        lastSessionAt: lastSessionAt ?? 0,
        elapsedMs: 0,
        effectiveElapsedMs: 0,
        coins: 0,
        perBuilding: [],
        capped: false,
        skipped: true,
        skipReason: reason,
      };
      logger.debug('offline', `no offline payout (${reason})`);
      return summary;
    };

    if (!this.state.session.resumed) return skip('fresh-session', null);

    const anchor = this.getLastSessionAt();
    if (anchor === null) return skip('no-anchor', null);

    // A timestamp in the future beyond tolerance means a tampered or broken save.
    if (anchor > now) {
      logger.warn('offline', 'last session timestamp is in the future; ignoring offline progress');
      this.state.analytics.lastSessionAt = now;
      return skip('clock-backwards', anchor);
    }

    const elapsedMs = computeElapsedMs(anchor, now, capMs);
    const capped = now - anchor > capMs;

    if (elapsedMs < balance.offline.minimumDurationMs) return skip('too-short', anchor);

    if (base.efficiency <= 0) {
      // Foundation behaviour: offline progress exists but pays nothing yet. Building
      // anchors are still advanced so Phase 1 can start measuring from a clean slate.
      if (!options.dryRun) this.advanceAnchors();
      return skip('zero-efficiency', anchor);
    }

    const accrual = this.buildings.accrueAll({
      efficiency: base.efficiency,
      maxElapsedMs: capMs,
      reason: 'offline.income',
      dryRun: options.dryRun,
    });

    const summary: OfflineSummary = {
      ...base,
      lastSessionAt: anchor,
      elapsedMs: now - anchor,
      effectiveElapsedMs: elapsedMs,
      coins: accrual.totalCoins,
      perBuilding: accrual.perBuilding,
      capped,
      skipped: false,
    };

    if (!options.dryRun) {
      this.state.analytics.lastSessionAt = now;
      if (summary.coins > 0) {
        this.events.emit('offline:summary-ready', {
          elapsedMs: summary.effectiveElapsedMs,
          coins: summary.coins,
          cappedAtMs: capMs,
        });
      }
    }

    logger.info('offline', `offline settlement: ${summary.coins} coins over ${Math.round(elapsedMs / 1000)}s`);
    return summary;
  }

  /** Moves income anchors to "now" without paying out (used when efficiency is 0). */
  private advanceAnchors(): void {
    const now = this.clock.now();
    for (const entry of Object.values(this.state.buildings.entries)) {
      if (!entry.unlocked) continue;
      entry.lastIncomeAt = now;
      entry.incomeProgress = 0;
    }
    this.state.analytics.lastSessionAt = now;
  }
}
