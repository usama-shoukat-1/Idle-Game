import { describe, expect, it } from 'vitest';
import { createTestHarness, TEST_BALANCE } from './helpers/fixtures';

describe('EconomySystem', () => {
  it('starts from the balance definition', () => {
    const { context } = createTestHarness();
    expect(context.economy.getCoins()).toBe(TEST_BALANCE.startingCoins);
    expect(context.economy.getGems()).toBe(TEST_BALANCE.startingGems);
  });

  it('adds and spends currency with a reason', () => {
    const { context } = createTestHarness();
    const added = context.economy.add('coins', 25, 'debug:grant');
    expect(added.ok).toBe(true);
    expect(added.record?.reason).toBe('debug:grant');
    expect(context.economy.getCoins()).toBe(TEST_BALANCE.startingCoins + 25);

    const spent = context.economy.spend('coins', 10, 'upgrade:purchase');
    expect(spent.ok).toBe(true);
    expect(context.economy.getCoins()).toBe(TEST_BALANCE.startingCoins + 15);
    expect(context.state.state.stats.lifetimeSpent.coins).toBe(10);
  });

  it('cannot spend more than the balance', () => {
    const { context } = createTestHarness();
    const before = context.economy.getCoins();

    const result = context.economy.spend('coins', before + 1, 'upgrade:purchase');

    expect(result.ok).toBe(false);
    expect(result.code).toBe('insufficient-funds');
    expect(context.economy.getCoins()).toBe(before);
  });

  it('rejects negative and non-finite amounts on both paths', () => {
    const { context } = createTestHarness();
    const before = context.economy.getCoins();

    expect(context.economy.add('coins', -500, 'debug:grant').ok).toBe(false);
    expect(context.economy.spend('coins', -500, 'upgrade:purchase').ok).toBe(false);
    expect(context.economy.add('coins', Number.NaN, 'debug:grant').ok).toBe(false);
    expect(context.economy.add('coins', Number.POSITIVE_INFINITY, 'debug:grant').ok).toBe(false);
    expect(context.economy.spend('coins', 0, 'upgrade:purchase').ok).toBe(false);
    expect(context.economy.getCoins()).toBe(before);
    expect(context.economy.getCoins()).toBeGreaterThanOrEqual(0);
  });

  it('spends multi-currency costs atomically', () => {
    const { context } = createTestHarness();
    const coinsBefore = context.economy.getCoins();
    const gemsBefore = context.economy.getGems();

    const rejected = context.economy.spendCost({ coins: 1, gems: gemsBefore + 1 }, 'upgrade:purchase');
    expect(rejected.ok).toBe(false);
    expect(context.economy.getCoins()).toBe(coinsBefore);
    expect(context.economy.getGems()).toBe(gemsBefore);

    const accepted = context.economy.spendCost({ coins: 1, gems: 1 }, 'upgrade:purchase');
    expect(accepted.ok).toBe(true);
    expect(context.economy.getCoins()).toBe(coinsBefore - 1);
    expect(context.economy.getGems()).toBe(gemsBefore - 1);
  });

  it('tracks transaction reasons for analytics', () => {
    const { context } = createTestHarness();
    context.economy.add('coins', 10, 'building:income');
    context.economy.add('coins', 10, 'building:income');

    const counters = context.state.state.stats.reasonCounters;
    expect(counters['credit:coins:building:income']?.count).toBe(2);
    expect(context.economy.getRecentTransactions(5).length).toBeGreaterThanOrEqual(2);
  });

  it('emits events that the UI can observe', () => {
    const { context } = createTestHarness();
    let changes = 0;
    context.events.on('economy:changed', () => {
      changes += 1;
    });

    context.economy.add('coins', 5, 'debug:grant');
    context.economy.spend('coins', 5, 'upgrade:purchase');

    expect(changes).toBe(2);
  });

  it('rejects invalid amounts through the debug forceSet guard', () => {
    const { context } = createTestHarness();
    const result = context.economy.forceSet('coins', Number.NaN);
    expect(result.ok).toBe(false);
    expect(Number.isFinite(context.economy.getCoins())).toBe(true);
  });
});
