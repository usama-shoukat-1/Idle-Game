import { logger } from '@/core/Logger';
import type { GameClock } from '@/core/Time';
import type { ContentRegistry } from '@/core/content/ContentRegistry';
import type { EventBus } from '@/core/events/EventBus';
import type { DynamicRewardSpec, RewardedRewardDefinition } from '@/core/types/content';
import type { AdAvailability, RewardedAdService } from '@/core/types/services';
import { clamp } from '@/core/utils/NumberUtils';
import type { EconomySystem } from '@/systems/EconomySystem/EconomySystem';
import type { UpgradeSystem } from '@/systems/UpgradeSystem/UpgradeSystem';
import type { BoostSystem } from '@/systems/BoostSystem/BoostSystem';
import type { OfflineIncomeSystem } from '@/systems/OfflineIncomeSystem/OfflineIncomeSystem';

/**
 * REWARDED-AD REWARD ORCHESTRATION
 * ================================
 * The boundary between "the player chose to watch an ad" and "the economy changed". It is
 * the ONLY place that grants ad rewards, and it never grants anything unless the provider
 * reports a completed, rewarded view.
 *
 * Policy baked into the design (see docs/MONETIZATION_ARCHITECTURE.md):
 * - OPT-IN ONLY. The player taps a button that states the reward; nothing auto-plays,
 *   nothing interrupts gameplay, no interstitial format is even modelled.
 * - Rewards are content (`RewardedRewardDefinition`), so amounts/cooldowns are balanced
 *   without code changes and no ad unit ids appear in source.
 * - A reward that has no valid target is NOT consumed (e.g. a time-skip with no running
 *   upgrade returns `no-target` without burning the player's view).
 *
 * Phase 1 reward kinds, all data-driven:
 * - `coins`            -> EconomySystem (amount, optionally scaled from the next cost)
 * - `gems`             -> EconomySystem
 * - `timeSkip`         -> UpgradeSystem (percent of the remaining job, hard-capped)
 * - `incomeMultiplier` -> BoostSystem (timed 2x income boost)
 * - `offlineBoost`     -> OfflineIncomeSystem (doubles the *pending* offline reward)
 */
export type AdRewardStatus =
  | 'granted'
  | 'unknown-reward'
  | 'on-cooldown'
  | 'unavailable'
  | 'not-rewarded'
  | 'no-target';

export interface AdRewardOutcome {
  readonly status: AdRewardStatus;
  readonly rewardId: string;
  readonly placementId: string;
  /** Amount actually applied (coins, gems, ms skipped, multiplier, ...). */
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
    private readonly boosts: BoostSystem,
    private readonly offline: OfflineIncomeSystem,
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

  tryGetReward(rewardId: string): RewardedRewardDefinition | undefined {
    return this.content.getRewardedReward(rewardId);
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
   * Amount this reward would grant right now, without granting it. Used for button
   * labels ("WATCH AD → +312 COINS") so the player knows what an ad is worth *before*
   * opting in. Returns 0 when the reward has no valid target.
   */
  previewAmount(rewardId: string): number {
    const reward = this.content.getRewardedReward(rewardId);
    if (!reward) return 0;
    switch (reward.kind) {
      case 'coins':
      case 'gems':
        return Math.max(0, Math.floor(this.resolveDynamicAmount(reward) ?? reward.amount));
      case 'timeSkip': {
        const job = this.upgrades.getPrimaryActiveJob();
        if (!job) return 0;
        const applied = this.resolveTimeSkipMs(reward, this.upgrades.getRemainingMs(job.upgradeId));
        return Math.max(0, applied);
      }
      case 'incomeMultiplier':
        return reward.amount;
      case 'offlineBoost': {
        const pending = this.offline.getPending();
        if (!pending || pending.boosted) return 0;
        return pending.coins; // extra coins gained by doubling
      }
      default:
        return 0;
    }
  }

  /** True when the reward can currently be offered (target exists, not on cooldown). */
  isOffered(rewardId: string): boolean {
    const reward = this.content.getRewardedReward(rewardId);
    if (!reward) return false;
    if (this.isOnCooldown(rewardId)) return false;
    switch (reward.kind) {
      case 'timeSkip':
        return this.upgrades.getPrimaryActiveJob() !== null;
      case 'offlineBoost': {
        const pending = this.offline.getPending();
        return Boolean(pending && pending.coins > 0 && !pending.boosted);
      }
      default:
        return true;
    }
  }

  /** The first content reward of a kind that is currently offered (UI convenience). */
  findOffered(kind: RewardedRewardDefinition['kind']): RewardedRewardDefinition | null {
    return this.rewards.find((reward) => reward.kind === kind && this.isOffered(reward.id)) ?? null;
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

    // Recorded as soon as the player opts in, so the analytics funnel can see attempts
    // that the provider later refuses.
    this.events.emit('ads:reward-requested', {
      placementId: request.placementId,
      rewardId: request.rewardId,
    });

    const availability = this.getAvailability(request.placementId, request.rewardId);
    if (availability !== 'available') {
      const outcome = this.outcome('unavailable', request, 0, `Ad not available (${availability})`);
      this.events.emit('ads:reward-failed', {
        placementId: request.placementId,
        rewardId: request.rewardId,
        status: outcome.status,
      });
      return outcome;
    }

    await this.initialize();

    const result = await this.ads.show(request.placementId);
    if (!result.rewarded) {
      logger.info('ads', `reward not granted (${result.status})`, { rewardId: request.rewardId });
      const outcome = this.outcome('not-rewarded', request, 0, `Ad ${result.status}`);
      this.events.emit('ads:reward-failed', {
        placementId: request.placementId,
        rewardId: request.rewardId,
        status: outcome.status,
      });
      return outcome;
    }

    return this.applyReward(reward, request);
  }

  /** Directly applies a reward - used after a successful view and by debug tooling. */
  applyReward(reward: RewardedRewardDefinition, request: AdRewardRequest): AdRewardOutcome {
    switch (reward.kind) {
      case 'coins': {
        const amount = Math.floor(this.resolveDynamicAmount(reward) ?? reward.amount);
        const granted = this.economy.addCoins(amount, `ads.reward.${reward.id}`);
        this.markGranted(reward.id);
        this.announce(request, granted);
        return this.outcome('granted', request, granted, `+${granted} coins`);
      }

      case 'gems': {
        const amount = Math.floor(this.resolveDynamicAmount(reward) ?? reward.amount);
        const granted = this.economy.addGems(amount, `ads.reward.${reward.id}`);
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
        const remaining = this.upgrades.getRemainingMs(job.upgradeId);
        const skipMs = this.resolveTimeSkipMs(reward, remaining);
        const applied = this.upgrades.reduceRemaining(job.upgradeId, skipMs, 'ad');
        this.markGranted(reward.id);
        this.announce(request, applied);
        return this.outcome('granted', request, applied, `${formatSeconds(applied)} removed`);
      }

      case 'incomeMultiplier': {
        const durationMs = reward.durationMs ?? 0;
        if (durationMs <= 0) {
          logger.warn('ads', `reward "${reward.id}" has no durationMs; refusing to grant`);
          return this.outcome('unavailable', request, 0, 'Reward is misconfigured');
        }
        const applied = this.boosts.apply({
          id: reward.id,
          kind: 'incomeMultiplier',
          amount: reward.amount,
          durationMs,
          source: 'ads',
          label: `${reward.amount}× income`,
        }).amount;
        this.markGranted(reward.id);
        this.announce(request, applied);
        return this.outcome(
          'granted',
          request,
          applied,
          `${reward.amount}× income for ${Math.round(durationMs / 60_000)}m`,
        );
      }

      case 'offlineBoost': {
        const pending = this.offline.getPending();
        if (!pending || pending.coins <= 0) {
          return this.outcome('no-target', request, 0, 'No offline earnings to boost');
        }
        if (pending.boosted) {
          return this.outcome('no-target', request, 0, 'Already boosted');
        }
        const boosted = this.offline.applyOfflineBoost();
        const gained = boosted ? Math.floor(boosted.coins / 2) : 0;
        this.markGranted(reward.id);
        this.announce(request, gained);
        return this.outcome('granted', request, gained, `+${gained} extra coins`);
      }

      default:
        return this.outcome('unknown-reward', request, 0, 'Unknown reward kind');
    }
  }

  /**
   * Resolves a dynamic amount (\"8% of the next restoration cost\"). Returns null when the
   * reward is static, in which case the caller falls back to `reward.amount`.
   */
  private resolveDynamicAmount(reward: RewardedRewardDefinition): number | null {
    const dynamic = reward.dynamic;
    if (!dynamic || dynamic.kind !== 'percentOfNextUpgradeCost') return null;

    const nextCost = this.getNextUpgradeCost();
    if (nextCost <= 0) return dynamic.minAmount;
    const raw = Math.ceil((nextCost * dynamic.percent) / 100);
    return clamp(raw, dynamic.minAmount, dynamic.maxAmount);
  }

  /**
   * Coins needed for the player's next restoration step: the cheapest upgrade that is not
   * completed yet. Content-driven - no building id appears here.
   */
  getNextUpgradeCost(): number {
    let cheapest = 0;
    for (const upgrade of this.content.getAllUpgrades()) {
      if (this.upgrades.isCompleted(upgrade.id)) continue;
      if (this.upgrades.isRunning(upgrade.id)) continue;
      if (upgrade.cost.currency !== 'coins') continue;
      if (cheapest === 0 || upgrade.cost.amount < cheapest) cheapest = upgrade.cost.amount;
    }
    return cheapest;
  }

  /** Time-skip maths: percentage of the remaining job, hard-capped per view. */
  private resolveTimeSkipMs(reward: RewardedRewardDefinition, remainingMs: number): number {
    const dynamic: DynamicRewardSpec | undefined = reward.dynamic;
    if (dynamic && dynamic.kind === 'percentOfRemainingUpgradeTime') {
      const raw = Math.ceil((remainingMs * dynamic.percent) / 100);
      return Math.max(0, Math.min(remainingMs, Math.min(raw, dynamic.maxAmount)));
    }
    return Math.max(0, Math.min(remainingMs, reward.amount));
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

function formatSeconds(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
