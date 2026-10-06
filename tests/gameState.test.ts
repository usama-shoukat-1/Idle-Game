import { describe, expect, it } from 'vitest';
import { createDefaultGameState } from '@/core/state/defaultGameState';
import { validateAndRepairGameState } from '@/core/state/gameStateValidation';
import { SAVE_SCHEMA_VERSION } from '@/core/types/save';
import { createFixtureContent, TEST_BALANCE, TEST_BUILDING, TEST_START_TIME } from './helpers/fixtures';

function createDefaults() {
  const content = createFixtureContent().snapshot();
  return createDefaultGameState({ now: TEST_START_TIME, balance: TEST_BALANCE, content });
}

describe('default game state', () => {
  it('contains every section the systems expect', () => {
    const state = createDefaults();

    expect(state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(state.currencies).toEqual({ coins: 100, gems: 5 });
    expect(state.progression.currentStageId).toBe('stage.test');
    expect(state.progression.unlockedStageIds).toEqual(['stage.test']);
    expect(Object.keys(state.buildings)).toContain(TEST_BUILDING.id);
    expect(Object.keys(state.districts)).toContain('district.test');
    expect(state.mastery['mastery.test']).toEqual({ trackId: 'mastery.test', level: 0, xp: 0 });
    expect(state.upgrades).toEqual({ active: {}, completed: [] });
    expect(state.timers).toEqual({});
    expect(state.timestamps.lastSessionTime).toBe(TEST_START_TIME);
    expect(state.settings.masterVolume).toBeGreaterThan(0);
    expect(state.tutorial.completed).toBe(false);
  });

  it('starts buildings locked and districts of the first stage open', () => {
    const state = createDefaults();
    expect(state.buildings[TEST_BUILDING.id]?.unlocked).toBe(false);
    expect(state.districts['district.test']?.unlocked).toBe(true);
  });

  it('is JSON serializable (no functions, no cycles)', () => {
    const state = createDefaults();
    expect(() => JSON.stringify(state)).not.toThrow();
  });
});

describe('state validation + repair', () => {
  const content = createFixtureContent().snapshot();

  const repair = (raw: unknown) =>
    validateAndRepairGameState(raw, {
      now: TEST_START_TIME,
      balance: TEST_BALANCE,
      content,
      defaults: createDefaults(),
    });

  it('falls back to defaults for non-object input', () => {
    const result = repair('nonsense');
    expect(result.ok).toBe(false);
    expect(result.value.currencies.coins).toBe(100);
    expect(result.issues[0]?.severity).toBe('error');
  });

  it('repairs invalid currency values', () => {
    const result = repair({ currencies: { coins: -100, gems: Number.NaN } });
    // Negative balances are clamped to zero; values of the wrong type fall back to
    // the balance defaults (documented safe-default rule) instead of inventing values.
    expect(result.value.currencies.coins).toBe(0);
    expect(result.value.currencies.gems).toBe(TEST_BALANCE.startingGems);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('clamps tiers and rebuilds missing buildings from content', () => {
    const result = repair({ buildings: { 'building.test-shop': { tier: 999, unlocked: true } } });
    expect(result.value.buildings[TEST_BUILDING.id]?.tier).toBe(TEST_BUILDING.maxTier);
    expect(result.value.buildings[TEST_BUILDING.id]?.unlocked).toBe(true);
  });

  it('drops unknown ids from progression lists', () => {
    const result = repair({
      progression: { currentStageId: 'stage.ghost', unlockedStageIds: ['stage.test', 'stage.ghost'] },
    });
    expect(result.value.progression.unlockedStageIds).toEqual(['stage.test']);
    expect(result.value.progression.currentStageId).toBe('stage.test');
  });

  it('sanitizes timestamps', () => {
    const result = repair({ timestamps: { lastSessionTime: -1000, createdAt: Number.NaN } });
    expect(result.value.timestamps.lastSessionTime).toBe(TEST_START_TIME);
    expect(result.value.timestamps.createdAt).toBe(TEST_START_TIME);
  });

  it('drops timers with broken anchors but keeps valid ones', () => {
    const result = repair({
      timers: {
        'timer-1': {
          kind: 'upgrade',
          label: 'ok',
          status: 'running',
          startedAt: TEST_START_TIME,
          endsAt: TEST_START_TIME - 5_000,
          durationMs: 1_000,
        },
        'timer-2': 'not-an-object',
      },
    });

    expect(result.value.timers['timer-1']?.endsAt).toBeGreaterThanOrEqual(TEST_START_TIME);
    expect(result.value.timers['timer-2']).toBeUndefined();
  });

  it('keeps a healthy payload untouched', () => {
    const defaults = createDefaults();
    const result = repair(JSON.parse(JSON.stringify(defaults)) as unknown);
    expect(result.ok).toBe(true);
    expect(result.issues.filter((entry) => entry.severity === 'error')).toHaveLength(0);
  });
});
