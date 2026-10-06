import { describe, expect, it } from 'vitest';

import { MemoryStorageDriver } from '@/services/storage/StorageDrivers';
import { SAVE_SCHEMA_VERSION, STORAGE_KEYS } from '@/core/constants/GameConstants';
import { computeElapsedMs, isPlausibleTimestamp } from '@/core/utils/TimeUtils';
import { createDefaultGameState } from '@/systems/SaveSystem/GameStateFactory';
import { createTestContent, createTestEnvironment, unlockTestBuilding } from './helpers/TestEnvironment';

/**
 * Offline progression guarantees. This is the highest-risk maths in an idle game: a wrong
 * sign, a missing clamp or a hostile device clock can create or destroy fortunes. Every
 * guard rail is asserted here.
 */
describe('OfflineIncomeSystem', () => {
  /** Builds a save, closes the game, advances the clock, then loads again. */
  function saveAndReopen(gapMs: number, options: { withBuilding?: boolean } = {}) {
    const first = createTestEnvironment();
    if (options.withBuilding !== false) unlockTestBuilding(first);
    first.systems.save.save('test');
    first.dispose();

    const second = createTestEnvironment({ storage: first.storage, content: first.content });
    second.clock.advance(gapMs);
    return second;
  }

  it('does not grant offline income on a first-ever session', () => {
    const env = createTestEnvironment();
    const summary = env.systems.offline.settle();

    expect(summary.skipped).toBe(true);
    expect(summary.skipReason).toBe('fresh-session');
    expect(summary.coins).toBe(0);
    env.dispose();
  });

  it('reports elapsed time between sessions without trusting the wallet', () => {
    const env = saveAndReopen(2 * 60 * 60 * 1000);
    const summary = env.systems.offline.settle();

    expect(summary.skipped).toBe(false);
    expect(summary.elapsedMs).toBe(2 * 60 * 60 * 1000);
    expect(summary.effectiveElapsedMs).toBe(2 * 60 * 60 * 1000);
    expect(summary.coins).toBeGreaterThan(0);
    env.dispose();
  });

  it('produces zero elapsed time when the device clock moved backwards', () => {
    const env = saveAndReopen(-3 * 60 * 60 * 1000); // clock set three hours into the past
    const summary = env.systems.offline.settle();

    expect(summary.skipped).toBe(true);
    expect(summary.skipReason).toBe('clock-backwards');
    expect(summary.coins).toBe(0);
    env.dispose();
  });

  it('clamps absurdly long absences to the configured maximum', () => {
    const env = saveAndReopen(30 * 24 * 60 * 60 * 1000); // 30 days away
    const summary = env.systems.offline.settle();

    const capMs = env.content.getEconomyBalance().offline.maxDurationMs;
    expect(summary.capped).toBe(true);
    expect(summary.effectiveElapsedMs).toBe(capMs);
    expect(summary.elapsedMs).toBe(30 * 24 * 60 * 60 * 1000);
    env.dispose();
  });

  it('skips summaries for very short absences', () => {
    const env = saveAndReopen(5_000); // five seconds
    const summary = env.systems.offline.settle();

    expect(summary.skipped).toBe(true);
    expect(summary.skipReason).toBe('too-short');
    env.dispose();
  });

  it('applies the configured efficiency to the payout', () => {
    const env = saveAndReopen(4 * 60 * 60 * 1000);
    const expectedRate = env.systems.buildings.getIncomePerSecond('building.test.cafe' as never);

    const summary = env.systems.offline.settle();
    const efficiency = env.content.getEconomyBalance().offline.efficiency;
    const expected = Math.floor(expectedRate * 4 * 3600 * efficiency);

    expect(expectedRate).toBeGreaterThan(0);
    expect(summary.coins).toBeGreaterThanOrEqual(expected - 2);
    expect(summary.coins).toBeLessThanOrEqual(expected + 2);
    env.dispose();
  });

  it('tags offline income separately in the transaction journal once collected', () => {
    const env = saveAndReopen(2 * 60 * 60 * 1000);
    const summary = env.systems.offline.settle();

    // Phase 1: settling only *calculates* - the coins arrive when the player collects.
    expect(env.systems.offline.hasPending()).toBe(true);
    const beforeCollect = env.systems.economy.getCoins();
    const granted = env.systems.offline.collect();

    expect(granted).toBe(summary.coins);
    const reasons = env.systems.economy.getRecentTransactions(20).map((entry) => entry.reason);
    expect(reasons).toContain('offline.collect');
    expect(env.systems.economy.getCoins()).toBe(beforeCollect + granted);
    env.dispose();
  });

  it('awards nothing while the content efficiency is zero (Phase 0 default)', () => {
    const first = createTestEnvironment();
    first.content.overrideEconomyBalance({
      offline: { ...first.content.getEconomyBalance().offline, efficiency: 0 },
    });
    unlockTestBuilding(first);
    first.systems.save.save('test');
    first.dispose();

    const second = createTestEnvironment({ storage: first.storage, content: first.content });
    second.clock.advance(6 * 60 * 60 * 1000);
    const summary = second.systems.offline.settle();

    expect(summary.skipped).toBe(true);
    expect(summary.skipReason).toBe('zero-efficiency');
    expect(summary.coins).toBe(0);
    second.dispose();
  });

  it('settling twice does not double-pay (the same gap is never counted twice)', () => {
    const env = saveAndReopen(2 * 60 * 60 * 1000);
    const first = env.systems.offline.settle();
    const pendingAfterFirst = env.systems.offline.getPending();
    const granted = env.systems.offline.collect();
    const coinsAfterFirst = env.systems.economy.getCoins();

    env.clock.advance(1_000);
    const second = env.systems.offline.settle();

    expect(first.skipped).toBe(false);
    expect(pendingAfterFirst?.coins).toBe(granted);
    // The second settle sees a fresh anchor, so it produces nothing to collect.
    expect(second.coins).toBe(0);
    expect(env.systems.offline.hasPending()).toBe(false);
    expect(env.systems.economy.getCoins()).toBe(coinsAfterFirst);
    env.dispose();
  });

  it('never pays the same offline interval twice, even across a reload', () => {
    const env = saveAndReopen(2 * 60 * 60 * 1000);
    env.systems.offline.settle();
    const pending = env.systems.offline.getPending();
    expect(pending).not.toBeNull();

    // Reload *before* collecting: the pending reward is part of the save...
    env.systems.save.save('mid-popup');
    const reloaded = createTestEnvironment({ storage: env.storage, content: env.content });
    expect(reloaded.systems.offline.getPending()?.coins).toBe(pending?.coins);

    // ...and is gone once collected, so a second reload cannot re-pay it.
    const granted = reloaded.systems.offline.collect();
    reloaded.systems.save.save('collected');
    const third = createTestEnvironment({ storage: env.storage, content: env.content });
    expect(third.systems.offline.getPending()).toBeNull();
    expect(third.systems.offline.collect()).toBe(0);
    expect(granted).toBeGreaterThan(0);

    env.dispose();
    reloaded.dispose();
    third.dispose();
  });

  it('preview() computes without granting or storing anything', () => {
    const env = saveAndReopen(3 * 60 * 60 * 1000);
    const before = env.systems.economy.getCoins();
    const preview = env.systems.offline.preview();

    expect(preview.coins).toBeGreaterThan(0);
    expect(env.systems.economy.getCoins()).toBe(before);
    expect(env.systems.offline.getPending()).toBeNull();
    env.dispose();
  });

  it('ignores a far-future timestamp instead of paying out a fortune', () => {
    const now = 1_700_000_000_000;
    const state = createDefaultGameState({ now, content: createTestContent() });
    state.session.resumed = true;
    state.session.lastSaveAt = now + 5 * 24 * 60 * 60 * 1000; // five days in the future

    const storage = new MemoryStorageDriver();
    storage.write(
      STORAGE_KEYS.save,
      JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, savedAt: now, gameVersion: 'test', state }),
    );

    const env = createTestEnvironment({ storage, now });
    const summary = env.systems.offline.settle();

    expect(summary.coins).toBe(0);
    expect(summary.skipped).toBe(true);
    env.dispose();
  });
});

describe('time helpers', () => {
  it('computeElapsedMs never returns a negative value', () => {
    expect(computeElapsedMs(1000, 500)).toBe(0);
    expect(computeElapsedMs(1000, 1000)).toBe(0);
    expect(computeElapsedMs(1000, 2500)).toBe(1500);
    expect(computeElapsedMs(1000, 2500, 100)).toBe(100);
  });

  it('computeElapsedMs rejects non-finite input', () => {
    expect(computeElapsedMs(Number.NaN, 1000)).toBe(0);
    expect(computeElapsedMs(1000, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('isPlausibleTimestamp filters nonsense timestamps', () => {
    const now = 1_700_000_000_000;
    expect(isPlausibleTimestamp(now, now)).toBe(true);
    expect(isPlausibleTimestamp(now - 1000, now)).toBe(true);
    expect(isPlausibleTimestamp(-5, now)).toBe(false);
    expect(isPlausibleTimestamp(Number.NaN, now)).toBe(false);
    expect(isPlausibleTimestamp(now + 10 * 24 * 60 * 60 * 1000, now)).toBe(false);
    expect(isPlausibleTimestamp('yesterday', now)).toBe(false);
  });
});
