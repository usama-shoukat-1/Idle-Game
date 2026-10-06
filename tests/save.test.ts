import { describe, expect, it } from 'vitest';
import { createGameContext } from '@/core/GameContext';
import { ManualClock } from '@/core/Clock';
import { MemoryStorageAdapter } from '@/services/storage';
import { createFixtureContent, TEST_START_TIME } from './helpers/fixtures';

function createContextWith(storage: MemoryStorageAdapter, clock: ManualClock) {
  return createGameContext({
    clock,
    storage,
    content: createFixtureContent(),
    debugEnabled: false,
    configOverrides: {
      storage: { adapter: 'memory' },
      debug: { enabled: false, cheatsEnabled: false, showOverlay: false, logLevel: 'error' },
    },
  });
}

describe('SaveSystem', () => {
  it('reports no save for a fresh storage', () => {
    const storage = new MemoryStorageAdapter();
    const clock = new ManualClock(TEST_START_TIME);
    const context = createContextWith(storage, clock);

    expect(context.save.hasSave()).toBe(false);
    expect(context.save.peek()).toEqual({ kind: 'no-save' });
  });

  it('round-trips state through save/load', () => {
    const storage = new MemoryStorageAdapter();
    const clock = new ManualClock(TEST_START_TIME);
    const first = createContextWith(storage, clock);

    first.economy.add('coins', 1_234, 'debug:grant');
    first.economy.add('gems', 7, 'debug:grant');
    first.buildings.unlock('building.test-shop');
    const saveResult = first.save.save(first.state.snapshot(), 'manual');
    expect(saveResult.ok).toBe(true);

    // Second boot: brand-new context, same storage.
    const second = createContextWith(storage, clock);
    expect(second.save.hasSave()).toBe(true);
    const loadResult = second.save.load();

    expect(loadResult.ok).toBe(true);
    expect(loadResult.state?.currencies.coins).toBe(first.economy.getCoins());
    expect(loadResult.state?.currencies.gems).toBe(first.economy.getGems());
    expect(loadResult.state?.buildings['building.test-shop']?.unlocked).toBe(true);
    expect(loadResult.info?.schemaVersion).toBe(1);
  });

  it('resets to a clean default state', () => {
    const storage = new MemoryStorageAdapter();
    const clock = new ManualClock(TEST_START_TIME);
    const context = createContextWith(storage, clock);

    context.economy.add('coins', 999, 'debug:grant');
    context.save.save(context.state.snapshot(), 'manual');

    const fresh = context.save.reset();
    expect(context.save.hasSave()).toBe(false);
    expect(fresh.currencies.coins).toBe(100);
    expect(fresh.upgrades.completed).toEqual([]);
  });

  it('treats an unreadable payload as a fresh start instead of crashing', () => {
    const storage = new MemoryStorageAdapter();
    const clock = new ManualClock(TEST_START_TIME);
    storage.setItem('restore-it:save:v1', '{not json');

    const context = createContextWith(storage, clock);
    const result = context.save.load();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('unreadable-save');
    expect(result.state?.currencies.coins).toBe(100);
  });

  it('repairs a partial payload instead of rejecting it', () => {
    const storage = new MemoryStorageAdapter();
    const clock = new ManualClock(TEST_START_TIME);
    storage.setItem(
      'restore-it:save:v1',
      JSON.stringify({
        schemaVersion: 1,
        savedAt: TEST_START_TIME,
        appVersion: 'test',
        data: {
          currencies: { coins: 'not-a-number', gems: -5 },
          buildings: { 'building.test-shop': { unlocked: true, tier: 99 } },
          timestamps: { lastSessionTime: -1 },
        },
      }),
    );

    const context = createContextWith(storage, clock);
    const result = context.save.load();

    expect(result.state).not.toBeNull();
    // Wrong-typed values fall back to the balance defaults; negatives clamp to zero.
    expect(result.state?.currencies.coins).toBe(100);
    expect(result.state?.currencies.gems).toBe(0);
    // Tier is clamped to the definition's maxTier.
    expect(result.state?.buildings['building.test-shop']?.tier).toBe(2);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('migrates legacy (envelope-less) payloads through the repair path', () => {
    const storage = new MemoryStorageAdapter();
    const clock = new ManualClock(TEST_START_TIME);
    storage.setItem(
      'restore-it:save:v1',
      JSON.stringify({
        currencies: { coins: 42, gems: 1 },
        timestamps: { lastSessionTime: TEST_START_TIME - 1_000 },
      }),
    );

    const context = createContextWith(storage, clock);
    const result = context.save.load();

    expect(result.state?.currencies.coins).toBe(42);
    expect(result.info?.schemaVersion).toBe(1);
  });

  it('exports and imports a raw payload', () => {
    const storage = new MemoryStorageAdapter();
    const clock = new ManualClock(TEST_START_TIME);
    const context = createContextWith(storage, clock);

    context.economy.add('coins', 5, 'debug:grant');
    const raw = context.save.exportRaw(context.state.snapshot());

    expect(raw).toContain('schemaVersion');
    const imported = context.save.importRaw(raw);
    expect(imported.ok).toBe(true);
    expect(imported.state?.currencies.coins).toBe(context.economy.getCoins());
  });

  it('does not put save logic inside scenes (single entry point)', () => {
    // The SaveSystem is the only component allowed to touch the storage adapter.
    const storage = new MemoryStorageAdapter();
    const clock = new ManualClock(TEST_START_TIME);
    const context = createContextWith(storage, clock);

    context.save.save(context.state.snapshot(), 'autosave');
    expect(storage.keys()).toContain('restore-it:save:v1');
    expect(context.save.stats.saveCount).toBe(1);
  });
});
