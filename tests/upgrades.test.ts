import { describe, expect, it } from 'vitest';
import {
  createTestHarness,
  TEST_BUILDING,
  TEST_CLEAN_UPGRADE,
  TEST_RESTORE_UPGRADE,
  unlockTestBuilding,
} from './helpers/fixtures';
import { MINUTE } from '@/core/utils/time';

describe('UpgradeSystem', () => {
  it('refuses upgrades for a locked building', () => {
    const { context } = createTestHarness();
    const availability = context.upgrades.evaluate(TEST_CLEAN_UPGRADE.id);

    expect(availability.ok).toBe(false);
    expect(availability.code).toBe('target-locked');

    const result = context.upgrades.start(TEST_CLEAN_UPGRADE.id);
    expect(result.ok).toBe(false);
    expect(context.economy.getCoins()).toBe(100);
  });

  it('applies an instant upgrade, its effects and its visual state', () => {
    const { context } = createTestHarness();
    unlockTestBuilding(context);

    const result = context.upgrades.start(TEST_CLEAN_UPGRADE.id);
    expect(result.ok).toBe(true);
    expect(result.completedInstantly).toBe(true);

    const building = context.state.state.buildings[TEST_BUILDING.id];
    expect(building?.tier).toBe(1);
    expect(building?.incomeMultiplier).toBe(2);
    expect(building?.visualStateId).toBe('cleaned');
    expect(building?.completedUpgradeIds).toContain(TEST_CLEAN_UPGRADE.id);
    expect(context.state.state.upgrades.completed).toContain(TEST_CLEAN_UPGRADE.id);
    expect(context.economy.getCoins()).toBe(50);
  });

  it('runs a timed upgrade through the timer and completes it on time', () => {
    const { context, clock } = createTestHarness();
    unlockTestBuilding(context);
    context.economy.forceSet('coins', 10_000);
    context.upgrades.start(TEST_CLEAN_UPGRADE.id);

    const started = context.upgrades.start(TEST_RESTORE_UPGRADE.id);
    expect(started.ok).toBe(true);
    expect(started.timerId).not.toBeNull();
    expect(context.upgrades.getActiveCount()).toBe(1);

    const active = context.upgrades.getActive(TEST_RESTORE_UPGRADE.id);
    expect(active?.endsAt).toBe(clock.now() + TEST_RESTORE_UPGRADE.durationMs);

    // Not finished yet.
    clock.advance(TEST_RESTORE_UPGRADE.durationMs - 1_000);
    context.timers.update();
    expect(context.upgrades.getActiveCount()).toBe(1);

    // Finished.
    clock.advance(2_000);
    context.timers.update();
    expect(context.upgrades.getActiveCount()).toBe(0);

    const building = context.state.state.buildings[TEST_BUILDING.id];
    expect(building?.tier).toBe(2);
    expect(building?.visualStateId).toBe('restored');
    // 1 (base) + 1 (clean) + 1.5 (restore) = 3.5
    expect(building?.incomeMultiplier).toBeCloseTo(3.5, 5);
    expect(building?.incomeBonus).toBe(5);
  });

  it('enforces prerequisites', () => {
    const { context } = createTestHarness();
    unlockTestBuilding(context);

    const availability = context.upgrades.evaluate(TEST_RESTORE_UPGRADE.id);
    expect(availability.ok).toBe(false);
    expect(availability.code).toBe('prerequisites');
    expect(availability.message).toContain(TEST_CLEAN_UPGRADE.id);
  });

  it('does not start the same upgrade twice', () => {
    const { context } = createTestHarness();
    unlockTestBuilding(context);
    context.economy.forceSet('coins', 10_000);
    context.upgrades.start(TEST_CLEAN_UPGRADE.id);
    context.upgrades.start(TEST_RESTORE_UPGRADE.id);

    const second = context.upgrades.start(TEST_RESTORE_UPGRADE.id);
    expect(second.ok).toBe(false);
    expect(second.availability.code).toBe('already-active');
  });

  it('rejects upgrades that cannot be afforded', () => {
    const { context } = createTestHarness();
    unlockTestBuilding(context);
    context.economy.forceSet('coins', 10);
    context.economy.forceSet('gems', 0);

    const availability = context.upgrades.evaluate(TEST_CLEAN_UPGRADE.id);
    expect(availability.ok).toBe(false);
    expect(availability.code).toBe('not-affordable');
  });

  it('accelerates a timed upgrade with gem acceleration', () => {
    const { context } = createTestHarness();
    unlockTestBuilding(context);
    context.economy.forceSet('coins', 1_000);
    context.economy.forceSet('gems', 100);
    context.upgrades.start(TEST_CLEAN_UPGRADE.id);
    context.upgrades.start(TEST_RESTORE_UPGRADE.id);

    const active = context.upgrades.getActive(TEST_RESTORE_UPGRADE.id);
    const skipCost = context.upgrades.computeSkipCost(TEST_RESTORE_UPGRADE, 10 * MINUTE);
    expect(skipCost).toBe(20); // 2 gems per minute * 10 minutes

    const result = context.upgrades.skipWithGems(TEST_RESTORE_UPGRADE.id);
    expect(result.ok).toBe(true);
    expect(result.gemsSpent).toBeGreaterThan(0);
    expect(context.upgrades.getActive(TEST_RESTORE_UPGRADE.id)).toBeNull();
    expect(active).not.toBeNull();
  });

  it('cancels a running upgrade and can refund the coins', () => {
    const { context } = createTestHarness();
    unlockTestBuilding(context);
    context.economy.forceSet('coins', 1_000);
    context.upgrades.start(TEST_CLEAN_UPGRADE.id);
    const coinsAfterStart = context.economy.getCoins();

    context.upgrades.start(TEST_RESTORE_UPGRADE.id);
    const cancelled = context.upgrades.cancel(TEST_RESTORE_UPGRADE.id, true);

    expect(cancelled).toBe(true);
    expect(context.upgrades.getActiveCount()).toBe(0);
    expect(context.economy.getCoins()).toBeGreaterThanOrEqual(coinsAfterStart);
  });

  it('routes district/global effects through the progression system', () => {
    const { context } = createTestHarness();
    context.content.registerUpgrade({
      id: 'upgrade.test.district',
      displayName: 'Open the district',
      target: { kind: 'global' },
      kind: 'instant',
      tier: 0,
      cost: { coins: 1 },
      durationMs: 0,
      effects: [{ type: 'unlock-district', value: 1, targetId: 'district.test' }],
    });

    context.state.update((state) => {
      state.districts['district.test'].unlocked = false;
      state.progression.unlockedDistrictIds = [];
    });

    const result = context.upgrades.start('upgrade.test.district');
    expect(result.ok).toBe(true);
    expect(context.state.state.districts['district.test']?.unlocked).toBe(true);
  });
});
