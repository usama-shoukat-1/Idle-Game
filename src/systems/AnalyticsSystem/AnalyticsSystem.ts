import { DisposableBag } from '@/core/Disposable';
import { logger } from '@/core/Logger';
import type { EventBus } from '@/core/events/EventBus';
import type { AnalyticsService } from '@/core/types/services';

/**
 * ANALYTICS BRIDGE
 * ================
 * Turns *domain* events (already emitted by the systems) into normalised, provider-
 * independent analytics events. Gameplay code therefore contains no analytics calls, and
 * connecting a real provider later means implementing `AnalyticsService` - not touching a
 * single system.
 *
 * Event names follow the Phase 1 contract:
 *   building_unlocked, upgrade_started, upgrade_completed, coins_earned, coins_spent,
 *   rewarded_ad_requested, rewarded_ad_rewarded, speedup_used, offline_reward_collected,
 *   purchase_started, purchase_completed, building_completed
 *
 * The bridge is cheap: it only formats a small payload object per event, and the
 * configured `AnalyticsService` decides what to do with it (the development one counts
 * and logs at debug level).
 */
export class AnalyticsSystem {
  private readonly bag = new DisposableBag();
  private readonly counts = new Map<string, number>();
  private tracked = 0;

  constructor(
    private readonly events: EventBus,
    private readonly service: AnalyticsService,
  ) {
    const track = (name: string, props: Record<string, string | number | boolean>): void => {
      this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
      this.tracked += 1;
      this.service.track(name, props);
      this.events.emit('analytics:track', { name, props });
    };

    const subscriptions = [
      this.events.on('building:unlocked', ({ buildingId, stageId }) =>
        track('building_unlocked', { buildingId, stageId }),
      ),
      this.events.on('upgrade:started', ({ upgradeId, buildingId, completesAt }) =>
        track('upgrade_started', { upgradeId, buildingId, completesAt }),
      ),
      this.events.on('upgrade:completed', ({ upgradeId, buildingId, tier }) =>
        track('upgrade_completed', { upgradeId, buildingId, tier }),
      ),
      this.events.on('upgrade:speed-up', ({ upgradeId, source, appliedMs }) =>
        track('speedup_used', { upgradeId, source, appliedMs, seconds: Math.round(appliedMs / 1000) }),
      ),
      this.events.on('building:completed', ({ buildingId, totalCost, incomePerMinute }) =>
        track('building_completed', { buildingId, totalCost, incomePerMinute }),
      ),
      // Earned/spent are separated from generic wallet changes: an ad reward, offline
      // payout and building income are different economic events for retention analysis.
      this.events.on('economy:coins-changed', ({ delta, balance, reason }) =>
        delta >= 0
          ? track('coins_earned', { amount: delta, balance, reason })
          : track('coins_spent', { amount: -delta, balance, reason }),
      ),
      this.events.on('economy:gems-changed', ({ delta, balance, reason }) =>
        delta >= 0
          ? track('gems_earned', { amount: delta, balance, reason })
          : track('gems_spent', { amount: -delta, balance, reason }),
      ),
      this.events.on('ads:reward-requested', ({ placementId, rewardId }) =>
        track('rewarded_ad_requested', { placementId, rewardId }),
      ),
      this.events.on('ads:reward-granted', ({ placementId, rewardId, amount }) =>
        track('rewarded_ad_rewarded', { placementId, rewardId, amount }),
      ),
      this.events.on('ads:reward-failed', ({ placementId, rewardId, status }) =>
        track('rewarded_ad_failed', { placementId, rewardId, status }),
      ),
      this.events.on('offline:collected', ({ coins, baseCoins, doubled, elapsedMs }) =>
        track('offline_reward_collected', {
          coins,
          baseCoins,
          doubled,
          minutes: Math.round(elapsedMs / 60_000),
        }),
      ),
      this.events.on('purchase:started', ({ productId }) => track('purchase_started', { productId })),
      this.events.on('purchase:completed', ({ productId, currency, amount }) =>
        track('purchase_completed', { productId, currency, amount }),
      ),
      this.events.on('tutorial:completed', ({ skipped }) => track('tutorial_completed', { skipped })),
    ];

    for (const unsubscribe of subscriptions) this.bag.add(unsubscribe);
    logger.debug('analytics', `bridge ready (provider: ${service.providerName})`);
  }

  get providerName(): string {
    return this.service.providerName;
  }

  /** Number of analytics events emitted this session (debug overlay + tests). */
  get trackedCount(): number {
    return this.tracked;
  }

  /** Per-event counters, most useful first. */
  getCounts(): Readonly<Record<string, number>> {
    return Object.fromEntries([...this.counts.entries()].sort((a, b) => b[1] - a[1]));
  }

  dispose(): void {
    this.bag.dispose();
  }
}

/**
 * Development analytics provider: counts events and logs them at debug level.
 * A production provider (Firebase/GA/self-hosted) implements the same interface.
 */
export class DevelopmentAnalyticsService implements AnalyticsService {
  readonly providerName = 'development';

  track(event: string, payload?: Readonly<Record<string, string | number | boolean>>): void {
    logger.debug('analytics', event, payload ?? {});
  }
}
