import { describe, expect, it } from 'vitest';
import { createTestHarness, TEST_BUILDING, TEST_CLEAN_UPGRADE, unlockTestBuilding } from './helpers/fixtures';
import { MS_PER_SECOND } from '@/core/utils/time';

describe('BuildingSystem', () => {
  it('derives runtime state from content, not from hard-coded buildings', () => {
    const { context } = createTestHarness();
    const state = context.state.state.buildings[TEST_BUILDING.id];

    expect(state).toBeDefined();
    expect(state?.unlocked).toBe(false);
    expect(state?.tier).toBe(0);
    expect(state?.incomeMultiplier).toBe(1);
    expect(context.buildings.getDefinition(TEST_BUILDING.id)?.displayName).toBe('Test Shop');
  });

  it('reports no income while locked', () => {
    const { context } = createTestHarness();
    expect(context.buildings.getIncomePerSecond(TEST_BUILDING.id)).toBe(0);
  });

  it('accrues timestamp-based income and flushes it into the wallet', () => {
    const { context, clock } = createTestHarness();
    unlockTestBuilding(context);

    // 10 coins per second at tier 0.
    expect(context.buildings.getIncomePerSecond(TEST_BUILDING.id)).toBe(10);

    clock.advance(5 * MS_PER_SECOND);
    const accrued = context.buildings.accrue();

    expect(accrued).toBeCloseTo(50, 4);
    expect(context.buildings.pending).toBeCloseTo(50, 4);

    const walletBefore = context.economy.getCoins();
    const flushed = context.buildings.flush();
    expect(flushed).toBeCloseTo(50, 4);
    expect(context.economy.getCoins()).toBeCloseTo(walletBefore + 50, 4);
    expect(context.buildings.pending).toBe(0);

    // Flushing twice must not double-credit.
    expect(context.buildings.flush()).toBe(0);
  });

  it('does not accrue income for time before an unlock', () => {
    const { context, clock } = createTestHarness();
    clock.advance(60 * MS_PER_SECOND);
    unlockTestBuilding(context);
    clock.advance(MS_PER_SECOND);

    expect(context.buildings.accrue()).toBeCloseTo(10, 4);
  });

  it('applies upgrade effects and modifier hooks to the income rate', () => {
    const { context } = createTestHarness();
    unlockTestBuilding(context);
    context.upgrades.start(TEST_CLEAN_UPGRADE.id);

    // Tier 1 doubles the multiplier via data (20/s), and the fully restored district
    // adds its synergy step (x1.25), so 25/s.
    expect(context.buildings.getIncomePerSecond(TEST_BUILDING.id)).toBeCloseTo(25, 4);

    const breakdown = context.buildings.getIncomeBreakdown(TEST_BUILDING.id);
    expect(breakdown?.baseIncomePerSecond).toBe(10);
    expect(Object.keys(breakdown?.modifiers ?? {})).toContain('boosts');
    expect(Object.keys(breakdown?.modifiers ?? {})).toContain('district-synergy');
  });

  it('honours registered income modifiers without touching core code', () => {
    const { context } = createTestHarness();
    unlockTestBuilding(context);

    context.buildings.registerIncomeModifier('test-bonus', () => 3);
    expect(context.buildings.getIncomePerSecond(TEST_BUILDING.id)).toBeCloseTo(30, 4);

    context.buildings.unregisterIncomeModifier('test-bonus');
    expect(context.buildings.getIncomePerSecond(TEST_BUILDING.id)).toBeCloseTo(10, 4);
    // Registering twice must not compound the bonus.
    context.buildings.registerIncomeModifier('test-bonus', () => 3);
    context.buildings.registerIncomeModifier('test-bonus', () => 3);
    expect(context.buildings.getIncomePerSecond(TEST_BUILDING.id)).toBeCloseTo(30, 4);
  });

  it('updates district progress when a building is restored', () => {
    const { context } = createTestHarness();
    unlockTestBuilding(context);
    context.upgrades.start(TEST_CLEAN_UPGRADE.id);

    const district = context.state.state.districts['district.test'];
    expect(district?.restoredBuildings).toBe(1);
    expect(district?.progress).toBe(1);
  });

  it('exposes visual state transitions for future art swaps', () => {
    const { context } = createTestHarness();
    unlockTestBuilding(context);
    expect(context.buildings.getVisualState(TEST_BUILDING.id)).toBe('derelict');

    context.upgrades.start(TEST_CLEAN_UPGRADE.id);
    expect(context.buildings.getVisualState(TEST_BUILDING.id)).toBe('cleaned');
  });
});
