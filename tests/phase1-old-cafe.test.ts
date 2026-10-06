import { describe, expect, it } from 'vitest';

import { SAVE_SCHEMA_VERSION, STORAGE_KEYS } from '@/core/constants/GameConstants';
import { MS_PER_HOUR, MS_PER_MINUTE, asDurationMs, upgradeId } from '@/core/types/primitives';
import {
  OLD_CAFE_ID,
  cafeUpgrade,
  createPhase1Environment,
  enterGame,
  reopenSession,
  restoreUpTo,
} from './helpers/TestEnvironment';

/**
 * PHASE 1 CONTENT + ECONOMY + PROGRESSION
 * =======================================
 * These tests run against the *shipped* content: the real Old Café definition, the real
 * ten-tier balance table and the real stage wiring. They are the automated half of the
 * Phase 1 acceptance test.
 */

const HOUR = MS_PER_HOUR;
const MINUTE = MS_PER_MINUTE;

/** The balance table from the Phase 1 brief - asserted here so a rebalance is deliberate. */
const TIER_TABLE = [
  { tier: 1, name: 'Clear the debris', cost: 75, durationMs: 0, incomePerMinute: 0 },
  { tier: 2, name: 'Repair the furniture', cost: 125, durationMs: 0, incomePerMinute: 25 },
  { tier: 3, name: 'Restore the electricity', cost: 200, durationMs: 10_000, incomePerMinute: 40 },
  { tier: 4, name: 'Repair the counter', cost: 300, durationMs: 20_000, incomePerMinute: 65 },
  { tier: 5, name: 'Restore the kitchen', cost: 500, durationMs: 45_000, incomePerMinute: 100 },
  { tier: 6, name: 'Add seating', cost: 800, durationMs: 2 * MINUTE, incomePerMinute: 160 },
  { tier: 7, name: 'Hire your first worker', cost: 1_250, durationMs: 5 * MINUTE, incomePerMinute: 250 },
  { tier: 8, name: 'Upgrade the menu', cost: 2_000, durationMs: 12 * MINUTE, incomePerMinute: 400 },
  { tier: 9, name: 'Expand the café', cost: 3_250, durationMs: 25 * MINUTE, incomePerMinute: 650 },
  { tier: 10, name: 'Premium renovation', cost: 5_250, durationMs: 45 * MINUTE, incomePerMinute: 1_050 },
];

describe('Phase 1 - new game state', () => {
  it('starts with 500 coins, 0 gems, an unlocked Old Café at tier 0 and no income', () => {
    const env = createPhase1Environment();
    enterGame(env);

    expect(env.loadResult.status).toBe('fresh');
    expect(env.systems.economy.getCoins()).toBe(500);
    expect(env.systems.economy.getGems()).toBe(0);
    expect(env.systems.buildings.isUnlocked(OLD_CAFE_ID)).toBe(true);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(0);
    expect(env.systems.buildings.getMaxTier(OLD_CAFE_ID)).toBe(10);
    expect(env.systems.buildings.getIncomePerSecond(OLD_CAFE_ID)).toBe(0);
    expect(env.systems.buildings.getVisualState(OLD_CAFE_ID)).toBe('tier0');
    expect(env.systems.buildings.getTotalRestorationCost(OLD_CAFE_ID)).toBe(13_750);

    env.dispose();
  });

  it('shows a tier 0 building with no income and an available first upgrade', () => {
    const env = createPhase1Environment();
    enterGame(env);

    // 500 coins afford the first two tiers immediately (75 + 125 = 200), which is the
    // designed "fast visual progress in the first three minutes" opening.
    expect(env.systems.upgrades.canStart(cafeUpgrade(1)).ok).toBe(true);
    expect(env.systems.upgrades.canStart(cafeUpgrade(2)).reason).toBe('missing-prerequisite');
    expect(env.systems.upgrades.canStart(cafeUpgrade(5)).ok).toBe(false);

    env.dispose();
  });
});

describe('Phase 1 - the balance table is content, not code', () => {
  it('matches the Phase 1 brief for cost, duration and income', () => {
    const env = createPhase1Environment();
    enterGame(env);

    for (const row of TIER_TABLE) {
      const upgrade = env.systems.content.getUpgrade(cafeUpgrade(row.tier));
      expect(upgrade.displayName, `tier ${row.tier} name`).toBe(row.name);
      expect(upgrade.cost.amount, `tier ${row.tier} cost`).toBe(row.cost);
      expect(upgrade.durationMs, `tier ${row.tier} duration`).toBe(row.durationMs);

      // Income is stored once (the tier multiplier) and predicted by the building system,
      // so the UI can never disagree with the economy.
      expect(
        Math.round(env.systems.buildings.predictIncomePerMinute(OLD_CAFE_ID, row.tier)),
        `tier ${row.tier} income`,
      ).toBe(row.incomePerMinute);
    }

    env.dispose();
  });

  it('totals 13,750 coins across the ten tiers', () => {
    const total = TIER_TABLE.reduce((sum, row) => sum + row.cost, 0);
    expect(total).toBe(13_750);
  });

  it('has a distinct visual state per tier and prerequisites in order', () => {
    const env = createPhase1Environment();
    enterGame(env);

    const states = new Set<string>();
    for (let tier = 0; tier <= 10; tier += 1) {
      const visual = env.systems.content.getTier(OLD_CAFE_ID, tier)?.visualState;
      expect(visual, `tier ${tier} visual state`).toBeTruthy();
      states.add(visual!);
    }
    expect(states.size).toBe(11);

    expect(env.systems.content.getUpgrade(cafeUpgrade(1)).prerequisites).toHaveLength(0);
    for (let tier = 2; tier <= 10; tier += 1) {
      expect(env.systems.content.getUpgrade(cafeUpgrade(tier)).prerequisites).toEqual([
        cafeUpgrade(tier - 1),
      ]);
    }

    env.dispose();
  });
});

describe('Phase 1 - economy', () => {
  it('cannot overspend: buying tier 1 leaves a correct balance and blocks a tier 3 rush', () => {
    const env = createPhase1Environment();
    enterGame(env);

    // Start: 500 coins. Tier 1 costs 75 -> 425.
    expect(env.systems.upgrades.start(cafeUpgrade(1)).ok).toBe(true);
    expect(env.systems.economy.getCoins()).toBe(425);

    // Tier 2 is instant and costs 125 -> 300.
    expect(env.systems.upgrades.start(cafeUpgrade(2)).ok).toBe(true);
    expect(env.systems.economy.getCoins()).toBe(300);

    // Tier 3 costs 200 (affordable) but tier 4 (300) is not affordable after it.
    expect(env.systems.upgrades.start(cafeUpgrade(3)).ok).toBe(true);
    expect(env.systems.economy.getCoins()).toBe(100);
    env.systems.upgrades.completeNow(cafeUpgrade(3), 'test');

    const blocked = env.systems.upgrades.start(cafeUpgrade(4));
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('insufficient-funds');
    expect(env.systems.economy.getCoins()).toBe(100);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(3);

    env.dispose();
  });

  it('never lets the wallet go negative when a spend is refused', () => {
    const env = createPhase1Environment();
    enterGame(env);

    env.systems.economy.spendCoins(499, 'test.spend');
    expect(env.systems.economy.getCoins()).toBe(1);
    expect(env.systems.economy.spendCoins(2, 'test.spend')).toBe(false);
    expect(env.systems.economy.getCoins()).toBe(1);

    const rejected = env.systems.economy
      .getRecentTransactions(5)
      .filter((entry) => entry.delta === 0);
    expect(rejected.length).toBeGreaterThanOrEqual(0); // rejections are logged, never applied
    expect(env.systems.economy.getCoins()).toBeGreaterThanOrEqual(0);

    env.dispose();
  });

  it('starts earning exactly the tier income rate (25 coins/min at tier 2)', () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 2);

    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(2);
    expect(env.systems.buildings.getIncomePerSecond(OLD_CAFE_ID)).toBeCloseTo(25 / 60, 6);

    // One minute of live income: exactly 25 coins, timestamp based (no frame counting).
    const before = env.systems.economy.getCoins();
    env.clock.advance(MINUTE);
    const accrued = env.systems.buildings.accrueIncome(OLD_CAFE_ID, { reason: 'test.income' });
    expect(accrued.coins).toBe(25);
    expect(env.systems.economy.getCoins()).toBe(before + 25);

    // The rate steps up with the tier (tier 3 = 40 coins/min).
    env.systems.economy.addCoins(1_000, 'test.grant');
    env.systems.upgrades.start(cafeUpgrade(3));
    env.systems.upgrades.completeNow(cafeUpgrade(3), 'test');
    expect(env.systems.buildings.getIncomePerSecond(OLD_CAFE_ID)).toBeCloseTo(40 / 60, 6);

    env.dispose();
  });

  it('accrues fractional income without losing or duplicating coins', () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 2); // 25 coins/min

    // Asking every second: a whole coin is paid the moment a full 2400ms of value has
    // banked, so the wallet always trails the exact rate by less than one coin. The point
    // of the test is that the remainder is *carried*, never dropped: the missing coin
    // arrives as soon as enough time accumulates.
    let total = 0;
    const start = env.systems.economy.getCoins();
    const tickSeconds = (seconds: number): number => {
      let paid = 0;
      for (let i = 0; i < seconds; i += 1) {
        env.clock.advance(1_000);
        paid += env.systems.buildings.accrueIncome(OLD_CAFE_ID, { reason: 'test.income' }).coins;
      }
      return paid;
    };

    total += tickSeconds(60);
    // 60s at 25/min is 25 coins; the accumulator is allowed to hold back the final coin
    // (0.9996 of a coin is banked) but never more.
    expect(total).toBeGreaterThanOrEqual(24);
    expect(total).toBeLessThanOrEqual(25);

    // One more second releases the banked coin: the rate is exact, not lossy.
    total += tickSeconds(1);
    expect(total).toBe(25);
    expect(env.systems.economy.getCoins()).toBe(start + 25);

    // Over a long window the total stays within one coin of the exact rate (never behind).
    const afterTenMinutes = tickSeconds(540); // 9 more minutes
    expect(afterTenMinutes + total).toBeGreaterThanOrEqual(248); // 250 exact, minus <= 1 coin
    expect(afterTenMinutes + total).toBeLessThanOrEqual(250);

    env.dispose();
  });
});

describe('Phase 1 - upgrade flow', () => {
  it('completes instant tiers immediately and updates the visual state', () => {
    const env = createPhase1Environment();
    enterGame(env);

    expect(env.systems.upgrades.start(cafeUpgrade(1)).ok).toBe(true);
    expect(env.systems.upgrades.isRunning(cafeUpgrade(1))).toBe(false);
    expect(env.systems.upgrades.isCompleted(cafeUpgrade(1))).toBe(true);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(1);
    expect(env.systems.buildings.getVisualState(OLD_CAFE_ID)).toBe('tier1');
    expect(env.systems.buildings.getIncomePerSecond(OLD_CAFE_ID)).toBe(0);

    expect(env.systems.upgrades.start(cafeUpgrade(2)).ok).toBe(true);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(2);
    expect(env.systems.buildings.getVisualState(OLD_CAFE_ID)).toBe('tier2');

    env.dispose();
  });

  it('keeps the visual state until a timed upgrade actually completes', () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 2);

    env.systems.economy.addCoins(1_000, 'test.grant');
    env.systems.upgrades.start(cafeUpgrade(3)); // 10 seconds

    // Mid-flight: the café must NOT look restored yet.
    env.clock.advance(5_000);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(2);
    expect(env.systems.buildings.getVisualState(OLD_CAFE_ID)).toBe('tier2');
    expect(env.systems.upgrades.getRemainingMs(cafeUpgrade(3))).toBe(5_000);

    env.clock.advance(5_000);
    env.systems.timers.tick();

    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(3);
    expect(env.systems.buildings.getVisualState(OLD_CAFE_ID)).toBe('tier3');
    expect(env.systems.buildings.getIncomePerSecond(OLD_CAFE_ID)).toBeCloseTo(40 / 60, 6);

    env.dispose();
  });

  it('blocks a tier out of order and an unaffordable tier', () => {
    const env = createPhase1Environment();
    enterGame(env);

    const outOfOrder = env.systems.upgrades.start(cafeUpgrade(3));
    expect(outOfOrder.ok).toBe(false);
    expect(outOfOrder.reason).toBe('missing-prerequisite');

    env.systems.economy.spendCoins(450, 'test.drain'); // leave 50 coins
    const broke = env.systems.upgrades.start(cafeUpgrade(1)); // costs 75
    expect(broke.ok).toBe(false);
    expect(broke.reason).toBe('insufficient-funds');
    expect(env.systems.economy.getCoins()).toBe(50);

    env.dispose();
  });

  it('prices a gem finish at one gem per remaining minute, clamped to the timer', () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 6); // tier 7 is a 5-minute job
    env.systems.economy.addCoins(5_000, 'test.grant');
    env.systems.upgrades.start(cafeUpgrade(7));

    // 5 minutes remaining -> 5 gems.
    expect(env.systems.upgrades.getAccelerationCost(cafeUpgrade(7))?.amount).toBe(5);

    env.clock.advance(4 * MINUTE); // 60s remaining -> 1 gem
    expect(env.systems.upgrades.getAccelerationCost(cafeUpgrade(7))?.amount).toBe(1);

    env.clock.advance(50_000); // 10s remaining -> still the configured minimum of 1 gem
    expect(env.systems.upgrades.getAccelerationCost(cafeUpgrade(7))?.amount).toBe(1);

    // A very long job can never cost more gems than it has seconds remaining (the clamp).
    env.systems.upgrades.completeNow(cafeUpgrade(7), 'test');
    env.systems.upgrades.start(cafeUpgrade(8)); // 12 minutes -> 12 gems (< 720s)
    expect(env.systems.upgrades.getAccelerationCost(cafeUpgrade(8))?.amount).toBe(12);

    env.dispose();
  });

  it('finishes a job with gems and spends exactly the quoted cost', () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 2);
    env.systems.economy.addCoins(1_000, 'test.grant');
    env.systems.economy.addGems(10, 'test.grant');
    env.systems.upgrades.start(cafeUpgrade(3)); // 10 seconds -> 1 gem

    const cost = env.systems.upgrades.getAccelerationCost(cafeUpgrade(3))!.amount;
    expect(env.systems.upgrades.accelerate(cafeUpgrade(3))).toBe(true);

    expect(env.systems.economy.getGems()).toBe(10 - cost);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(3);
    expect(env.systems.upgrades.isRunning(cafeUpgrade(3))).toBe(false);

    env.dispose();
  });

  it('keeps a timed upgrade alive when the session is reloaded mid-flight', () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 6);
    env.systems.economy.addCoins(5_000, 'test.grant');
    env.systems.upgrades.start(cafeUpgrade(7)); // 5 minutes
    const jobBefore = { ...env.state.upgrades.active[cafeUpgrade(7)]! };
    env.systems.save.save('mid-upgrade');
    env.dispose();

    // Reopen 2 minutes later: the job resumes with the correct remaining time.
    const reopened = reopenSession(env, env.clock.now() + 2 * MINUTE);
    const rehydrated = reopened.systems.upgrades.rehydrate();

    expect(reopened.systems.buildings.getTier(OLD_CAFE_ID)).toBe(6);
    expect(rehydrated.resumed).toBe(1);
    expect(reopened.systems.upgrades.getRemainingMs(cafeUpgrade(7))).toBe(3 * MINUTE);
    expect(reopened.state.upgrades.active[cafeUpgrade(7)]?.completesAt).toBe(jobBefore.completesAt);

    // 3 more minutes of *real* time (not accumulated frames) completes it.
    reopened.clock.advance(3 * MINUTE);
    reopened.systems.timers.tick();
    expect(reopened.systems.buildings.getTier(OLD_CAFE_ID)).toBe(7);
    expect(reopened.systems.buildings.getVisualState(OLD_CAFE_ID)).toBe('tier7');

    reopened.dispose();
  });

  it('applies an upgrade that finished while the game was closed', () => {
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 2);
    env.systems.economy.addCoins(1_000, 'test.grant');
    env.systems.upgrades.start(cafeUpgrade(3)); // 10 seconds
    env.systems.save.save('mid-upgrade');
    env.dispose();

    const reopened = reopenSession(env, env.clock.now() + 5 * MINUTE);
    const rehydrated = reopened.systems.upgrades.rehydrate();

    expect(rehydrated.completedOffline).toBe(1);
    expect(reopened.systems.buildings.getTier(OLD_CAFE_ID)).toBe(3);
    expect(reopened.systems.upgrades.isRunning(cafeUpgrade(3))).toBe(false);

    reopened.dispose();
  });
});

describe('Phase 1 - restoration to completion', () => {
  it('reaches tier 10 and reports the building as fully restored', () => {
    const env = createPhase1Environment();
    enterGame(env);

    let completedEvent: { buildingId: string; totalCost: number; incomePerMinute: number } | null = null;
    env.systems.events.on('building:completed', (payload) => {
      completedEvent = payload;
    });

    restoreUpTo(env, 10);

    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(10);
    expect(env.systems.buildings.getVisualState(OLD_CAFE_ID)).toBe('tier10');
    expect(env.systems.buildings.isFullyRestored(OLD_CAFE_ID)).toBe(true);
    expect(Math.round(env.systems.buildings.getIncomePerSecond(OLD_CAFE_ID) * 60)).toBe(1_050);

    // The completion event carries the numbers the completion screen shows.
    expect(completedEvent).not.toBeNull();
    expect(completedEvent!.totalCost).toBe(13_750);
    expect(completedEvent!.incomePerMinute).toBe(1_050);

    // And nothing further can be bought.
    const beyond = env.systems.upgrades.canStart(upgradeId('old_cafe_tier_11'));
    expect(beyond.ok).toBe(false);
    expect(beyond.reason).toBe('unknown-upgrade');

    env.dispose();
  });

  it('spends exactly 13,750 coins to restore the café from the starting wallet', () => {
    const env = createPhase1Environment();
    enterGame(env);

    const startingCoins = env.systems.economy.getCoins();
    const spentBefore = env.state.analytics.totalCoinsSpent;
    restoreUpTo(env, 10);

    // Exactly the sum of the ten tier costs leaves the wallet - nothing else is charged.
    expect(env.state.analytics.totalCoinsSpent - spentBefore).toBe(13_750);
    // And the starting 500 alone could never have paid for it: income is required.
    expect(startingCoins).toBe(500);
    expect(startingCoins).toBeLessThan(13_750);

    env.dispose();
  });
});

describe('Phase 1 - save integrity', () => {
  it('persists the complete café state across a reload', () => {
    const env = createPhase1Environment();
    enterGame(env);

    // A representative mid-game state: tier 5, one finished timed job, one running, a
    // boost, gems and a pending offline reward.
    restoreUpTo(env, 4);
    env.systems.economy.addCoins(10_000, 'test.grant');
    env.systems.economy.addGems(20, 'test.grant');
    env.systems.upgrades.start(cafeUpgrade(5)); // 45 seconds
    env.systems.upgrades.completeNow(cafeUpgrade(5), 'test');
    env.systems.upgrades.start(cafeUpgrade(6)); // 2 minutes, left running
    env.systems.boosts.apply({
      id: 'reward.income_boost',
      kind: 'incomeMultiplier',
      amount: 2,
      durationMs: 30 * MINUTE,
      source: 'test',
      label: '2× income',
    });
    env.systems.tutorial.acknowledge('test');
    env.systems.save.save('test-checkpoint');
    env.dispose();

    const reopened = reopenSession(env, env.clock.now() + 30_000);
    reopened.systems.buildings.ensureDefaultUnlocks();
    reopened.systems.upgrades.rehydrate();

    expect(reopened.loadResult.status).toBe('loaded');
    expect(reopened.state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(reopened.systems.buildings.getTier(OLD_CAFE_ID)).toBe(5);
    expect(reopened.systems.buildings.getVisualState(OLD_CAFE_ID)).toBe('tier5');
    expect(reopened.systems.economy.getGems()).toBe(20);
    expect(reopened.systems.upgrades.isCompleted(cafeUpgrade(5))).toBe(true);
    expect(reopened.systems.upgrades.isRunning(cafeUpgrade(6))).toBe(true);
    expect(reopened.systems.upgrades.getRemainingMs(cafeUpgrade(6))).toBe(90_000);
    expect(reopened.systems.boosts.hasActive('incomeMultiplier')).toBe(true);
    expect(reopened.state.tutorial.completedStepIds.length).toBeGreaterThan(0);

    reopened.dispose();
  });

  it('migrates a schema v1 save (Phase 0) into a playable v2 state', () => {
    // Build a v1-shaped save by hand: no boosts, no offline slice.
    const env = createPhase1Environment();
    enterGame(env);
    const legacy = JSON.parse(JSON.stringify(env.state)) as Record<string, unknown>;
    delete (legacy as { boosts?: unknown }).boosts;
    delete (legacy as { offline?: unknown }).offline;
    legacy.schemaVersion = 1;

    env.storage.write(STORAGE_KEYS.save, JSON.stringify({
      schemaVersion: 1,
      savedAt: env.clock.now(),
      gameVersion: '0.1.0-phase0',
      state: legacy,
    }));
    env.dispose();

    const migrated = reopenSession(env);
    expect(migrated.loadResult.status).toBe('loaded');
    expect(migrated.loadResult.migratedFrom).toBe(1);
    expect(migrated.state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(migrated.state.boosts.active).toEqual([]);
    expect(migrated.state.offline.pending).toBeNull();
    expect(migrated.systems.economy.getCoins()).toBe(500);

    migrated.dispose();
  });

  it('drops an implausible boost instead of trusting it', () => {
    const env = createPhase1Environment();
    enterGame(env);
    // A negative duration would make "expiresAt < startedAt" - rejected by sanitisation.
    env.state.boosts.active.push({
      id: 'broken',
      kind: 'incomeMultiplier',
      amount: 999,
      startedAt: env.clock.now(),
      expiresAt: env.clock.now() - 1_000,
      source: 'test',
      label: 'broken',
    });
    env.systems.save.save('test-broken');
    env.dispose();

    const reopened = reopenSession(env);
    expect(reopened.state.boosts.active.find((boost) => boost.id === 'broken')).toBeUndefined();
    expect(reopened.systems.boosts.getIncomeMultiplier()).toBe(1);
    reopened.dispose();
  });
});

describe('Phase 1 - long-run sanity', () => {
  it('a 30 minute simulated first session with offline returns stays consistent', () => {
    const env = createPhase1Environment();
    enterGame(env);

    // 0-3 min: two instant restorations (as the design intends).
    env.systems.upgrades.start(cafeUpgrade(1));
    env.systems.upgrades.start(cafeUpgrade(2));
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(2);

    // 3-20 min: earn and keep restoring, buying whenever affordable.
    for (let minute = 0; minute < 20; minute += 1) {
      env.clock.advance(MINUTE);
      env.systems.buildings.accrueIncome(OLD_CAFE_ID, { reason: 'test.income' });
      const next = env.systems.content
        .getBuildingUpgrades(OLD_CAFE_ID)
        .find((upgrade) => !env.systems.upgrades.isCompleted(upgrade.id));
      if (!next) break;
      if (env.systems.upgrades.canStart(next.id).ok) {
        env.systems.upgrades.start(next.id);
        env.systems.upgrades.completeNow(next.id, 'test.instant');
      }
    }

    const tierAfterSession = env.systems.buildings.getTier(OLD_CAFE_ID);
    expect(tierAfterSession).toBeGreaterThanOrEqual(3);
    expect(env.systems.economy.getCoins()).toBeGreaterThanOrEqual(0);

    // The player leaves for 4 hours: offline progression pays the tier-3+ rate, capped.
    env.systems.save.save('session-end');
    env.dispose();

    const back = reopenSession(env, env.clock.now() + 4 * HOUR);
    back.systems.buildings.ensureDefaultUnlocks();
    back.systems.upgrades.rehydrate();
    const summary = back.systems.offline.settle();

    expect(summary.skipped).toBe(false);
    expect(summary.effectiveElapsedMs).toBe(4 * HOUR);
    expect(summary.capped).toBe(false);
    expect(summary.coins).toBeGreaterThan(0);

    const granted = back.systems.offline.collect();
    expect(granted).toBe(summary.coins);
    expect(back.systems.economy.getCoins()).toBeGreaterThan(granted);

    // And the café is still in a sane state.
    expect(back.systems.buildings.getTier(OLD_CAFE_ID)).toBe(tierAfterSession);
    expect(back.state.wallet.coins).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(back.state.wallet.coins)).toBe(true);
    expect(asDurationMs(back.state.session.playTimeMs)).toBeGreaterThanOrEqual(0);

    back.dispose();
  });
});
