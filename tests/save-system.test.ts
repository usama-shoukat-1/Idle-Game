import { describe, expect, it } from 'vitest';

import { MemoryStorageDriver } from '@/services/storage/StorageDrivers';
import { SAVE_SCHEMA_VERSION, STORAGE_KEYS } from '@/core/constants/GameConstants';
import { deserializeState, serializeState } from '@/systems/SaveSystem/SaveSchema';
import { createDefaultGameState } from '@/systems/SaveSystem/GameStateFactory';
import { createTestContent, createTestEnvironment, type TestEnvironment } from './helpers/TestEnvironment';

/**
 * Save system guarantees: round trips are lossless, corrupted payloads degrade to a
 * playable state instead of throwing, and migrations have a working (if currently empty)
 * chain to run through.
 */
describe('SaveSystem', () => {
  function snapshot(env: TestEnvironment): TestEnvironment {
    const reloaded = createTestEnvironment({ storage: env.storage, content: env.content });
    return reloaded;
  }

  it('starts a fresh game when no save exists', () => {
    const env = createTestEnvironment();
    expect(env.loadResult.status).toBe('fresh');
    expect(env.systems.save.hasSave()).toBe(false);
    env.dispose();
  });

  it('round trips the full state through storage', () => {
    const env = createTestEnvironment();
    env.systems.economy.addCoins(1234, 'test.earn');
    env.systems.buildings.unlock('building.test.cafe' as never, 'test');
    env.systems.buildings.applyTier('building.test.cafe' as never, 1, 'test');
    env.state.tutorial.currentStepId = 'step.intro';
    env.state.profile.playerId = 'player-fixed';

    expect(env.systems.save.save('test').ok).toBe(true);
    env.dispose();

    const reloaded = snapshot(env);
    expect(reloaded.loadResult.status).toBe('loaded');
    expect(reloaded.systems.economy.getCoins()).toBe(1334);
    expect(reloaded.systems.buildings.getTier('building.test.cafe' as never)).toBe(1);
    expect(reloaded.systems.buildings.isUnlocked('building.test.cafe' as never)).toBe(true);
    expect(reloaded.state.tutorial.currentStepId).toBe('step.intro');
    expect(reloaded.state.profile.playerId).toBe('player-fixed');
    expect(reloaded.state.profile.sessionCount).toBe(2);
    reloaded.dispose();
  });

  it('persists the save timestamp that offline progression depends on', () => {
    const env = createTestEnvironment();
    env.systems.save.save('test');
    const savedAt = env.systems.save.getLastSavedAt();

    expect(savedAt).toBe(env.clock.now());
    expect(env.state.session.lastSaveAt).toBe(env.clock.now());
    env.dispose();
  });

  it('recovers from invalid JSON and archives the broken payload', () => {
    const storage = new MemoryStorageDriver();
    storage.write(STORAGE_KEYS.save, '{ this is not json');

    const env = createTestEnvironment({ storage });
    expect(env.loadResult.status).toBe('recovered');
    expect(env.loadResult.issues.join(' ')).toContain('not valid JSON');
    expect(storage.read(STORAGE_KEYS.backup)).toBe('{ this is not json');
    expect(env.systems.economy.getCoins()).toBe(100); // fresh state is usable
    env.dispose();
  });

  it('repairs a structurally damaged state and reports the issues', () => {
    const storage = new MemoryStorageDriver();
    storage.write(
      STORAGE_KEYS.save,
      JSON.stringify({
        schemaVersion: 1,
        savedAt: 1,
        gameVersion: 'test',
        state: { schemaVersion: 1, wallet: { coins: 'lots', gems: null } },
      }),
    );

    const env = createTestEnvironment({ storage });

    // The state is repairable, so play continues - but the problems are surfaced, never
    // silently swallowed.
    expect(env.loadResult.status).toBe('loaded');
    expect(env.loadResult.issues.length).toBeGreaterThan(0);
    expect(Number.isFinite(env.systems.economy.getCoins())).toBe(true);
    expect(env.systems.economy.getCoins()).toBe(0);
    expect(env.systems.progression.getCurrentStageId()).toBe('stage.test.street');
    env.dispose();
  });

  it('repairs out-of-range and nonsense values on load', () => {
    const now = 1_700_000_000_000;
    const base = createDefaultGameState({ now, content: createTestContent() });

    const damaged = {
      ...base,
      wallet: { coins: -500, gems: 12.7 },
      buildings: {
        entries: {
          'building.test.cafe': {
            unlocked: 1,
            tier: -3,
            visualState: 42,
            lastIncomeAt: Number.NaN,
            incomeProgress: 5,
            assignedWorkerId: null,
          },
        },
      },
      upgrades: {
        completed: ['upgrade.test.cafe.1'],
        active: {
          'upgrade.broken': { upgradeId: 'upgrade.broken', buildingId: 'building.test.cafe', startedAt: 10, completesAt: 5 },
        },
      },
      transactions: 'not-an-array',
    };

    const storage = new MemoryStorageDriver();
    storage.write(
      STORAGE_KEYS.save,
      JSON.stringify({ schemaVersion: 1, savedAt: now, gameVersion: 'test', state: damaged }),
    );

    const env = createTestEnvironment({ storage, now: now + 1000 });
    const entry = env.state.buildings.entries['building.test.cafe' as never];

    expect(env.systems.economy.getCoins()).toBe(0);
    expect(env.systems.economy.getGems()).toBe(12);
    expect(entry?.tier).toBe(0);
    expect(entry?.lastIncomeAt).toBe(0);
    expect(env.state.upgrades.active['upgrade.broken' as never]).toBeUndefined();
    expect(Array.isArray(env.state.transactions)).toBe(true);
    env.dispose();
  });

  it('rejects a save from a newer schema and starts fresh', () => {
    const storage = new MemoryStorageDriver();
    storage.write(
      STORAGE_KEYS.save,
      JSON.stringify({ schemaVersion: 99, savedAt: 1, gameVersion: 'future', state: { schemaVersion: 99 } }),
    );

    const env = createTestEnvironment({ storage });
    expect(env.loadResult.status).toBe('recovered');
    expect(env.loadResult.issues.join(' ')).toContain('newer build');
    env.dispose();
  });

  it('migrates an older schema to the current version', () => {
    // The Phase 0 chain is empty (schema 1 is the first), so this asserts the machinery:
    // an unmigratable version is detected and reported rather than silently accepted.
    const storage = new MemoryStorageDriver();
    storage.write(STORAGE_KEYS.save, JSON.stringify({ schemaVersion: 0, savedAt: 1, state: {} }));

    const env = createTestEnvironment({ storage });
    expect(env.loadResult.status).toBe('recovered');
    expect(env.loadResult.issues.join(' ')).toMatch(/no migration path|newer build/);
    env.dispose();
  });

  it('resets to a clean state and wipes storage on demand', () => {
    const env = createTestEnvironment();
    env.systems.economy.addCoins(5000, 'test.earn');
    env.systems.save.save('test');

    const fresh = env.systems.save.reset();
    expect(fresh.wallet.coins).toBe(100);
    expect(env.systems.economy.getCoins()).toBe(100);

    env.systems.save.wipe();
    expect(env.systems.save.hasSave()).toBe(false);
    env.dispose();
  });

  it('serialises an envelope with a version, timestamp and checksum', () => {
    const state = createDefaultGameState({ now: 1234, content: createTestContent() });
    const raw = serializeState(state, { gameVersion: 'test', now: 1234 });
    const parsed = deserializeState(raw);

    expect(parsed.state).not.toBeNull();
    expect(parsed.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(JSON.parse(raw).savedAtIso).toBe(new Date(1234).toISOString());
    expect(JSON.parse(raw).checksum).toBeTruthy();
  });

  it('reports a checksum mismatch without refusing to load', () => {
    const state = createDefaultGameState({ now: 1234, content: createTestContent() });
    const envelope = JSON.parse(serializeState(state, { gameVersion: 'test', now: 1234 }));
    envelope.state.wallet.coins = 999_999; // hand-edited save

    const parsed = deserializeState(JSON.stringify(envelope));
    expect(parsed.issues.join(' ')).toContain('checksum mismatch');
    expect(parsed.state).not.toBeNull();
  });

  it('never writes outside its namespace', () => {
    const env = createTestEnvironment();
    env.systems.save.save('test');

    expect(env.storage.keys().every((key) => key.startsWith('save.') || key.startsWith('settings.') || key.startsWith('debug.'))).toBe(true);
    env.dispose();
  });
});
