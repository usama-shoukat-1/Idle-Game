import { describe, expect, it } from 'vitest';

import { EconomySystem } from '@/systems/EconomySystem/EconomySystem';
import { createTestEnvironment } from './helpers/TestEnvironment';

/**
 * Economy guarantees: the wallet can never be driven negative through gameplay APIs, and
 * every accepted mutation is journaled with a reason.
 */
describe('EconomySystem', () => {
  it('starts with the wallet defined by content', () => {
    const env = createTestEnvironment();
    expect(env.systems.economy.getCoins()).toBe(100);
    expect(env.systems.economy.getGems()).toBe(10);
    env.dispose();
  });

  it('adds coins and records the reason', () => {
    const env = createTestEnvironment();
    const granted = env.systems.economy.addCoins(25, 'test.reward');

    expect(granted).toBe(25);
    expect(env.systems.economy.getCoins()).toBe(125);
    expect(env.systems.economy.getRecentTransactions(1)[0]?.reason).toBe('test.reward');
    env.dispose();
  });

  it('refuses to spend more than the balance (and leaves it untouched)', () => {
    const env = createTestEnvironment();
    const economy = env.systems.economy;

    expect(economy.canSpendCoins(100)).toBe(true);
    expect(economy.canSpendCoins(101)).toBe(false);
    expect(economy.spendCoins(101, 'test.overspend')).toBe(false);
    expect(economy.getCoins()).toBe(100);
    env.dispose();
  });

  it('spends exactly the balance down to zero', () => {
    const env = createTestEnvironment();
    const economy = env.systems.economy;

    expect(economy.spendCoins(100, 'test.spend-all')).toBe(true);
    expect(economy.getCoins()).toBe(0);
    expect(economy.spendCoins(1, 'test.one-more')).toBe(false);
    env.dispose();
  });

  it('rejects negative, zero, NaN and infinite amounts', () => {
    const env = createTestEnvironment();
    const economy = env.systems.economy;

    for (const amount of [-50, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(economy.addCoins(amount, 'test.invalid')).toBe(0);
      expect(economy.spendCoins(amount, 'test.invalid')).toBe(false);
    }
    expect(economy.getCoins()).toBe(100);
    env.dispose();
  });

  it('emits economy events and rejects-overdraft events with payloads', () => {
    const env = createTestEnvironment();
    const seen: Array<{ delta: number; balance: number }> = [];
    const rejections: string[] = [];

    env.systems.events.on('economy:coins-changed', (payload) => seen.push(payload));
    env.systems.events.on('economy:transaction-rejected', ({ reason }) => rejections.push(reason));

    env.systems.economy.addCoins(10, 'test.gain');
    env.systems.economy.spendCoins(5, 'test.cost');
    env.systems.economy.spendCoins(9999, 'test.too-much');

    expect(seen).toEqual([
      { delta: 10, balance: 110, reason: 'test.gain' },
      { delta: -5, balance: 105, reason: 'test.cost' },
    ]);
    expect(rejections).toEqual(['test.too-much']);
    env.dispose();
  });

  it('clamps additions to the configured cap instead of overflowing', () => {
    const env = createTestEnvironment();
    const economy = new EconomySystem(
      env.state,
      env.content,
      env.systems.events,
      env.clock,
    );
    // Force a tiny cap to prove the clamp, without touching production content.
    env.content.overrideEconomyBalance({ maxCoins: 120 });

    const granted = economy.addCoins(1000, 'test.cap');

    expect(granted).toBe(20);
    expect(economy.getCoins()).toBe(120);
    env.dispose();
  });

  it('spends multiple costs atomically', () => {
    const env = createTestEnvironment();
    const economy = env.systems.economy;

    // 60 coins + 20 gems: the coins are affordable, the gems are not -> nothing is spent.
    const ok = economy.spendAll(
      [
        { currency: 'coins', amount: 60 },
        { currency: 'gems', amount: 20 },
      ],
      'test.atomic',
    );

    expect(ok).toBe(false);
    expect(economy.getCoins()).toBe(100);
    expect(economy.getGems()).toBe(10);
    env.dispose();
  });

  it('tracks lifetime earned/spent analytics', () => {
    const env = createTestEnvironment();
    env.systems.economy.addCoins(500, 'test.earn');
    env.systems.economy.spendCoins(150, 'test.spend');

    expect(env.state.analytics.totalCoinsEarned).toBe(500);
    expect(env.state.analytics.totalCoinsSpent).toBe(150);
    env.dispose();
  });

  it('keeps the persisted journal bounded', () => {
    const env = createTestEnvironment();
    for (let i = 0; i < 260; i += 1) env.systems.economy.addCoins(1, `test.${i}`);

    expect(env.state.transactions.length).toBeLessThanOrEqual(200);
    env.dispose();
  });
});
