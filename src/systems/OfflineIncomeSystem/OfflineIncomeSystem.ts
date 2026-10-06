import { logger } from '@/core/Logger';
import type { GameClock } from '@/core/Time';
import type { ContentRegistry } from '@/core/content/ContentRegistry';
import type { EventBus } from '@/core/events/EventBus';
import type { GameState, OfflineBreakdownEntry, PendingOfflineReward } from '@/core/types/state';
import type { BuildingId } from '@/core/types/primitives';
import { computeElapsedMs, isPlausibleTimestamp } from '@/core/utils/TimeUtils';
import { clamp } from '@/core/utils/NumberUtils';
import type { BuildingSystem } from '@/systems/BuildingSystem/BuildingSystem';
import type { EconomySystem } from '@/systems/EconomySystem/EconomySystem';

/**
 * OFFLINE PROGRESSION
 * ===================
 * The player is away for minutes, hours or days. This system turns the gap between the
 * last save and the current load into a single, auditable reward:
 *
 *   lastSessionTime -> currentTime -> elapsedTime -> offlineRewardCalculation -> collect
 *
 * Phase 1 change: the reward is no longer granted during load. It is *calculated* and
 * stored as a pending reward (`state.offline.pending`), so the player can be shown an
 * opt-in summary popup with COLLECT / WATCH AD -> 2x REWARD. Because the pending reward
 * is part of the save and is cleared on collection, the same offline interval can never
 * pay out twice - not even if the player reloads mid-popup.
 *
 * Guard rails (all unit tested):
 * - a device clock that moved *backwards* yields 0 elapsed, never negative income;
 * - a corrupted or far-future `lastSaveAt` is rejected outright;
 * - elapsed time is clamped by the content-defined maximum offline window;
 * - income anchors are advanced when the reward is calculated (not when it is
 *   collected), so live income and offline income can never double-count the same span;
 * - the payout goes through EconomySystem with a distinct reason tag;
 * - the rate uses the same income maths as live play (`BuildingSystem`).
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
    private readonly economy: EconomySystem,
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

  /** The reward waiting to be collected, or null. */
  getPending(): PendingOfflineReward | null {
    return this.state.offline.pending ?? null;
  }

  hasPending(): boolean {
    const pending = this.state.offline.pending;
    return Boolean(pending && pending.coins > 0);
  }

  /** Computes (but does not store or grant) the offline reward - used for preview UIs. */
  preview(): OfflineSummary {
    return this.calculate();
  }

  /**
   * Calculates the offline reward for this session, stores it as pending and advances the
   * income anchors. Safe to call repeatedly: the second call sees a fresh anchor.
   */
  settle(): OfflineSummary {
    const summary = this.calculate();

    if (summary.skipped) {
      // Nothing to pay: still move the anchors so a later settle cannot re-count the gap.
      if (summary.skipReason !== 'fresh-session') this.advanceAnchors();
      return summary;
    }

    // Advance anchors BEFORE storing the reward: the time span has now been accounted
    // for, so live income resumes from "now" and cannot pay for it again.
    this.advanceAnchors();

    const pending: PendingOfflineReward = {
      coins: summary.coins,
      elapsedMs: summary.elapsedMs,
      effectiveElapsedMs: summary.effectiveElapsedMs,
      capped: summary.capped,
      computedAt: summary.settledAt,
      anchorAt: summary.lastSessionAt,
      perBuilding: summary.perBuilding.map((entry) => ({
        buildingId: entry.buildingId,
        coins: entry.coins,
        elapsedMs: entry.elapsedMs,
      })),
      boosted: false,
    };

    if (pending.coins > 0) {
      // A previous window can still be uncollected here - the player reloaded (or the OS
      // killed the tab) while the summary popup was open. Merging instead of overwriting is
      // what makes that safe: the earlier reward is never lost, and because the anchors were
      // already advanced the two windows cannot overlap, so nothing is paid twice.
      const previous = this.state.offline.pending;
      const merged: PendingOfflineReward =
        previous && previous.coins > 0
          ? {
              ...previous,
              coins: previous.coins + pending.coins,
              elapsedMs: previous.elapsedMs + pending.elapsedMs,
              effectiveElapsedMs: previous.effectiveElapsedMs + pending.effectiveElapsedMs,
              capped: previous.capped || pending.capped,
              computedAt: pending.computedAt,
              perBuilding: mergeBreakdown(previous.perBuilding, pending.perBuilding),
            }
          : pending;

      this.state.offline.pending = merged;
      if (previous && previous.coins > 0) {
        logger.info(
          'offline',
          `merged an additional ${pending.coins} coins into the uncollected offline reward (${merged.coins} total)`,
        );
      }
      this.events.emit('offline:summary-ready', {
        elapsedMs: merged.effectiveElapsedMs,
        coins: merged.coins,
        cappedAtMs: summary.capMs,
      });
      logger.info(
        'offline',
        `offline reward ready: ${pending.coins} coins over ${Math.round(pending.effectiveElapsedMs / 1000)}s`,
      );
    } else {
      this.state.offline.pending = null;
      logger.debug('offline', 'offline window produced no payout');
    }

    return summary;
  }

  /**
   * Doubles the pending reward once (rewarded ad). Returns the new pending reward, or
   * null when there is nothing to boost. Idempotent: a second call is a no-op.
   */
  applyOfflineBoost(): PendingOfflineReward | null {
    const pending = this.state.offline.pending;
    if (!pending || pending.coins <= 0) return null;
    if (pending.boosted) return pending;

    const boosted: PendingOfflineReward = {
      ...pending,
      coins: pending.coins * 2,
      boosted: true,
    };
    this.state.offline.pending = boosted;
    logger.info('offline', `offline reward doubled to ${boosted.coins} coins (rewarded ad)`);
    return boosted;
  }

  /**
   * Grants the pending reward through the EconomySystem and clears it.
   * @returns the coins actually granted (0 when there was nothing pending).
   */
  collect(reason = 'offline.collect'): number {
    const pending = this.state.offline.pending;
    if (!pending || pending.coins <= 0) return 0;

    // Clear first: if the economy throws or the game dies mid-collect, the reward is
    // gone rather than payable twice (losing a reward is recoverable, duplicating it is not).
    this.state.offline.pending = null;
    this.state.offline.lastCollectedAt = this.clock.now();

    const granted = this.economy.addCoins(pending.coins, reason);
    this.events.emit('offline:collected', {
      coins: granted,
      baseCoins: pending.boosted ? Math.floor(pending.coins / 2) : pending.coins,
      doubled: pending.boosted,
      elapsedMs: pending.effectiveElapsedMs,
    });
    logger.info('offline', `collected ${granted} coins`);
    return granted;
  }

  /** Drops the pending reward without paying (debug tooling / new game). */
  discardPending(): void {
    this.state.offline.pending = null;
  }

  // --- calculation ---------------------------------------------------------

  private calculate(): OfflineSummary {
    const balance = this.content.getEconomyBalance();
    const now = this.clock.now();
    const capMs = balance.offline.maxDurationMs;

    const base: Omit<
      OfflineSummary,
      | 'skipped'
      | 'skipReason'
      | 'coins'
      | 'perBuilding'
      | 'effectiveElapsedMs'
      | 'elapsedMs'
      | 'capped'
      | 'lastSessionAt'
    > = {
      settledAt: now,
      capMs,
      efficiency: clamp(balance.offline.efficiency, 0, 1),
    };

    const skip = (reason: OfflineSkipReason, lastSessionAt: number | null): OfflineSummary => {
      logger.debug('offline', `no offline payout (${reason})`);
      return {
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
    };

    if (!this.state.session.resumed) return skip('fresh-session', null);

    const anchor = this.getLastSessionAt();
    if (anchor === null) return skip('no-anchor', null);

    // A timestamp in the future beyond tolerance means a tampered or broken save.
    if (anchor > now) {
      logger.warn('offline', 'last session timestamp is in the future; ignoring offline progress');
      return skip('clock-backwards', anchor);
    }

    const elapsedMs = computeElapsedMs(anchor, now, capMs);
    const capped = now - anchor > capMs;

    if (elapsedMs < balance.offline.minimumDurationMs) return skip('too-short', anchor);
    if (base.efficiency <= 0) return skip('zero-efficiency', anchor);

    // Dry run: nothing is mutated here (the anchor advance happens in `settle()`), and the
    // rate is the live rate - which already includes any active boost multiplier.
    const accrual = this.buildings.accrueAll({
      efficiency: base.efficiency,
      maxElapsedMs: capMs,
      reason: 'offline.income',
      dryRun: true,
    });

    return {
      ...base,
      lastSessionAt: anchor,
      elapsedMs: now - anchor,
      effectiveElapsedMs: elapsedMs,
      coins: accrual.totalCoins,
      perBuilding: accrual.perBuilding,
      capped,
      skipped: false,
    };
  }

  /** Moves income anchors to "now" without paying out (the span is already accounted). */
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

/** Sums two per-building breakdowns by building id (used when pending rewards merge). */
function mergeBreakdown(
  first: readonly OfflineBreakdownEntry[],
  second: readonly OfflineBreakdownEntry[],
): readonly OfflineBreakdownEntry[] {
  const merged = new Map<BuildingId, { coins: number; elapsedMs: number }>();
  for (const entry of [...first, ...second]) {
    const current = merged.get(entry.buildingId) ?? { coins: 0, elapsedMs: 0 };
    merged.set(entry.buildingId, {
      coins: current.coins + entry.coins,
      elapsedMs: current.elapsedMs + entry.elapsedMs,
    });
  }
  return [...merged.entries()].map(([buildingId, value]) => ({
    buildingId,
    coins: value.coins,
    elapsedMs: value.elapsedMs,
  }));
}
