import { describe, expect, it } from 'vitest';
import { createTestHarness, TEST_BALANCE, TEST_BUILDING, TEST_CLEAN_UPGRADE, unlockTestBuilding } from './helpers/fixtures';
import { HOUR, MINUTE } from '@/core/utils/time';

describe('OfflineIncomeSystem', () => {
  it('does not interrupt the player below the presentation threshold', () => {
    const { context, clock } = createTestHarness();
    unlockTestBuilding(context);
    clock.advance(5_000);

    const report = context.offline.computeReport();
    expect(report).not.toBeNull();
    expect(report!.elapsed.cappedMs).toBe(5_000);
    // The report is honest about the (small) window, but it is not worth a popup.
    expect(context.offline.shouldPresent(report!)).toBe(false);
  });

  it('estimates offline income from the same income pipeline as live play', () => {
    const { context, clock } = createTestHarness();
    unlockTestBuilding(context);
    context.upgrades.start(TEST_CLEAN_UPGRADE.id); // 20 coins/s

    clock.advance(10 * MINUTE);
    const report = context.offline.computeReport();

    expect(report).not.toBeNull();
    const elapsedSeconds = report!.elapsed.cappedMs / 1000;
    // Same pipeline as live play: the rate already includes upgrade + synergy modifiers.
    const liveRate = context.buildings.getIncomePerSecond(TEST_BUILDING.id);
    expect(liveRate).toBeGreaterThan(0);
    expect(report!.grossCoins).toBeCloseTo(liveRate * elapsedSeconds, 3);
    expect(report!.creditedCoins).toBeCloseTo(report!.grossCoins * TEST_BALANCE.offline.efficiency, 3);
    expect(context.offline.shouldPresent(report!)).toBe(true);
  });

  it('caps the credited window at the balance limit', () => {
    const { context, clock } = createTestHarness();
    unlockTestBuilding(context);
    clock.advance(24 * HOUR);

    const report = context.offline.computeReport();
    expect(report?.elapsed.wasCapped).toBe(true);
    expect(report?.elapsed.cappedMs).toBe(TEST_BALANCE.offline.maxOfflineMs);
  });

  it('protects against invalid last-session timestamps', () => {
    const { context, clock } = createTestHarness();
    unlockTestBuilding(context);

    context.state.update((state) => {
      state.timestamps.lastSessionTime = -999;
    });
    clock.advance(2 * HOUR);

    const report = context.offline.computeReport();
    expect(report?.elapsed.wasInvalid).toBe(true);
    expect(report?.elapsed.elapsedMs).toBe(0);
    expect(report?.creditedCoins).toBe(0);
    expect(context.offline.shouldPresent(report!)).toBe(false);
  });

  it('credits the reward once and advances the anchors', () => {
    const { context, clock } = createTestHarness();
    unlockTestBuilding(context);
    clock.advance(30 * MINUTE);

    const report = context.offline.computeReport();
    const before = context.economy.getCoins();
    const claimed = context.offline.claim(report!);

    expect(claimed.claimed).toBe(true);
    expect(context.economy.getCoins()).toBeCloseTo(before + claimed.creditedCoins, 3);
    expect(context.state.state.timestamps.lastSessionTime).toBe(clock.now());

    // Claiming again must not pay out a second time.
    context.offline.claim(claimed);
    expect(context.economy.getCoins()).toBeCloseTo(before + claimed.creditedCoins, 3);

    // And a fresh report measures only the time since the claim, not the old window.
    clock.advance(1_000);
    const next = context.offline.computeReport();
    expect(next?.elapsed.elapsedMs).toBe(1_000);
    expect(next?.creditedCoins).toBeLessThan(claimed.creditedCoins);
  });

  it('absorb() discards time without paying it out', () => {
    const { context, clock } = createTestHarness();
    unlockTestBuilding(context);
    clock.advance(20 * MINUTE);

    const before = context.economy.getCoins();
    context.offline.absorb();

    expect(context.economy.getCoins()).toBe(before);
    expect(context.state.state.timestamps.lastSessionTime).toBe(clock.now());
    expect(context.buildings.getState(TEST_BUILDING.id)?.lastIncomeAt).toBe(clock.now());
  });

  it('completes timers that finished while the player was away', () => {
    const { context, clock } = createTestHarness();
    unlockTestBuilding(context);
    context.economy.forceSet('coins', 10_000);
    context.economy.forceSet('gems', 10);
    context.upgrades.start(TEST_CLEAN_UPGRADE.id);
    context.upgrades.start('upgrade.test.restore');

    clock.advance(30 * MINUTE);
    const due = context.offline.syncTimers();

    expect(due.length).toBeGreaterThan(0);
    expect(context.upgrades.getActiveCount()).toBe(0);
    expect(context.state.state.buildings[TEST_BUILDING.id]?.tier).toBe(2);
  });

  it('respects the offline disable switch', () => {
    const { context, clock } = createTestHarness();
    unlockTestBuilding(context);
    clock.advance(2 * HOUR);

    context.state.update((state) => {
      // Simulate a balance that turns offline progression off.
      state.flags['test:offline-disabled'] = true;
    });
    const originalEnabled = context.balance.offline.enabled;
    context.balance.offline.enabled = false;

    try {
      expect(context.offline.computeReport()).toBeNull();
    } finally {
      context.balance.offline.enabled = originalEnabled;
    }
  });
});
