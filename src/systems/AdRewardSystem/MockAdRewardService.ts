/**
 * Development/mock rewarded-ad service.
 *
 * It exists so the reward flow can be built, tested and QA'd end to end with no
 * ad network, no SDK, no account and no hard-coded ad unit ids. Wiring a real
 * provider later means implementing `AdRewardService` - the game code does not
 * change, and the opt-in policy stays enforced by the system layer.
 */

import type {
  AdRewardService,
  MockAdRewardOptions,
  RewardedAdOutcome,
  RewardedAdResult,
} from '@/core/types/monetization';
import type { AdPlacementId } from '@/core/types/ids';
import { Rng } from '@/core/utils/rng';
import { createLogger } from '@/core/utils/logger';

export class MockAdRewardService implements AdRewardService {
  readonly providerName = 'mock';
  private readonly log = createLogger('ads:mock');
  private readonly rng: Rng;
  private available: boolean;
  private readonly latencyMs: number;
  private readonly forcedOutcome?: RewardedAdOutcome;
  private readonly dismissedProbability: number;
  private shown = 0;

  constructor(options: MockAdRewardOptions = {}, seed = 1234) {
    this.available = options.available ?? true;
    this.latencyMs = Math.max(0, options.latencyMs ?? 250);
    this.forcedOutcome = options.forcedOutcome;
    this.dismissedProbability = Math.min(1, Math.max(0, options.dismissedProbability ?? 0.15));
    this.rng = new Rng(seed);
  }

  isAvailable(): boolean {
    return this.available;
  }

  /** Test/debug hook to simulate the provider going away or coming back. */
  setAvailable(available: boolean): void {
    this.available = available;
  }

  get showCount(): number {
    return this.shown;
  }

  async preload(placementIds: AdPlacementId[]): Promise<void> {
    this.log.debug(`preloading ${placementIds.length} placement(s) (mock: nothing to load)`);
  }

  async show(placementId: AdPlacementId): Promise<RewardedAdResult> {
    // Rewarded ads are always opt-in: `show` is only ever called from an explicit
    // player action (see AdRewardSystem.offer).
    if (!this.available) {
      return { placementId, outcome: 'unavailable', message: 'mock provider unavailable' };
    }

    if (this.latencyMs > 0) await delay(this.latencyMs);
    this.shown += 1;

    if (this.forcedOutcome) {
      return { placementId, outcome: this.forcedOutcome, message: `forced:${this.forcedOutcome}` };
    }

    if (this.rng.next() < this.dismissedProbability) {
      return { placementId, outcome: 'dismissed', message: 'player closed the ad early' };
    }
    return { placementId, outcome: 'granted' };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
