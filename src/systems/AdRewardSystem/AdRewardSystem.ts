import { logger } from '@/core/Logger';
import type { GameClock } from '@/core/Time';
import type { ContentRegistry } from '@/core/content/ContentRegistry';
import type { EventBus } from '@/core/events/EventBus';
import type { RewardedRewardDefinition } from '@/core/types/content';
import type { AdAvailability, RewardedAdService } from '@/core/types/services';
import { clamp } from '@/core/utils/NumberUtils';
import type { EconomySystem } from '@/systems/EconomySystem/EconomySystem';
import type { UpgradeSystem } from '@/systems/UpgradeSystem/UpgradeSystem';

/**
 * REWARDED-AD REWARD ORCHESTRATION
 * ================================
 * This is the boundary between "the player chose to watch an ad" and "the economy
 * changed". It is deliberately the ONLY place that grants ad rewards, and it never
 * grants anything unless the provider reports a completed, rewarded view.
 *
 * Policy baked into the design (see docs/MONETIZATION_ARCHITECTURE.md):
 * - OPT-IN ONLY. The player taps a button that states the reward; nothing auto-plays,
 *   nothing interrupts gameplay, no interstitial/full-screen format is even modelled.
 * - Rewards are content (`RewardedRewardDefinition`), so amounts/cooldowns are balanced
 *   without code changes and no ad unit ids appear in source.
 * - Every attempt is logged with a reason tag for analytics (`ads.reward.*`).
 *
 * Phase 0 wiring status:
 * - `coins` / `gems`  -> fully wired to EconomySystem
 * - `timeSkip`        -> fully wired to UpgradeSystem (reduces the active job)
 * - `incomeMultiplier` / `offlineBoost` -> paths exist and fail loudly (they need the
 *   Phase 1 boost system); no shipped content uses them yet.
 */

export type AdRewardStatus =
  | 'granted'
  | 'unknown-reward'
  | 'on-cooldown'
  | 'unavailable'
  | 'not-rewarded'
  | 'not-supported'
  | 'no-target';

export interface AdRewardOutcome {
  readonly status: AdRewardStatus;
  readonly rewardId: string;
  readonly placementId: string;
  /** Amount actually applied (coins, gems, ms skipped, ...). */
  readonly applied: number;
  readonly message: string;
}

export interface AdRewardRequest {
  readonly placementId: string;
  readonly rewardId: string;
}

export class AdRewardSystem {
  private readonly lastGrantedAt = new Map<string, number>();
  private initialized = false;

  constructor(
    private readonly content: ContentRegistry,
    private readonly economy: EconomySystem,
    private readonly upgrades: UpgradeSystem,
    private readonly events: EventBus,
    private readonly clock: GameClock,
    private readonly ads: RewardedAdService,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.ads.initialize();
    this.initialized = true;
  }

  get providerName(): string {
    return this.ads.providerName;
  }

  get rewards(): readonly RewardedRewardDefinition[] {
    return this.content.getRewardedRewards();
  }

  /** Availability of the underlying ad slot for a reward (drives the button state). */
  getAvailability(placementId: string, rewardId: string): AdAvailability {
    if (!this.initialized) return 'loading';
    if (this.isOnCooldown(rewardId)) return 'cooldown';
    return this.ads.getAvailability(placementId);
  }

  isOnCooldown(rewardId: string, now = this.clock.now()): boolean {
    const reward = this.content.getRewardedReward(rewardId);
    if (!reward) return false;
    const last = this.lastGrantedAt.get(rewardId);
    if (last === undefined) return false;
    return now - last < reward.cooldownMs;
  }

  getCooldownRemainingMs(rewardId: string, now = this.clock.now()): number {
    const reward = this.content.getRewardedReward(rewardId);
    if (!reward) return 0;
    const last = this.lastGrantedAt.get(rewardId);
    if (last === undefined) return 0;
    return Math.max(0, reward.cooldownMs - (now - last));
  }

  /**
   * Shows the ad for the reward and grants it only on a confirmed view.
   * The caller must already have obtained explicit player consent (button tap).
   */
  async requestReward(request: AdRewardRequest): Promise<AdRewardOutcome> {
    const reward = this.content.getRewardedReward(request.rewardId);
    if (!reward) {
      return this.outcome('unknown-reward', request, 0, 'Unknown reward');
    }

    if (this.isOnCooldown(request.rewardId)) {
      return this.outcome(
        'on-cooldown',
        request,
        0,
        `Available again in ${Math.ceil(this.getCooldownRemainingMs(request.rewardId) / 1000)}s`,
      );
    }

    const availability = this.getAvailability(request.placementId, request.rewardId);
    if (availability !== 'available') {
      return this.outcome('unavailable', request, 0, `Ad not available (${availability})`);
    }

    await this.initialize();

    const result = await this.ads.show(request.placementId);
    if (!result.rewarded) {
      logger.info('ads', `reward not granted (${result.status})`, { rewardId: request.rewardId });
      return this.outcome('not-rewarded', request, 0, `Ad ${result.status}`);
    }

    const applied = this.applyReward(reward, request);
    return applied;
  }

  /** Directly applies a reward - used after a successful view and by debug tooling. */
  applyReward(reward: RewardedRewardDefinition, request: AdRewardRequest): AdRewardOutcome {
    switch (reward.kind) {
      case 'coins': {
        const granted = this.economy.addCoins(reward.amount, `ads.reward.${reward.id}`);
        this.markGranted(reward.id);
        this.announce(request, granted);
        return this.outcome('granted', request, granted, `+${granted} coins`);
      }
      case 'gems': {
        const granted = this.economy.addGems(reward.amount, `ads.reward.${reward.id}`);
        this.markGranted(reward.id);
        this.announce(request, granted);
        return this.outcome('granted', request, granted, `+${granted} gems`);
      }
      case 'timeSkip': {
        const job = this.upgrades.getPrimaryActiveJob();
        if (!job) {
          // Nothing running: do NOT burn the player's ad. The UI hides the button, and
          // this guard keeps a programmatic call from wasting the reward.
          return this.outcome('no-target', request, 0, 'No upgrade in progress');
        }
        const applied = this.upgrades.reduceRemaining(job.upgradeId, clamp(reward.amount, 0, Number.MAX_SAFE_INTEGER));
        this.markGranted(reward.id);
        this.announce(request, applied);
        return this.outcome('granted', request, applied, `${Math.round(applied / 1000)}s skipped`);
      }
      case 'incomeMultiplier':
      case 'offlineBoost': {
        // Requires the Phase 1 boost system. Failing loudly here is intentional: a
        // silent "granted" with no effect would be a data-integrity lie.
        logger.warn(
          'ads',
          `reward kind "${reward.kind}" is not wired up yet (expected in Phase 1); reward "${reward.id}" was not granted`,
        );
        return this.outcome('not-supported', request, 0, 'Not available yet');
      }
      default:
        return this.outcome('unknown-reward', request, 0, 'Unknown reward kind');
    }
  }

  private markGranted(rewardId: string): void {
    this.lastGrantedAt.set(rewardId, this.clock.now());
  }

  private announce(request: AdRewardRequest, amount: number): void {
    this.events.emit('ads:reward-granted', {
      placementId: request.placementId,
      rewardId: request.rewardId,
      amount,
    });
  }

  private outcome(
    status: AdRewardStatus,
    request: AdRewardRequest,
    applied: number,
    message: string,
  ): AdRewardOutcome {
    return { status, rewardId: request.rewardId, placementId: request.placementId, applied, message };
  }
}
