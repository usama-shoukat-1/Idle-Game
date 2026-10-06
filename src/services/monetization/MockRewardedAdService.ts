import { logger } from '@/core/Logger';
import type { AdAvailability, RewardedAdResult, RewardedAdService } from '@/core/types/services';

/**
 * DEVELOPMENT rewarded-ad provider.
 *
 * It implements the real contract (initialize / availability / show) with zero network
 * and zero SDK, so the whole rewarded flow - button, opt-in confirmation, reward grant,
 * cooldown, analytics - can be built and QA'd before any ad account exists.
 *
 * Production note: rewarded ads are an explicit opt-in format on every supported
 * platform (the player chooses to watch and is told what they receive). Nothing in this
 * game may auto-show, force, or interrupt with an ad - see
 * docs/MONETIZATION_ARCHITECTURE.md.
 */
export type MockAdOutcome = 'rewarded' | 'dismissed' | 'failed';

export interface MockRewardedAdOptions {
  /** Simulated network/creative latency before the result resolves. */
  readonly latencyMs?: number;
  /** Outcome for the next show call. Defaults to a rewarded completion. */
  readonly outcome?: MockAdOutcome;
  /** Optional dynamic outcome resolver (used by QA toggles). */
  readonly resolveOutcome?: (placementId: string) => MockAdOutcome;
  /** Placements this mock will accept. Empty = accept anything. */
  readonly knownPlacements?: readonly string[];
}

export class MockRewardedAdService implements RewardedAdService {
  readonly providerName = 'mock';

  private ready = false;
  private showing = false;
  private outcome: MockAdOutcome;
  private readonly latencyMs: number;
  private readonly resolveOutcome?: (placementId: string) => MockAdOutcome;
  private readonly knownPlacements: readonly string[];
  private readonly showCounts = new Map<string, number>();

  constructor(options: MockRewardedAdOptions = {}) {
    this.outcome = options.outcome ?? 'rewarded';
    this.latencyMs = options.latencyMs ?? 0;
    this.resolveOutcome = options.resolveOutcome;
    this.knownPlacements = options.knownPlacements ?? [];
  }

  async initialize(): Promise<void> {
    this.ready = true;
    logger.debug('ads', 'mock rewarded ad service initialised (no network)');
  }

  getAvailability(placementId: string): AdAvailability {
    if (!this.ready) return 'loading';
    if (this.showing) return 'unavailable';
    if (this.knownPlacements.length > 0 && !this.knownPlacements.includes(placementId)) {
      return 'unavailable';
    }
    return 'available';
  }

  async show(placementId: string): Promise<RewardedAdResult> {
    if (!this.ready) {
      return { rewarded: false, status: 'unavailable', placementId, error: 'not initialised' };
    }
    if (this.showing) {
      return { rewarded: false, status: 'failed', placementId, error: 'already showing' };
    }

    this.showing = true;
    this.showCounts.set(placementId, (this.showCounts.get(placementId) ?? 0) + 1);

    try {
      if (this.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
      }
      const outcome = this.resolveOutcome?.(placementId) ?? this.outcome;
      switch (outcome) {
        case 'rewarded':
          logger.debug('ads', `mock ad watched to completion: ${placementId}`);
          return { rewarded: true, status: 'rewarded', placementId };
        case 'dismissed':
          logger.debug('ads', `mock ad dismissed early: ${placementId}`);
          return { rewarded: false, status: 'dismissed', placementId };
        default:
          logger.debug('ads', `mock ad failed to load: ${placementId}`);
          return { rewarded: false, status: 'failed', placementId, error: 'mock failure' };
      }
    } finally {
      this.showing = false;
    }
  }

  /** QA helper: change what the next `show` returns. */
  setOutcome(outcome: MockAdOutcome): void {
    this.outcome = outcome;
  }

  getShowCount(placementId: string): number {
    return this.showCounts.get(placementId) ?? 0;
  }

  dispose(): void {
    this.ready = false;
    this.showing = false;
  }
}
