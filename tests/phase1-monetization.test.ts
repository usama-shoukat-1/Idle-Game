import { describe, expect, it } from 'vitest';

import { AD_PLACEMENTS } from '@/core/ServiceContainer';
import { MS_PER_MINUTE } from '@/core/types/primitives';
import { SAVE_KEYS } from '@/systems/SaveSystem/SaveSchema';
import {
  OLD_CAFE_ID,
  cafeUpgrade,
  createPhase1Environment,
  enterGame,
  grantCoins,
  restoreUpTo,
} from './helpers/TestEnvironment';

/**
 * PHASE 1 - REWARDED ADS AND THE MOCK STORE
 * =========================================
 * Monetisation is provider-independent, so these tests drive the *mock* providers through
 * the real `AdRewardSystem` / `PurchaseSystem`: reward maths, caps, cooldowns, the
 * opt-in-only contract and the gem economy are all covered with no ad network and no store.
 */

const MINUTE = MS_PER_MINUTE;

describe('Phase 1 - rewarded ads: bonus coins', () => {
  it('scales the reward from the next restoration cost, clamped to 50..500', () => {
    const env = createPhase1Environment();
    enterGame(env);

    // Fresh save: the next step is tier 1 (75 coins) -> 8% = 6 -> clamped up to 50.
    expect(env.systems.ads.getNextUpgradeCost()).toBe(75);
    expect(env.systems.ads.previewAmount('reward.bonus_coins')).toBe(50);

    // Later in the run the scaling matters: next step 1,250 -> 8% = 100.
    restoreUpTo(env, 6);
    expect(env.systems.ads.getNextUpgradeCost()).toBe(1_250);
    expect(env.systems.ads.previewAmount('reward.bonus_coins')).toBe(100);

    // Still below the ceiling at the last step: 5,250 -> 420.
    restoreUpTo(env, 9);
    expect(env.systems.ads.getNextUpgradeCost()).toBe(5_250);
    expect(env.systems.ads.previewAmount('reward.bonus_coins')).toBe(420);

    env.dispose();
  });

  it('grants the coins only after a completed view and starts the cooldown', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    await env.systems.ads.initialize();

    const before = env.systems.economy.getCoins();
    const outcome = await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.bonusCoins,
      rewardId: 'reward.bonus_coins',
    });

    expect(outcome.status).toBe('granted');
    expect(outcome.applied).toBe(50);
    expect(env.systems.economy.getCoins()).toBe(before + 50);

    // Cooldown is content-driven (5 minutes): the next request is refused, not granted.
    expect(env.systems.ads.isOnCooldown('reward.bonus_coins')).toBe(true);
    const second = await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.bonusCoins,
      rewardId: 'reward.bonus_coins',
    });
    expect(second.status).toBe('on-cooldown');
    expect(env.systems.economy.getCoins()).toBe(before + 50);

    env.clock.advance(5 * MINUTE + 1);
    expect(env.systems.ads.isOnCooldown('reward.bonus_coins')).toBe(false);

    env.dispose();
  });

  it('grants nothing when the player dismisses the ad', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    await env.systems.ads.initialize();

    env.systems.devProviders.ads!.setOutcome('dismissed');

    const before = env.systems.economy.getCoins();
    const outcome = await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.bonusCoins,
      rewardId: 'reward.bonus_coins',
    });

    expect(outcome.status).toBe('not-rewarded');
    expect(outcome.applied).toBe(0);
    expect(env.systems.economy.getCoins()).toBe(before);
    // A refused view is not a punishment: no cooldown was consumed.
    expect(env.systems.ads.isOnCooldown('reward.bonus_coins')).toBe(false);

    env.dispose();
  });

  it('reports unavailable when the provider is disabled (debug switch)', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    await env.systems.ads.initialize();

    env.systems.devProviders.ads!.setEnabled(false);
    const outcome = await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.bonusCoins,
      rewardId: 'reward.bonus_coins',
    });

    expect(outcome.status).toBe('unavailable');
    expect(env.systems.economy.getCoins()).toBe(500);
    env.dispose();
  });

  it('never shows an ad unless the player asks for one', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    env.systems.buildings.ensureDefaultUnlocks();

    // Boot the systems hard, run a whole minute of play, and check the provider was never
    // engaged. This is the "no auto-play, no interruption" contract.
    env.clock.advance(MINUTE);
    env.systems.buildings.accrueAll({ reason: 'test.income' });
    env.systems.upgrades.start(cafeUpgrade(1));
    await Promise.resolve();

    expect(env.systems.devProviders.ads!.getShowCount(AD_PLACEMENTS.bonusCoins)).toBe(0);
    expect(env.systems.devProviders.ads!.getShowCount(AD_PLACEMENTS.timeSkip)).toBe(0);
    expect(env.systems.devProviders.ads!.getShowCount(AD_PLACEMENTS.incomeBoost)).toBe(0);

    env.dispose();
  });
});

describe('Phase 1 - rewarded ads: upgrade speed-up', () => {
  it('removes 25% of the remaining time', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 6); // next: tier 7, a 5 minute job
    grantCoins(env, 20_000);
    env.systems.upgrades.start(cafeUpgrade(7));
    await env.systems.ads.initialize();

    // 5 minutes remaining -> 25% = 75s.
    expect(env.systems.ads.previewAmount('reward.upgrade_speedup')).toBe(75_000);
    const outcome = await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.timeSkip,
      rewardId: 'reward.upgrade_speedup',
    });

    expect(outcome.status).toBe('granted');
    expect(outcome.applied).toBe(75_000);
    expect(env.systems.upgrades.getRemainingMs(cafeUpgrade(7))).toBe(5 * MINUTE - 75_000);

    env.dispose();
  });

  it('caps a single view at 15 minutes', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 9);
    grantCoins(env, 20_000);
    env.systems.upgrades.start(cafeUpgrade(10)); // 45 minutes, the longest Phase 1 job
    await env.systems.ads.initialize();

    // 25% of 45 minutes is 11m15s, so the Phase 1 table never reaches the cap - it exists
    // as a guard for longer future jobs. Verify both halves: the percentage applies, and
    // the configured ceiling is the 15 minute value the brief asks for.
    const definition = env.systems.ads.tryGetReward('reward.upgrade_speedup')!;
    const dynamic = definition.dynamic!;
    expect(dynamic.kind).toBe('percentOfRemainingUpgradeTime');
    expect(dynamic.kind === 'percentOfRemainingUpgradeTime' && dynamic.maxAmount).toBe(15 * MINUTE);
    expect(env.systems.ads.previewAmount('reward.upgrade_speedup')).toBe(11.25 * MINUTE);

    // Force the guard: a hypothetical 90 minute job. 25% would be 22m30s, so the cap must
    // clamp the reward to 15 minutes and leave 75 minutes behind. (`cancel` only exists so
    // the synthetic job does not inherit the real 45 minute timer.)
    env.systems.upgrades.cancel(cafeUpgrade(10));
    env.state.upgrades.active[cafeUpgrade(10)] = {
      upgradeId: cafeUpgrade(10),
      buildingId: OLD_CAFE_ID,
      startedAt: env.clock.now(),
      completesAt: env.clock.now() + 90 * MINUTE,
      applied: false,
    };
    const outcome = await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.timeSkip,
      rewardId: 'reward.upgrade_speedup',
    });
    expect(outcome.status).toBe('granted');
    expect(outcome.applied).toBe(15 * MINUTE);
    expect(env.systems.upgrades.getRemainingMs(cafeUpgrade(10))).toBe(75 * MINUTE);

    env.dispose();
  });

  it('does not consume the ad when no upgrade is running', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    await env.systems.ads.initialize();

    // The UI hides the button (nothing to speed up) and no cooldown is burned.
    expect(env.systems.ads.isOffered('reward.upgrade_speedup')).toBe(false);
    const outcome = await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.timeSkip,
      rewardId: 'reward.upgrade_speedup',
    });

    expect(outcome.status).toBe('no-target');
    expect(env.systems.ads.isOnCooldown('reward.upgrade_speedup')).toBe(false);
    expect(env.systems.upgrades.getActiveJobs()).toHaveLength(0);

    env.dispose();
  });

  it('completes the upgrade when the reduction covers the remaining time', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 2);
    env.systems.upgrades.start(cafeUpgrade(3)); // 10 seconds
    await env.systems.ads.initialize();
    env.clock.advance(9_999); // 1ms left: any reduction ends the job

    const outcome = await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.timeSkip,
      rewardId: 'reward.upgrade_speedup',
    });

    expect(outcome.status).toBe('granted');
    expect(env.systems.upgrades.getRemainingMs(cafeUpgrade(3))).toBe(0);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(3);

    env.dispose();
  });
});

describe('Phase 1 - rewarded ads: 2x income boost', () => {
  it('doubles income for 30 minutes and then expires', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 2); // 25 coins/min
    const baseRate = env.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID);
    await env.systems.ads.initialize();

    const outcome = await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.incomeBoost,
      rewardId: 'reward.income_boost',
    });
    expect(outcome.status).toBe('granted');
    expect(outcome.applied).toBe(2);

    // Doubled rate while active, and the remaining time is visible to the UI.
    expect(env.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID)).toBeCloseTo(baseRate * 2, 10);
    expect(env.systems.boosts.hasActive('incomeMultiplier')).toBe(true);
    expect(Math.round(env.systems.boosts.getActive()[0]!.remainingMs)).toBe(30 * MINUTE);

    // 20 minutes of doubled income = 50 coins/min.
    const before = env.systems.economy.getCoins();
    env.clock.advance(20 * MINUTE);
    const accrued = env.systems.buildings.accrueIncome(OLD_CAFE_ID, { reason: 'test.income' });
    expect(accrued.coins).toBe(1_000);
    expect(env.systems.economy.getCoins()).toBe(before + 1_000);

    // 29 minutes in: still doubled.
    env.clock.advance(9 * MINUTE);
    expect(env.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID)).toBeCloseTo(baseRate * 2, 10);

    // Past the 30 minute deadline: back to the normal rate, and the boost is gone.
    env.clock.advance(2 * MINUTE);
    env.systems.boosts.prune();
    expect(env.systems.boosts.hasActive('incomeMultiplier')).toBe(false);
    expect(env.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID)).toBeCloseTo(baseRate, 10);

    env.dispose();
  });

  it('keeps a running boost across a reload (deadline based)', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 2);
    await env.systems.ads.initialize();
    await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.incomeBoost,
      rewardId: 'reward.income_boost',
    });
    env.systems.save.save('boost-active');
    const saveFile = env.storage.read(SAVE_KEYS.save);
    env.dispose();
    expect(saveFile).toBeTruthy();

    const reopened = createPhase1Environment({ storage: env.storage, now: env.clock.now() + 5 * MINUTE });
    reopened.systems.buildings.ensureDefaultUnlocks();

    expect(reopened.systems.boosts.hasActive('incomeMultiplier')).toBe(true);
    expect(Math.round(reopened.systems.boosts.getActive()[0]!.remainingMs)).toBe(25 * MINUTE);
    expect(reopened.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID)).toBeCloseTo((25 / 60_000) * 2, 10);

    // Ten minutes later it is still 2x; after the deadline it is not.
    reopened.clock.advance(24 * MINUTE);
    expect(reopened.systems.boosts.getIncomeMultiplier()).toBe(2);
    reopened.clock.advance(2 * MINUTE);
    expect(reopened.systems.boosts.getIncomeMultiplier()).toBe(1);

    reopened.dispose();
  });

  it('extends rather than stacks when watched again after the cooldown', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 2);
    await env.systems.ads.initialize();

    await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.incomeBoost,
      rewardId: 'reward.income_boost',
    });
    env.clock.advance(20 * MINUTE + 1); // cooldown over, 10 minutes of boost left

    await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.incomeBoost,
      rewardId: 'reward.income_boost',
    });

    // 10 minutes remaining + a fresh 30 = 40, and the multiplier stays 2 (never 4).
    expect(env.systems.boosts.getActive()[0]!.remainingMs).toBeGreaterThanOrEqual(40 * MINUTE - 5);
    expect(env.systems.boosts.getActive()[0]!.remainingMs).toBeLessThanOrEqual(40 * MINUTE);
    expect(env.systems.boosts.getIncomeMultiplier()).toBe(2);

    env.dispose();
  });
});

describe('Phase 1 - mock store and gems', () => {
  it('sells the three development gem packs through the purchase system', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    await env.systems.purchases.initialize();

    expect(env.systems.purchases.providerName).toBe('mock');
    expect(env.systems.purchases.getCatalog().map((entry) => entry.productId)).toEqual([
      'gems.small',
      'gems.medium',
      'gems.large',
    ]);

    for (const [productId, gems] of [
      ['gems.small', 100],
      ['gems.medium', 600],
      ['gems.large', 1_500],
    ] as const) {
      const before = env.systems.economy.getGems();
      const outcome = await env.systems.purchases.purchase(productId);
      expect(outcome.status, productId).toBe('completed');
      expect(env.systems.economy.getGems(), productId).toBe(before + gems);
    }

    expect(env.systems.economy.getGems()).toBe(2_200);
    env.dispose();
  });

  it('refuses a product that is not in the catalog', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    const outcome = await env.systems.purchases.purchase('gems.does_not_exist');

    expect(outcome.status).not.toBe('completed');
    expect(env.systems.economy.getGems()).toBe(0);
    env.dispose();
  });

  it('reports no products when the mock store is disabled', async () => {
    const env = createPhase1Environment();
    enterGame(env);
    env.systems.devProviders.store!.setEnabled(false);
    await env.systems.purchases.initialize();

    expect(env.systems.purchases.getStoreProducts()).toHaveLength(0);
    const outcome = await env.systems.purchases.purchase('gems.small');
    expect(outcome.status).not.toBe('completed');
    expect(env.systems.economy.getGems()).toBe(0);

    env.dispose();
  });

  it('spends gems to finish an upgrade instantly and reports the speed-up', () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 5);
    grantCoins(env, 20_000);
    env.systems.economy.addGems(50, 'test.grant');

    const events: Array<{ source: string; appliedMs: number }> = [];
    env.systems.events.on('upgrade:speed-up', ({ source, appliedMs }) => {
      events.push({ source, appliedMs });
    });

    env.systems.upgrades.start(cafeUpgrade(6)); // 2 minutes
    env.clock.advance(30_000); // 90s remaining -> 2 gems at 1 gem/minute

    const cost = env.systems.upgrades.getAccelerationCost(cafeUpgrade(6))!;
    expect(cost.currency).toBe('gems');
    expect(cost.amount).toBe(2);

    expect(env.systems.upgrades.accelerate(cafeUpgrade(6))).toBe(true);
    expect(env.systems.economy.getGems()).toBe(48);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(6);
    expect(events).toEqual([{ source: 'gems', appliedMs: 90_000 }]);

    env.dispose();
  });
});

describe('Phase 1 - analytics contract', () => {
  it('emits the Phase 1 analytics events with useful context', async () => {
    const env = createPhase1Environment();
    const tracked: string[] = [];
    env.systems.events.on('analytics:track', ({ name }) => {
      tracked.push(name);
    });

    enterGame(env);
    await env.systems.ads.initialize();
    await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.bonusCoins,
      rewardId: 'reward.bonus_coins',
    });
    expect(tracked).toContain('rewarded_ad_requested');
    expect(tracked).toContain('rewarded_ad_rewarded');
    expect(tracked).toContain('coins_earned');

    restoreUpTo(env, 10);

    expect(tracked).toContain('upgrade_started');
    expect(tracked).toContain('upgrade_completed');
    expect(tracked).toContain('coins_spent');
    expect(tracked).toContain('building_completed');
    expect(env.systems.analytics.getCounts()['upgrade_completed']).toBeGreaterThanOrEqual(10);

    env.dispose();
  });

  it('keeps analytics behind the provider interface (no SDK in the build)', () => {
    const env = createPhase1Environment();
    expect(env.systems.analytics.providerName).toBe('development');
    expect(env.systems.ads.providerName).toBe('mock');
    expect(env.systems.purchases.providerName).toBe('mock');
    env.dispose();
  });
});
