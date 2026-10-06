import { logger } from '@/core/Logger';
import type { GameClock } from '@/core/Time';
import type { EventBus } from '@/core/events/EventBus';
import type { BoostKind, BoostState, GameState } from '@/core/types/state';
import { STATE_LIMITS } from '@/core/types/state';
import type { BuildingId } from '@/core/types/primitives';
import { MS_PER_MINUTE } from '@/core/types/primitives';

/**
 * TEMPORARY BOOST SYSTEM - generic by construction.
 * ================================================
 * Anything that applies a *timed multiplier* to income (a 2x rewarded-ad boost, a future
 * event bonus, a paid "double income for an hour" pack) is described by a `BoostState`
 * and owned here. Nothing in this file knows about the Old Café, ads or shops.
 *
 * Design notes:
 * - Boosts are deadline-based (`expiresAt`), like every other timer in the game, so a
 *   boost keeps ticking down while the tab is closed and simply expires without needing
 *   a running timer entry. That also makes them trivially save/load safe.
 * - Expiry is *lazy*: `prune()` is called on load and whenever the income rate is read,
 *   so there is no polling loop and a suspended tab costs nothing.
 * - Foreign keys are optional: a boost may target one building or (as with ads today)
 *   apply to every building.
 */
export interface BoostRequest {
  readonly id: string;
  readonly kind: BoostKind;
  /** Effect strength: 2 for "2x income". */
  readonly amount: number;
  readonly durationMs: number;
  /** Origin tag for analytics: 'ads' | 'debug' | 'content'. */
  readonly source: string;
  readonly label: string;
  /** Optional single-building target. Omitted === all buildings. */
  readonly buildingId?: BuildingId;
}

export interface ActiveBoostView extends BoostState {
  readonly remainingMs: number;
  readonly buildingId?: BuildingId;
}

export class BoostSystem {
  constructor(
    private readonly state: GameState,
    private readonly events: EventBus,
    private readonly clock: GameClock,
  ) {
    this.prune();
  }

  /** Currently active boosts with their remaining time (UI + debug). */
  getActive(now = this.clock.now()): readonly ActiveBoostView[] {
    return this.state.boosts.active
      .filter((boost) => boost.expiresAt > now)
      .map((boost) => ({ ...boost, remainingMs: boost.expiresAt - now }));
  }

  hasActive(kind?: BoostKind, now = this.clock.now()): boolean {
    return this.state.boosts.active.some(
      (boost) => boost.expiresAt > now && (!kind || boost.kind === kind),
    );
  }

  /**
   * Multiplier applied to a building's income, combining every active boost.
   * Unknown kinds are ignored (forward compatible with future boost types).
   */
  getIncomeMultiplier(buildingId?: BuildingId, now = this.clock.now()): number {
    let multiplier = 1;
    for (const boost of this.state.boosts.active) {
      if (boost.expiresAt <= now) continue;
      if (boost.kind !== 'incomeMultiplier') continue;
      if (!appliesTo(boost, buildingId)) continue;
      if (!Number.isFinite(boost.amount) || boost.amount <= 0) continue;
      multiplier *= boost.amount;
    }
    return multiplier;
  }

  /**
   * Adds (or refreshes) a boost. Re-requesting the same id while it is running does not
   * stack indefinitely: the deadline is extended from `max(now, expiresAt)`, which is the
   * behaviour players expect from "watch again to extend".
   */
  apply(request: BoostRequest): ActiveBoostView {
    const now = this.clock.now();
    const durationMs = Math.max(0, Math.floor(request.durationMs));
    const existing = this.state.boosts.active.find((boost) => boost.id === request.id);

    if (existing) {
      const base = Math.max(now, existing.expiresAt);
      existing.expiresAt = base + durationMs;
      logger.debug('boost', `extended boost "${request.id}" by ${durationMs}ms`, {
        source: request.source,
      });
      this.events.emit('boost:applied', {
        boostId: existing.id,
        kind: existing.kind,
        amount: existing.amount,
        expiresAt: existing.expiresAt,
        source: request.source,
        extended: true,
      });
      return { ...existing, remainingMs: existing.expiresAt - now, buildingId: request.buildingId };
    }

    const boost: BoostState & { buildingId?: BuildingId } = {
      id: request.id,
      kind: request.kind,
      amount: request.amount,
      startedAt: now,
      expiresAt: now + durationMs,
      source: request.source,
      label: request.label,
      ...(request.buildingId ? { buildingId: request.buildingId } : {}),
    };

    this.state.boosts.active.push(boost);
    // Defensive cap: a corrupted or scripted caller can never grow the save without bound.
    if (this.state.boosts.active.length > STATE_LIMITS.maxActiveBoosts) {
      this.state.boosts.active.splice(0, this.state.boosts.active.length - STATE_LIMITS.maxActiveBoosts);
    }

    logger.info('boost', `boost "${boost.id}" active for ${Math.round(durationMs / MS_PER_MINUTE)}m`, {
      mult: boost.amount,
      source: request.source,
    });
    this.events.emit('boost:applied', {
      boostId: boost.id,
      kind: boost.kind,
      amount: boost.amount,
      expiresAt: boost.expiresAt,
      source: request.source,
      extended: false,
    });
    return { ...boost, remainingMs: durationMs };
  }

  /** Removes expired boosts, emitting one `boost:expired` per removal. */
  prune(now = this.clock.now()): number {
    if (!Array.isArray(this.state.boosts.active)) {
      this.state.boosts.active = [];
      return 0;
    }
    const before = this.state.boosts.active.length;
    this.state.boosts.active = this.state.boosts.active.filter((boost) => boost.expiresAt > now);
    const removed = before - this.state.boosts.active.length;
    if (removed > 0) {
      logger.debug('boost', `${removed} boost(s) expired`);
      this.events.emit('boost:expired', { count: removed });
    }
    return removed;
  }

  /** Drops a boost immediately (debug tooling / future cancellation). */
  clear(id?: string): number {
    const before = this.state.boosts.active.length;
    this.state.boosts.active = id
      ? this.state.boosts.active.filter((boost) => boost.id !== id)
      : [];
    return before - this.state.boosts.active.length;
  }
}

function appliesTo(boost: BoostState, buildingId?: BuildingId): boolean {
  const target = (boost as BoostState & { buildingId?: BuildingId }).buildingId;
  if (!target) return true;
  if (!buildingId) return false;
  return target === buildingId;
}
