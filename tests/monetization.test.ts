import { describe, expect, it } from 'vitest';
import { TEST_START_TIME, unlockTestBuilding } from './helpers/fixtures';
import { MockAdRewardService } from '@/systems/AdRewardSystem/MockAdRewardService';
import { MockPurchaseService } from '@/systems/PurchaseSystem/MockPurchaseService';
import { createGameContext } from '@/core/GameContext';
import { ManualClock } from '@/core/Clock';
import { MemoryStorageAdapter } from '@/services/storage';
import { createFixtureContent } from './helpers/fixtures';
import { MINUTE } from '@/core/utils/time';
import type { RewardedAdPlacementDefinition, ProductCatalogEntry } from '@/core/types/content';

const COIN_AD: RewardedAdPlacementDefinition = {
  id: 'ad.test.coins',
  displayName: 'Bonus coins',
  requiresOptIn: true,
  cooldownMs: 5 * MINUTE,
  maxPerDay: 3,
  grants: [{ kind: 'coins', amount: 250, label: '+250 coins' }],
};

const TIME_SKIP_AD: RewardedAdPlacementDefinition = {
  id: 'ad.test.time-skip',
  displayName: 'Skip upgrade time',
  requiresOptIn: true,
  cooldownMs: 0,
  grants: [{ kind: 'timer-reduction', amount: 5 * MINUTE, label: '-5 minutes' }],
};

const GEM_PACK: ProductCatalogEntry = {
  id: 'product.test.gems',
  displayName: 'Starter gems',
  kind: 'consumable',
  enabled: true,
  grants: [{ kind: 'gems', amount: 50, label: '+50 gems' }],
};

const REMOVE_ADS: ProductCatalogEntry = {
  id: 'product.test.remove-ads',
  displayName: 'Remove ads',
  kind: 'non-consumable',
  enabled: true,
  grants: [{ kind: 'entitlement', entitlementId: 'entitlement.remove-ads', label: 'Remove ads' }],
};

function createAdHarness(adService: MockAdRewardService, purchaseService?: MockPurchaseService) {
  const clock = new ManualClock(TEST_START_TIME);
  const storage = new MemoryStorageAdapter();
  const content = createFixtureContent();
  content.registerAdPlacement(COIN_AD);
  content.registerAdPlacement(TIME_SKIP_AD);
  content.registerProduct(GEM_PACK);
  content.registerProduct(REMOVE_ADS);
  content.registerEntitlement({
    id: 'entitlement.remove-ads',
    displayName: 'Remove ads',
    kind: 'remove-ads',
  });

  const context = createGameContext({
    clock,
    storage,
    content,
    adService,
    ...(purchaseService ? { purchaseService } : {}),
    debugEnabled: false,
    configOverrides: {
      storage: { adapter: 'memory' },
      debug: { enabled: false, cheatsEnabled: false, showOverlay: false, logLevel: 'error' },
    },
  });

  return { context, clock, storage };
}

describe('rewarded ads (mock provider)', () => {
  it('grants the placement reward through the shared dispatcher', async () => {
    const service = new MockAdRewardService({ latencyMs: 0, forcedOutcome: 'granted' });
    const { context } = createAdHarness(service);

    const before = context.economy.getCoins();
    const result = await context.ads.offer('ad.test.coins');

    expect(result.outcome).toBe('granted');
    expect(result.appliedGrants).toHaveLength(1);
    expect(context.economy.getCoins()).toBe(before + 250);
    expect(context.state.state.stats.rewardedAdsWatched).toBe(1);
  });

  it('never rewards a dismissed ad', async () => {
    const service = new MockAdRewardService({ latencyMs: 0, forcedOutcome: 'dismissed' });
    const { context } = createAdHarness(service);

    const before = context.economy.getCoins();
    const result = await context.ads.offer('ad.test.coins');

    expect(result.outcome).toBe('dismissed');
    expect(result.appliedGrants).toHaveLength(0);
    expect(context.economy.getCoins()).toBe(before);
  });

  it('applies cooldowns and daily limits', async () => {
    const service = new MockAdRewardService({ latencyMs: 0, forcedOutcome: 'granted' });
    const { context, clock } = createAdHarness(service);

    await context.ads.offer('ad.test.coins');
    expect(context.ads.canOffer('ad.test.coins')).toBe(false);

    const blocked = await context.ads.offer('ad.test.coins');
    expect(blocked.outcome).toBe('cooldown');

    clock.advance(6 * MINUTE);
    expect(context.ads.canOffer('ad.test.coins')).toBe(true);

    // Burn the remaining daily allowance (3 per day).
    await context.ads.offer('ad.test.coins');
    clock.advance(6 * MINUTE);
    await context.ads.offer('ad.test.coins');
    clock.advance(6 * MINUTE);
    const dailyLimit = await context.ads.offer('ad.test.coins');
    expect(dailyLimit.outcome).toBe('cooldown');
    expect(context.ads.getCooldown('ad.test.coins').dailyLimitReached).toBe(true);
  });

  it('reports unavailable providers without granting anything', async () => {
    const service = new MockAdRewardService({ latencyMs: 0, available: false });
    const { context } = createAdHarness(service);

    const result = await context.ads.offer('ad.test.coins');
    expect(result.outcome).toBe('unavailable');
    expect(context.economy.getCoins()).toBe(100);
  });

  it('reduces timers through the timer system', async () => {
    const service = new MockAdRewardService({ latencyMs: 0, forcedOutcome: 'granted' });
    const { context, clock } = createAdHarness(service);
    unlockTestBuilding(context);
    context.economy.forceSet('coins', 10_000);
    context.upgrades.start('upgrade.test.clean');
    context.upgrades.start('upgrade.test.restore');

    clock.advance(MINUTE);
    const before = context.timers.getRemainingMs(context.upgrades.getActive('upgrade.test.restore')!.timerId);

    const result = await context.ads.offer('ad.test.time-skip');
    expect(result.outcome).toBe('granted');

    const after = context.timers.getRemainingMs(context.upgrades.getActive('upgrade.test.restore')!.timerId);
    expect(after).toBeLessThan(before);
  });

  it('exposes the provider name without leaking provider specifics', () => {
    const service = new MockAdRewardService();
    const { context } = createAdHarness(service);
    expect(context.ads.providerName).toBe('mock');
    expect(context.ads.isProviderAvailable()).toBe(true);
  });
});

describe('purchases (mock provider)', () => {
  it('delivers a consumable gem pack', async () => {
    const adService = new MockAdRewardService({ latencyMs: 0 });
    const purchaseService = new MockPurchaseService({ latencyMs: 0, cancelledProbability: 0 });
    const { context } = createAdHarness(adService, purchaseService);

    const before = context.economy.getGems();
    const result = await context.purchases.purchase(GEM_PACK.id);

    expect(result.status).toBe('completed');
    expect(context.economy.getGems()).toBe(before + 50);
  });

  it('activates an entitlement for non-consumables', async () => {
    const adService = new MockAdRewardService({ latencyMs: 0 });
    const purchaseService = new MockPurchaseService({ latencyMs: 0, cancelledProbability: 0 });
    const { context } = createAdHarness(adService, purchaseService);

    await context.purchases.purchase(REMOVE_ADS.id);
    expect(context.purchases.isEntitled('entitlement.remove-ads')).toBe(true);
    expect(context.purchases.hasRemoveAds).toBe(true);
  });

  it('does not deliver anything when a purchase is cancelled', async () => {
    const adService = new MockAdRewardService({ latencyMs: 0 });
    const purchaseService = new MockPurchaseService({ latencyMs: 0, cancelledProbability: 1 });
    const { context } = createAdHarness(adService, purchaseService);

    const before = context.economy.getGems();
    const result = await context.purchases.purchase(GEM_PACK.id);

    expect(result.status).toBe('cancelled');
    expect(context.economy.getGems()).toBe(before);
    expect(context.purchases.isEntitled('entitlement.remove-ads')).toBe(false);
  });

  it('rejects unknown catalogue entries', async () => {
    const adService = new MockAdRewardService({ latencyMs: 0 });
    const purchaseService = new MockPurchaseService({ latencyMs: 0 });
    const { context } = createAdHarness(adService, purchaseService);

    const result = await context.purchases.purchase('product.not-real');
    expect(result.status).toBe('unavailable');
  });

  it('uses provider-supplied price labels, never hard-coded ids', async () => {
    const adService = new MockAdRewardService({ latencyMs: 0 });
    const purchaseService = new MockPurchaseService({ latencyMs: 0 });
    const { context } = createAdHarness(adService, purchaseService);

    const products = await context.purchases.refreshStoreProducts();
    expect(products.map((entry) => entry.productId)).toContain(GEM_PACK.id);
    expect(context.purchases.getPriceLabel(GEM_PACK.id)).toMatch(/MOCK/);
    // Content carries no store identifier at all.
    expect(GEM_PACK.storeProductId).toBeUndefined();
  });
});
