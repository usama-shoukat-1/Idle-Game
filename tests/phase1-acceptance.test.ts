import { describe, expect, it } from 'vitest';

import { AD_PLACEMENTS } from '@/core/ServiceContainer';
import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from '@/core/types/primitives';
import { SAVE_KEYS, validateStateShape } from '@/systems/SaveSystem/SaveSchema';
import {
  OLD_CAFE_ID,
  bootSession,
  cafeUpgrade,
  createPhase1Environment,
  enterGame,
  grantCoins,
  restoreUpTo,
} from './helpers/TestEnvironment';

/**
 * PHASE 1 - ACCEPTANCE FLOW
 * =========================
 * The Definition of Done, walked end to end on a *single* continuous save, in the order a
 * real player would experience it:
 *
 *   500 coins -> T1 -> T2 -> income -> T3 across a reload -> rewarded ads -> 2x boost ->
 *   offline earnings -> gems -> gem acceleration -> T10 -> completion -> valid save
 *
 * If this file passes, the vertical slice is playable from a fresh install to the
 * completion screen without a softlock, an impossible upgrade state, a duplicated reward or
 * a negative balance.
 */

const MINUTE = MS_PER_MINUTE;
const SECOND = MS_PER_SECOND;

describe('Phase 1 - acceptance flow', () => {
  it('plays a fresh save from 500 coins to the restored café', async () => {
    // ---------------------------------------------------------------- new game
    let env = createPhase1Environment();
    bootSession(env);

    expect(env.loadResult.status).toBe('fresh');
    expect(env.systems.economy.getCoins()).toBe(500);
    expect(env.systems.economy.getGems()).toBe(0);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(0);
    expect(env.systems.buildings.accrueIncome(OLD_CAFE_ID, { reason: 'test' }).coins).toBe(0);

    // Tracked across both sessions (the array is shared, the subscriptions are per env).
    const events: string[] = [];
    const trackEvents = (target: typeof env): void => {
      target.systems.events.on('building:tier-changed', ({ tier }) => events.push(`tier:${tier}`));
      target.systems.events.on('building:completed', ({ totalCost, incomePerMinute }) =>
        events.push(`completed:${totalCost}:${incomePerMinute}`),
      );
    };
    trackEvents(env);

    // ------------------------------------------------- T1 and T2: instant steps
    expect(env.systems.upgrades.start(cafeUpgrade(1)).ok).toBe(true);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(1);
    expect(env.systems.economy.getCoins()).toBe(425);
    // Tier 1 is still derelict: no income yet.
    expect(env.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID)).toBe(0);

    expect(env.systems.upgrades.start(cafeUpgrade(2)).ok).toBe(true);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(2);
    expect(env.systems.economy.getCoins()).toBe(300);
    expect(env.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID) * 60_000).toBeCloseTo(25, 6);

    // ------------------------------------------------------ income accrues
    env.clock.advance(8 * MINUTE);
    const earned = env.systems.buildings.accrueIncome(OLD_CAFE_ID, { reason: 'building.income' });
    expect(earned.coins).toBe(200); // 8 minutes at 25/min
    expect(env.systems.economy.getCoins()).toBe(500);

    // --------------------------------- T3 in flight while the game is closed
    expect(env.systems.upgrades.start(cafeUpgrade(3)).ok).toBe(true);
    expect(env.systems.upgrades.isRunning(cafeUpgrade(3))).toBe(true);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(2); // the café only changes on completion

    env.clock.advance(4 * SECOND);
    env.systems.save.save('acceptance.mid-upgrade');
    const watchStartedAt = env.clock.now();
    env.dispose();

    // Reopen 5 minutes later: the 10 second job finished while the tab was closed, and the
    // café was earning at tier 2 the whole time.
    env = createPhase1Environment({ storage: env.storage, now: watchStartedAt + 5 * MINUTE });
    trackEvents(env);
    const returnSummary = bootSession(env);

    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(3);
    expect(env.systems.upgrades.isRunning(cafeUpgrade(3))).toBe(false);
    expect(env.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID) * 60_000).toBeCloseTo(40, 6);

    // ------------------------------------------- offline earnings on the way back
    const offline = returnSummary;
    expect(offline.skipped).toBe(false);
    // ~5 minutes at the tier the café was in (2 for 6s, then 3): small but non-zero.
    expect(offline.coins).toBeGreaterThan(0);
    expect(env.systems.offline.collect()).toBe(offline.coins);

    // ------------------------------------------------------------- rewarded ads
    await env.systems.ads.initialize();
    const walletBeforeAd = env.systems.economy.getCoins();
    const speedUp = await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.bonusCoins,
      rewardId: 'reward.bonus_coins',
    });
    expect(speedUp.status).toBe('granted');
    expect(env.systems.economy.getCoins()).toBe(walletBeforeAd + 50); // 8% of 300, floored at 50

    // 2x income for 30 minutes, visibly different from the base rate.
    grantCoins(env, 10_000);
    await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.incomeBoost,
      rewardId: 'reward.income_boost',
    });
    expect(env.systems.boosts.getIncomeMultiplier()).toBe(2);
    expect(env.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID) * 60_000).toBeCloseTo(80, 6);

    // ------------------------------------------------------- gem acceleration
    expect(env.systems.upgrades.start(cafeUpgrade(4)).ok).toBe(true); // 300 coins, 20 seconds
    env.clock.advance(10 * SECOND);
    const gemCost = env.systems.upgrades.getAccelerationCost(cafeUpgrade(4))!;
    expect(gemCost.currency).toBe('gems');
    expect(gemCost.amount).toBe(1); // 10 remaining seconds -> 1 gem (minimum)

    await env.systems.purchases.initialize();
    const purchase = await env.systems.purchases.purchase('gems.small');
    expect(purchase.status).toBe('completed');
    expect(env.systems.economy.getGems()).toBe(100);

    expect(env.systems.upgrades.accelerate(cafeUpgrade(4))).toBe(true);
    expect(env.systems.economy.getGems()).toBe(99);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(4);

    // --------------------------------------------------- restore to tier 10
    restoreUpTo(env, 10);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(10);
    expect(env.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID) * 60_000).toBeCloseTo(2_100, 6); // still 2x
    expect(env.systems.content.getTier(OLD_CAFE_ID, 10)!.visualState).toBe('tier10');

    // The completion state fired exactly once, with the totals the completion screen shows.
    const completionEvents = events.filter((entry) => entry.startsWith('completed:'));
    expect(completionEvents).toHaveLength(1);
    expect(completionEvents[0]).toBe(`completed:13750:2100`);

    // Later tiers cannot be bought (no impossible states), and the café is done.
    const beyond = env.systems.upgrades.start(cafeUpgrade(10));
    expect(beyond.ok).toBe(false);
    expect(beyond.reason).toBe('already-completed');

    // ---------------------------------------------------- save integrity
    env.systems.save.save('acceptance.final');
    const saveJson = env.storage.read(SAVE_KEYS.save)!;
    expect(saveJson.length).toBeGreaterThan(500);

    const reloaded = createPhase1Environment({ storage: env.storage, now: env.clock.now() + 1_000 });
    expect(reloaded.loadResult.status).toBe('loaded');
    expect(reloaded.loadResult.issues).toEqual([]);
    expect(validateStateShape(reloaded.state).isValid).toBe(true);
    expect(reloaded.systems.buildings.getTier(OLD_CAFE_ID)).toBe(10);
    expect(reloaded.systems.economy.getCoins()).toBe(env.systems.economy.getCoins());
    expect(reloaded.systems.economy.getGems()).toBe(99);
    // The boost still runs (30 minutes from when it was watched), so the rate - and the
    // number the completion screen shows - includes it.
    expect(reloaded.systems.boosts.getIncomeMultiplier()).toBe(2);
    expect(reloaded.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID) * 60_000).toBeCloseTo(2_100, 6);
    expect(reloaded.systems.upgrades.isCompleted(cafeUpgrade(10))).toBe(true);

    expect(events).toContain('tier:10');
    reloaded.dispose();
    env.dispose();
  });

  it('never leaves the player without a next step they can afford', () => {
    const env = createPhase1Environment();
    enterGame(env);

    // Walk the whole curve with *no* cheating: income pays for every step, and there is
    // always a startable upgrade until tier 10.
    let minutes = 0;
    for (let tier = 1; tier <= 10; tier += 1) {
      const id = cafeUpgrade(tier);
      const check = env.systems.upgrades.canStart(id);
      if (!check.ok) {
        expect(check.reason, `tier ${tier} blocked`).toBe('insufficient-funds');
        // Idle until affordable - income at the previous tier must cover it eventually.
        let guard = 0;
        while (!env.systems.upgrades.canStart(id).ok && guard < 100_000) {
          env.clock.advance(MINUTE);
          minutes += 1;
          env.systems.buildings.accrueIncome(OLD_CAFE_ID, { reason: 'building.income' });
          guard += 1;
        }
        expect(guard, `tier ${tier} never became affordable`).toBeLessThan(100_000);
      }

      expect(env.systems.upgrades.start(id).ok).toBe(true);
      if (env.systems.upgrades.isRunning(id)) {
        env.clock.advance(env.systems.content.getUpgrade(id).durationMs);
        env.systems.timers.tick(); // the game loop does this every frame
      }
    }

    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(10);
    // Sanity: the whole restoration is reachable by idling for well under a day.
    expect(minutes).toBeLessThan(24 * 60);
    env.dispose();
  });

  it('keeps every economic invariant intact across a long session', () => {
    const env = createPhase1Environment();
    enterGame(env);
    const started = env.systems.economy.getCoins();

    // 24 in-game hours of "playing": one tick per second, with the café restored to tier 6.
    restoreUpTo(env, 6);
    let spent = 0;
    for (let second = 0; second < 24 * 60 * 60; second += 1) {
      env.clock.advance(SECOND);
      env.systems.buildings.accrueIncome(OLD_CAFE_ID, { reason: 'building.income' });
      if (second % 600 === 0) env.systems.save.save('acceptance.long-run');
    }
    spent = env.state.analytics.totalCoinsSpent;

    expect(env.systems.economy.getCoins()).toBeGreaterThan(started);
    expect(env.systems.economy.getCoins()).toBeLessThan(1e9); // no runaway inflation
    expect(spent).toBeGreaterThanOrEqual(1_200); // tiers 1-6 cost 1,200 in total
    expect(env.state.analytics.totalCoinsEarned).toBeGreaterThan(0);
    expect(env.systems.economy.getGems()).toBe(0);

    // Every recorded transaction balances: coins in minus coins out equals the wallet delta.
    const delta = env.systems.economy.getCoins() - started;
    expect(env.state.analytics.totalCoinsEarned - spent).toBe(delta);

    // The save written at the end of the run is still valid.
    env.systems.save.save('acceptance.long-run.end');
    const reloaded = createPhase1Environment({ storage: env.storage, now: env.clock.now() + MS_PER_HOUR });
    expect(reloaded.loadResult.status).toBe('loaded');
    expect(validateStateShape(reloaded.state).isValid).toBe(true);
    expect(reloaded.systems.buildings.getTier(OLD_CAFE_ID)).toBe(6);

    reloaded.dispose();
    env.dispose();
  });
});
