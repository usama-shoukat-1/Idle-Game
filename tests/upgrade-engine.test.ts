import { describe, expect, it } from 'vitest';

import { asDurationMs, upgradeId } from '@/core/types/primitives';
import { TEST_IDS, createTestContent, createTestEnvironment, unlockTestBuilding } from './helpers/TestEnvironment';
import type { UpgradeDefinition } from '@/core/types/content';

/**
 * Upgrade engine guarantees: one engine covers instant and timed upgrades, requirements are
 * checked before money moves, completion is announced exactly once, and a job that finished
 * while the game was closed is applied on the next load.
 */
describe('UpgradeSystem', () => {
  it('starts locked/unavailable before the building is unlocked', () => {
    const env = createTestEnvironment();
    const status = env.systems.upgrades.canStart(TEST_IDS.cafeTier1);

    expect(status.ok).toBe(false);
    expect(status.reason).toBe('building-locked');
    env.dispose();
  });

  it('starts a timed upgrade, spends the cost and exposes progress', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    const events: string[] = [];
    env.systems.events.on('upgrade:started', ({ upgradeId }) => events.push(upgradeId));

    const result = env.systems.upgrades.start(TEST_IDS.cafeTier1);

    expect(result.ok).toBe(true);
    expect(env.systems.economy.getCoins()).toBe(50);
    expect(env.systems.upgrades.isRunning(TEST_IDS.cafeTier1)).toBe(true);
    expect(env.systems.upgrades.getStatus(TEST_IDS.cafeTier1)).toBe('running');
    expect(env.systems.upgrades.getRemainingMs(TEST_IDS.cafeTier1)).toBe(30_000);
    expect(events).toEqual([TEST_IDS.cafeTier1]);
    env.dispose();
  });

  it('applies the tier, emits completion and clears the job when the timer elapses', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    const completions: Array<{ upgradeId: string; tier: number }> = [];
    env.systems.events.on('upgrade:completed', ({ upgradeId, tier }) => completions.push({ upgradeId, tier }));

    env.systems.upgrades.start(TEST_IDS.cafeTier1);
    env.clock.advance(30_000);
    env.systems.timers.tick();

    expect(completions).toEqual([{ upgradeId: TEST_IDS.cafeTier1, tier: 1 }]);
    expect(env.systems.upgrades.isCompleted(TEST_IDS.cafeTier1)).toBe(true);
    expect(env.systems.upgrades.isRunning(TEST_IDS.cafeTier1)).toBe(false);
    expect(env.systems.buildings.getTier(TEST_IDS.cafe)).toBe(1);
    expect(env.systems.buildings.getVisualState(TEST_IDS.cafe)).toBe('tier1');
    env.dispose();
  });

  it('completes instant upgrades immediately (duration 0)', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    env.systems.economy.addCoins(1000, 'test.fund');

    // Timed step first: it is a prerequisite of the instant one.
    env.systems.upgrades.start(TEST_IDS.cafeTier1);
    env.clock.advance(30_000);
    env.systems.timers.tick();
    const coinsBefore = env.systems.economy.getCoins();

    expect(env.systems.upgrades.start(TEST_IDS.cafeTier2).ok).toBe(true);

    expect(env.systems.upgrades.isCompleted(TEST_IDS.cafeTier2)).toBe(true);
    expect(env.systems.upgrades.isRunning(TEST_IDS.cafeTier2)).toBe(false);
    expect(env.systems.buildings.getTier(TEST_IDS.cafe)).toBe(2);
    expect(env.systems.economy.getCoins()).toBe(coinsBefore - 200);
    expect(env.systems.timers.has('upgrade:upgrade.test.cafe.2')).toBe(false);
    env.dispose();
  });

  it('enforces prerequisites', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);

    const check = env.systems.upgrades.canStart(TEST_IDS.cafeTier2);

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('missing-prerequisite');
    expect(env.systems.upgrades.start(TEST_IDS.cafeTier2).ok).toBe(false);
    expect(env.systems.economy.getCoins()).toBe(100);
    env.dispose();
  });

  it('refuses to start when funds are missing', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    env.systems.economy.spendCoins(90, 'test.drain');

    const check = env.systems.upgrades.canStart(TEST_IDS.cafeTier1);

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('insufficient-funds');
    expect(env.systems.economy.getCoins()).toBe(10); // unchanged by the failed attempt
    env.dispose();
  });

  it('cannot start the same upgrade twice', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    env.systems.upgrades.start(TEST_IDS.cafeTier1);

    expect(env.systems.upgrades.canStart(TEST_IDS.cafeTier1).reason).toBe('already-running');
    expect(env.systems.economy.getCoins()).toBe(50);
    env.dispose();
  });

  it('applies a job that finished while the game was closed', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    env.systems.upgrades.start(TEST_IDS.cafeTier1);
    env.systems.save.save('test');
    env.dispose();

    // Ten minutes pass with the game closed, then a new session loads the save.
    const reloaded = createTestEnvironment({ storage: env.storage, content: env.content });
    reloaded.clock.advance(10 * 60_000);
    const outcome = reloaded.systems.upgrades.rehydrate();

    expect(outcome.completedOffline).toBe(1);
    expect(reloaded.systems.upgrades.isCompleted(TEST_IDS.cafeTier1)).toBe(true);
    expect(reloaded.systems.buildings.getTier(TEST_IDS.cafe)).toBe(1);
    expect(reloaded.state.upgrades.active[TEST_IDS.cafeTier1]).toBeUndefined();
    reloaded.dispose();
  });

  it('resumes a partially elapsed job after a reload', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    env.systems.upgrades.start(TEST_IDS.cafeTier1);
    env.systems.save.save('test');
    env.dispose();

    const reloaded = createTestEnvironment({ storage: env.storage, content: env.content });
    reloaded.clock.advance(10_000);
    const outcome = reloaded.systems.upgrades.rehydrate();

    expect(outcome.resumed).toBe(1);
    expect(reloaded.systems.upgrades.getRemainingMs(TEST_IDS.cafeTier1)).toBe(20_000);
    expect(reloaded.systems.upgrades.getProgress(TEST_IDS.cafeTier1)).toBeCloseTo(1 / 3, 2);
    reloaded.dispose();
  });

  it('reduces remaining time for rewarded-ad speed-ups', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    env.systems.upgrades.start(TEST_IDS.cafeTier1);

    const removed = env.systems.upgrades.reduceRemaining(TEST_IDS.cafeTier1, 10_000);

    expect(removed).toBe(10_000);
    expect(env.systems.upgrades.getRemainingMs(TEST_IDS.cafeTier1)).toBe(20_000);
    env.dispose();
  });

  it('finishes instantly once a speed-up covers the remaining time', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    env.systems.upgrades.start(TEST_IDS.cafeTier1);

    env.systems.upgrades.reduceRemaining(TEST_IDS.cafeTier1, 999_999);

    expect(env.systems.upgrades.isCompleted(TEST_IDS.cafeTier1)).toBe(true);
    expect(env.systems.buildings.getTier(TEST_IDS.cafe)).toBe(1);
    env.dispose();
  });

  it('accelerates with gems using the content-defined conversion', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    env.systems.upgrades.start(TEST_IDS.cafeTier1);

    const cost = env.systems.upgrades.getAccelerationCost(TEST_IDS.cafeTier1);
    expect(cost).toEqual({ currency: 'gems', amount: 1 }); // 0.5 remaining minutes rounds up

    expect(env.systems.upgrades.accelerate(TEST_IDS.cafeTier1)).toBe(true);
    expect(env.systems.economy.getGems()).toBe(9);
    expect(env.systems.upgrades.isCompleted(TEST_IDS.cafeTier1)).toBe(true);
    env.dispose();
  });

  it('cancels a running job without granting progress', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    env.systems.upgrades.start(TEST_IDS.cafeTier1);
    const cancelled: string[] = [];
    env.systems.events.on('upgrade:cancelled', ({ upgradeId }) => cancelled.push(upgradeId));

    expect(env.systems.upgrades.cancel(TEST_IDS.cafeTier1)).toBe(true);

    expect(cancelled).toEqual([TEST_IDS.cafeTier1]);
    expect(env.systems.upgrades.isCompleted(TEST_IDS.cafeTier1)).toBe(false);
    expect(env.systems.buildings.getTier(TEST_IDS.cafe)).toBe(0);
    env.dispose();
  });

  it('drops jobs whose upgrade id no longer exists in content', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    env.systems.upgrades.start(TEST_IDS.cafeTier1);
    env.state.upgrades.active['upgrade.ghost' as never] = {
      upgradeId: 'upgrade.ghost' as never,
      buildingId: TEST_IDS.cafe,
      startedAt: env.clock.now(),
      completesAt: env.clock.now() + 1000,
      applied: false,
    };

    const outcome = env.systems.upgrades.rehydrate();

    expect(outcome.resumed).toBe(1);
    expect(env.state.upgrades.active['upgrade.ghost' as never]).toBeUndefined();
    env.dispose();
  });

  it('rejects an upgrade whose tier skips ahead', () => {
    const content = createTestContent({
      upgrades: [
        {
          id: upgradeId('upgrade.test.jump'),
          displayName: 'Jump ahead',
          description: '',
          targetBuildingId: TEST_IDS.cafe,
          tier: 3,
          cost: { currency: 'coins', amount: 1 },
          durationMs: asDurationMs(0),
          incomeMultiplier: 2,
          unlocks: [],
          visualState: 'tier2',
          prerequisites: [],
        } satisfies UpgradeDefinition,
      ],
    });
    const env = createTestEnvironment({ content });
    unlockTestBuilding(env);

    const check = env.systems.upgrades.canStart(upgradeId('upgrade.test.jump'));
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('tier-not-available');
    env.dispose();
  });
});
