/**
 * Rewarded-ad facade.
 *
 * Owns placement cooldowns/daily limits, enforces the opt-in flow and routes the
 * reward grants through the shared dispatcher. Gameplay code asks this system for
 * a reward; it never talks to a provider directly.
 */

import type { Clock } from '@/core/Clock';
import type { AdPlacementId } from '@/core/types/ids';
import type {
  AdRewardService,
  PlacementCooldownState,
  RewardGrant,
  RewardedAdOutcome,
  RewardedAdResult,
} from '@/core/types/monetization';
import type { GameStateStore } from '@/core/state/GameStateStore';
import { createLogger } from '@/core/utils/logger';
import { dayKey } from '@/core/utils/time';
import type { GameEventBus } from '@/systems/EventSystem';
import type { ContentRegistry } from '@/systems/ContentSystem/ContentRegistry';
import type { RewardDispatcher } from './RewardDispatcher';

export interface AdRewardSystemDeps {
  store: GameStateStore;
  events: GameEventBus;
  clock: Clock;
  content: ContentRegistry;
  service: AdRewardService;
  dispatcher: RewardDispatcher;
}

export interface AdOfferResult extends RewardedAdResult {
  /** Grants that were actually applied (empty unless outcome === 'granted'). */
  appliedGrants: RewardGrant[];
}

export class AdRewardSystem {
  private readonly log = createLogger('ads');
  private inFlight: AdPlacementId | null = null;

  constructor(private readonly deps: AdRewardSystemDeps) {}

  get providerName(): string {
    return this.deps.service.providerName;
  }

  isProviderAvailable(): boolean {
    return this.deps.service.isAvailable();
  }

  listPlacements() {
    return this.deps.content.listAdPlacements();
  }

  /** Warm the provider up. Safe to call on boot. */
  preload(): Promise<void> {
    const ids = this.listPlacements().map((placement) => placement.id);
    return this.deps.service.preload(ids).catch((error: unknown) => {
      this.log.warn('ad preload failed (ignored)', error);
    });
  }

  getCooldown(placementId: AdPlacementId, at = this.deps.clock.now()): PlacementCooldownState {
    const placement = this.deps.content.getAdPlacement(placementId);
    const record = this.deps.store.state.ads.placements[placementId];
    const cooldownMs = placement?.cooldownMs ?? 0;
    const dailyLimit = placement?.maxPerDay ?? 0;

    const sameDay = record ? record.dayKey === dayKey(at) : false;
    const shownToday = sameDay ? record?.shownToday ?? 0 : 0;
    const elapsed = record ? Math.max(0, at - record.lastShownAt) : Number.POSITIVE_INFINITY;
    const remainingMs = Number.isFinite(elapsed) ? Math.max(0, cooldownMs - elapsed) : 0;

    return {
      placementId,
      remainingMs,
      shownToday,
      dailyLimitReached: dailyLimit > 0 && shownToday >= dailyLimit,
    };
  }

  canOffer(placementId: AdPlacementId, at = this.deps.clock.now()): boolean {
    const placement = this.deps.content.getAdPlacement(placementId);
    if (!placement) return false;
    if (!this.deps.service.isAvailable()) return false;
    const cooldown = this.getCooldown(placementId, at);
    return cooldown.remainingMs <= 0 && !cooldown.dailyLimitReached;
  }

  /**
   * Show a rewarded ad for a placement. MUST only be called from an explicit
   * player action (a button press). Rewarded formats are opt-in by policy.
   */
  async offer(placementId: AdPlacementId, timeoutMs = 30_000): Promise<AdOfferResult> {
    const at = this.deps.clock.now();
    const placement = this.deps.content.getAdPlacement(placementId);

    if (!placement) {
      return { placementId, outcome: 'error', message: `unknown placement "${placementId}"`, appliedGrants: [] };
    }
    if (this.inFlight) {
      return { placementId, outcome: 'error', message: `ad "${this.inFlight}" already in flight`, appliedGrants: [] };
    }
    if (!this.deps.service.isAvailable()) {
      return { placementId, outcome: 'unavailable', message: 'provider unavailable', appliedGrants: [] };
    }

    const cooldown = this.getCooldown(placementId, at);
    if (cooldown.remainingMs > 0 || cooldown.dailyLimitReached) {
      return {
        placementId,
        outcome: 'cooldown',
        message: cooldown.dailyLimitReached ? 'daily limit reached' : 'on cooldown',
        appliedGrants: [],
      };
    }

    this.inFlight = placementId;
    this.deps.events.emit('ad:offered', { placementId, at });

    try {
      const result = await this.withTimeout(this.deps.service.show(placementId), timeoutMs);
      this.deps.events.emit('ad:outcome', {
        placementId,
        outcome: result.outcome,
        ...(result.message ? { message: result.message } : {}),
      });

      if (result.outcome !== 'granted') {
        this.log.debug(`placement ${placementId} outcome=${result.outcome}`);
        return { ...result, appliedGrants: [] };
      }

      const grants = placement.grants ?? [];
      const applied = this.deps.dispatcher
        .apply(grants, `ad:${placementId}`, { now: at })
        .filter((entry) => entry.applied)
        .map((entry) => entry.grant);

      this.deps.store.update((state) => {
        const key = dayKey(at);
        const existing = state.ads.placements[placementId];
        state.ads.placements[placementId] = {
          lastShownAt: at,
          shownToday: existing && existing.dayKey === key ? existing.shownToday + 1 : 1,
          dayKey: key,
        };
        state.stats.rewardedAdsWatched += 1;
      }, at);

      return { ...result, appliedGrants: applied };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome: RewardedAdOutcome = 'error';
      this.deps.events.emit('ad:outcome', { placementId, outcome, message });
      this.log.error(`placement ${placementId} failed`, error);
      return { placementId, outcome, message, appliedGrants: [] };
    } finally {
      this.inFlight = null;
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    if (timeoutMs <= 0) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ad show timed out after ${timeoutMs}ms`)), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /** Debug hook: clear placement cooldowns so QA can re-test the flow. */
  clearCooldowns(): void {
    const at = this.deps.clock.now();
    this.deps.store.update((state) => {
      state.ads.placements = {};
    }, at);
  }
}
