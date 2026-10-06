/**
 * Applies `RewardGrant`s from any source (rewarded ads, purchases, events,
 * future daily bonuses) through the owning systems. Having exactly one applier
 * means "watch an ad for a boost" and "buy a boost" cannot drift apart.
 */

import type { Clock } from '@/core/Clock';
import type { RewardContext, RewardGrant } from '@/core/types/monetization';
import type { GameStateStore } from '@/core/state/GameStateStore';
import { createLogger } from '@/core/utils/logger';
import { roundCurrency } from '@/core/utils/numbers';
import { sanitizeDuration } from '@/core/utils/time';
import type { GameEventBus } from '@/systems/EventSystem';
import type { EconomySystem } from '@/systems/EconomySystem/EconomySystem';
import type { TimerSystem } from '@/systems/TimerSystem/TimerSystem';

export interface RewardDispatcherDeps {
  store: GameStateStore;
  events: GameEventBus;
  clock: Clock;
  economy: EconomySystem;
  timers: TimerSystem;
}

export interface AppliedReward {
  grant: RewardGrant;
  applied: boolean;
  detail?: string;
}

export class RewardDispatcher {
  private readonly log = createLogger('rewards');

  constructor(private readonly deps: RewardDispatcherDeps) {}

  /** Applies grants in order and emits one `reward:granted` event per success. */
  apply(grants: readonly RewardGrant[], source: string, context?: RewardContext): AppliedReward[] {
    const at = context?.now ?? this.deps.clock.now();
    const results: AppliedReward[] = [];

    for (const grant of grants) {
      const result = this.applyGrant(grant, source, at, context);
      results.push(result);
      if (result.applied) {
        this.deps.events.emit('reward:granted', { grant, source, at });
      }
    }

    return results;
  }

  private applyGrant(
    grant: RewardGrant,
    source: string,
    at: number,
    context?: RewardContext,
  ): AppliedReward {
    const amount = Number(grant.amount ?? 0);

    switch (grant.kind) {
      case 'coins': {
        if (!Number.isFinite(amount) || amount <= 0) return { grant, applied: false, detail: 'invalid-amount' };
        const result = this.deps.economy.add('coins', amount, `reward:${source}`);
        return { grant, applied: result.ok, detail: result.message };
      }
      case 'gems': {
        if (!Number.isFinite(amount) || amount <= 0) return { grant, applied: false, detail: 'invalid-amount' };
        const result = this.deps.economy.add('gems', amount, `reward:${source}`);
        return { grant, applied: result.ok, detail: result.message };
      }
      case 'timer-reduction': {
        const targetId = grant.targetId ?? context?.resolveTimerId?.(grant) ?? this.findNearestTimer();
        if (!targetId) return { grant, applied: false, detail: 'no-running-timer' };
        const updated = this.deps.timers.reduceTime(targetId, sanitizeDuration(amount, 0));
        return { grant, applied: Boolean(updated), detail: updated ? `reduced ${targetId}` : 'timer-not-reducible' };
      }
      case 'income-boost':
      case 'offline-enhance': {
        const kind = grant.kind === 'income-boost' ? 'income-multiplier' : 'offline-efficiency';
        const multiplier = Number.isFinite(amount) && amount > 0 ? amount : 1;
        const durationMs = sanitizeDuration(grant.durationMs ?? 0, 0);
        if (multiplier <= 1 && kind === 'income-multiplier') {
          return { grant, applied: false, detail: 'no-op-multiplier' };
        }
        if (durationMs <= 0) return { grant, applied: false, detail: 'invalid-duration' };

        this.deps.store.update((state) => {
          state.boosts.push({
            id: `${source}:${kind}:${at}`,
            kind,
            multiplier: kind === 'offline-efficiency' ? Math.max(0, Math.min(1, multiplier)) : multiplier,
            ...(grant.targetId ? { targetId: grant.targetId } : {}),
            startedAt: at,
            endsAt: at + durationMs,
            source,
          });
        }, at);
        return { grant, applied: true, detail: `${kind} x${multiplier} for ${durationMs}ms` };
      }
      case 'entitlement': {
        if (!grant.entitlementId) return { grant, applied: false, detail: 'missing-entitlement-id' };
        this.deps.store.update((state) => {
          state.entitlements[grant.entitlementId as string] = {
            active: true,
            purchasedAt: at,
            expiresAt: grant.durationMs ? at + sanitizeDuration(grant.durationMs, 0) : null,
          };
        }, at);
        return { grant, applied: true, detail: `entitlement ${grant.entitlementId}` };
      }
      case 'flag': {
        if (!grant.targetId) return { grant, applied: false, detail: 'missing-flag-id' };
        this.deps.store.update((state) => {
          state.flags[grant.targetId as string] = roundCurrency(amount) || true;
        }, at);
        return { grant, applied: true, detail: `flag ${grant.targetId}` };
      }
      default:
        this.log.warn(`unknown reward kind in grant from ${source}`, grant);
        return { grant, applied: false, detail: 'unknown-kind' };
    }
  }

  /**
   * Default timer target: the running upgrade/timer that has the most time left,
   * which is the most valuable one for the player.
   */
  private findNearestTimer(): string | undefined {
    const running = this.deps.timers.getAll('running');
    if (running.length === 0) return undefined;
    return running.reduce((slowest, timer) => (timer.endsAt > slowest.endsAt ? timer : slowest)).id;
  }
}
