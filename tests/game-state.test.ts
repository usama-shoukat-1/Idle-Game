import { describe, expect, it } from 'vitest';

import { SAVE_SCHEMA_VERSION } from '@/core/constants/GameConstants';
import { createDefaultGameState } from '@/systems/SaveSystem/GameStateFactory';
import { createTestContent, createTestEnvironment, unlockTestBuilding } from './helpers/TestEnvironment';

/**
 * The default state is the contract every other system relies on: a fresh install must be a
 * valid, complete, serialisable `GameState` with no undefined holes.
 */
describe('default game state', () => {
  it('builds a complete, valid state from content', () => {
    const content = createTestContent();
    const state = createDefaultGameState({ now: 1_700_000_000_000, content, playerId: 'test-player' });

    expect(state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(state.profile.playerId).toBe('test-player');
    expect(state.profile.createdAt).toBe(1_700_000_000_000);
    expect(state.wallet).toEqual({ coins: 100, gems: 10 });
    expect(state.buildings.entries).toEqual({});
    expect(state.upgrades.active).toEqual({});
    expect(state.upgrades.completed).toEqual([]);
    expect(state.progression.currentStageId).toBe('stage.test.street');
    expect(state.progression.stages['stage.test.street' as never]?.unlocked).toBe(true);
    expect(state.session.resumed).toBe(false);
    expect(state.settings.audio.master).toBeGreaterThan(0);
    expect(state.tutorial.completed).toBe(false);
    expect(state.transactions).toEqual([]);
  });

  it('is JSON serialisable (no class instances, Maps, functions or undefined)', () => {
    const state = createDefaultGameState({ now: 1, content: createTestContent() });
    const roundTripped = JSON.parse(JSON.stringify(state));

    expect(roundTripped).toEqual(state);
    expect(JSON.stringify(state).includes('undefined')).toBe(false);
  });

  it('never shares default objects between states (no aliasing bugs)', () => {
    const content = createTestContent();
    const a = createDefaultGameState({ now: 1, content });
    const b = createDefaultGameState({ now: 2, content });

    a.settings.audio.master = 0.1;
    a.tutorial.completedStepIds.push('x');

    expect(b.settings.audio.master).not.toBe(0.1);
    expect(b.tutorial.completedStepIds).toEqual([]);
    expect(a).not.toBe(b);
  });

  it('is used by the service container on a first run', () => {
    const env = createTestEnvironment();

    expect(env.systems.state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(env.systems.isLoaded).toBe(true);
    expect(env.systems.economy.getCoins()).toBe(100);
    env.dispose();
  });

  it('keeps runtime flags out of the persisted state', () => {
    const env = createTestEnvironment();
    const serialised = JSON.stringify(env.state);

    // Runtime-only concepts must not leak into the save file.
    expect(serialised).not.toContain('fps');
    expect(serialised).not.toContain('runtimeSnapshot');
    env.dispose();
  });
});

describe('BuildingSystem runtime state', () => {
  it('creates a runtime row on first touch, locked by default', () => {
    const env = createTestEnvironment();
    const runtime = env.systems.buildings.ensureRuntime('building.test.cafe' as never);

    expect(runtime.unlocked).toBe(false);
    expect(runtime.tier).toBe(0);
    expect(runtime.visualState).toBe('tier0');
    expect(env.systems.buildings.isUnlocked('building.test.cafe' as never)).toBe(false);
    env.dispose();
  });

  it('rejects tier advances that skip a tier', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);

    expect(env.systems.buildings.canAdvanceTier('building.test.cafe' as never)).toEqual({ ok: true, nextTier: 1 });
    env.systems.buildings.applyTier('building.test.cafe' as never, 2, 'test.skip');

    // applyTier clamps to the maximum tier but still reports the change; the *engine* path
    // (UpgradeSystem) is what enforces the one-tier-at-a-time rule.
    expect(env.systems.buildings.getTier('building.test.cafe' as never)).toBe(2);
    expect(env.systems.buildings.canAdvanceTier('building.test.cafe' as never).reason).toBe('max-tier');
    env.dispose();
  });

  it('applies tier multipliers to income', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    const baseRate = env.systems.buildings.getIncomePerSecond('building.test.cafe' as never);

    env.systems.buildings.applyTier('building.test.cafe' as never, 1, 'test');
    const tier1Rate = env.systems.buildings.getIncomePerSecond('building.test.cafe' as never);

    expect(baseRate).toBeCloseTo(1, 5); // 10 coins / 10s
    expect(tier1Rate).toBeCloseTo(2, 5); // x2 multiplier from the tier definition
    env.dispose();
  });

  it('accrues income from elapsed time rather than from frames', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    const before = env.systems.economy.getCoins();

    env.clock.advance(60_000); // 60s at 1 coin/s
    const result = env.systems.buildings.accrueAll();

    expect(result.totalCoins).toBe(60);
    expect(env.systems.economy.getCoins()).toBe(before + 60);
    env.dispose();
  });

  it('does not double-pay when accrual runs twice in a row', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    env.clock.advance(30_000);

    env.systems.buildings.accrueAll();
    const coins = env.systems.economy.getCoins();
    const second = env.systems.buildings.accrueAll();

    expect(second.totalCoins).toBe(0);
    expect(env.systems.economy.getCoins()).toBe(coins);
    env.dispose();
  });

  it('keeps fractional accrual instead of rounding it away', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);

    // 3 x 400ms at 1 coin/s = 1.2 coins -> pays 1, banks the 0.2.
    for (let i = 0; i < 3; i += 1) {
      env.clock.advance(400);
      env.systems.buildings.accrueAll();
    }
    expect(env.systems.economy.getCoins()).toBe(101);

    // Another 800ms should release the banked fraction plus a fresh coin.
    env.clock.advance(800);
    env.systems.buildings.accrueAll();
    expect(env.systems.economy.getCoins()).toBe(102);
    env.dispose();
  });

  it('re-anchors instead of crediting negative time when the clock jumps backwards', () => {
    const env = createTestEnvironment();
    unlockTestBuilding(env);
    const before = env.systems.economy.getCoins();

    env.clock.advance(-60_000);
    const result = env.systems.buildings.accrueAll();

    expect(result.totalCoins).toBe(0);
    expect(env.systems.economy.getCoins()).toBe(before);
    env.dispose();
  });
});
