import { describe, expect, it } from 'vitest';

import { MemoryStorageDriver } from '@/services/storage/StorageDrivers';
import { computeLayoutMetrics } from '@/ui/layout/LayoutMetrics';
import { createTestEnvironment, unlockTestBuilding } from './helpers/TestEnvironment';
import type { StorageDriver } from '@/core/types/services';

/**
 * BOOT / SESSION SMOKE TEST
 * =========================
 * Walks the exact sequence the scenes perform - load, rehydrate jobs, settle offline
 * income, refresh unlocks, play, autosave, reload - and asserts continuity between
 * sessions. Scenes themselves are thin wrappers around these calls, so this covers the
 * real flow without needing a browser.
 *
 * It doubles as a guard against "the preview looks fine but state is broken" regressions.
 */
describe('game session lifecycle', () => {
  /** Fixed epoch so session boundaries are explicit rather than accidental. */
  const T0 = 1_700_000_000_000;
  const HOUR = 60 * 60 * 1000;

  function startSession(storage: StorageDriver, clockNow?: number) {
    return createTestEnvironment({ storage, now: clockNow ?? T0 });
  }

  it('runs a complete first session without throwing', () => {
    const env = startSession(new MemoryStorageDriver());

    expect(env.loadResult.status).toBe('fresh');
    // LoadingScene order.
    const rehydrated = env.systems.upgrades.rehydrate();
    const offline = env.systems.offline.settle();
    const unlocks = env.systems.progression.refreshUnlocks('smoke');

    expect(rehydrated).toEqual({ resumed: 0, completedOffline: 0 });
    expect(offline.skipReason).toBe('fresh-session');
    expect(Array.isArray(unlocks.stages)).toBe(true);

    // GameScene: build a world, unlock a building, accrue, save.
    unlockTestBuilding(env);
    env.clock.advance(45_000);
    env.systems.buildings.accrueAll();
    expect(env.systems.economy.getCoins()).toBeGreaterThan(100);

    expect(env.systems.save.save('smoke').ok).toBe(true);
    env.dispose();
  });

  it('continues a save across a session boundary and settles offline income', () => {
    const storage = new MemoryStorageDriver();

    // --- session 1: play for an hour of clock time ---------------------------
    const first = startSession(storage, T0);
    unlockTestBuilding(first);
    first.systems.economy.addCoins(250, 'test.earn');
    first.clock.advance(60 * 60 * 1000);
    first.systems.buildings.accrueAll();
    const coinsAtEndOfSession1 = first.systems.economy.getCoins();
    first.systems.save.save('session-end');
    first.dispose();

    // --- session 2: reopen 6 hours after the last save ----------------------
    const second = startSession(storage, T0 + HOUR);
    expect(second.loadResult.status).toBe('loaded');
    expect(second.systems.economy.getCoins()).toBe(coinsAtEndOfSession1);

    second.clock.advance(6 * HOUR);
    const summary = second.systems.offline.settle();

    expect(summary.skipped).toBe(false);
    expect(summary.elapsedMs).toBe(6 * HOUR);
    expect(summary.coins).toBeGreaterThan(0);
    expect(second.systems.economy.getCoins()).toBe(coinsAtEndOfSession1 + summary.coins);

    // The save file knows when the session ended, which is what offline maths depends on.
    expect(second.systems.save.getLastSavedAt()).not.toBeNull();
    second.dispose();
  });

  it('keeps every supported aspect ratio usable end to end', () => {
    const viewports = [
      { width: 720, height: 1280 },
      { width: 1080, height: 2160 },
      { width: 1170, height: 2532 },
      { width: 1920, height: 1080 },
    ];

    for (const viewport of viewports) {
      const metrics = computeLayoutMetrics(viewport);
      // Asserts the invariants every screen/panel relies on.
      expect(metrics.scale).toBeGreaterThan(0);
      expect(metrics.frameUnits.width).toBeCloseTo(720, 3);
      expect(metrics.frameUnits.height).toBeGreaterThanOrEqual(1280);
      expect(metrics.frame.width).toBeLessThanOrEqual(viewport.width + 0.001);
      expect(metrics.frame.height).toBeLessThanOrEqual(viewport.height + 0.001);
      expect(metrics.frame.x).toBeGreaterThanOrEqual(-0.001);
    }
  });

  it('survives a full reset mid-session without stale references', () => {
    const env = startSession(new MemoryStorageDriver());
    unlockTestBuilding(env);
    env.systems.upgrades.start('upgrade.test.cafe.1' as never); // costs 50 coins
    env.systems.economy.addCoins(9999, 'test.earn');
    expect(env.systems.economy.getCoins()).toBe(100 - 50 + 9999);

    env.systems.save.reset();

    // Systems hold a reference to the state object: after a reset they must observe the
    // fresh state, not a detached copy (the classic "reset did nothing" bug).
    expect(env.systems.economy.getCoins()).toBe(100);
    expect(env.systems.economy.getRecentTransactions().length).toBe(0);
    expect(env.systems.upgrades.isRunning('upgrade.test.cafe.1' as never)).toBe(false);
    expect(env.systems.buildings.isUnlocked('building.test.cafe' as never)).toBe(false);
    expect(env.state).toBe(env.systems.state);
    env.dispose();
  });

  it('restores the debug-visible invariants after a reload (no save/load drift)', () => {
    const storage = new MemoryStorageDriver();
    const first = startSession(storage, T0);
    unlockTestBuilding(first);
    first.systems.economy.addCoins(300, 'test.coins');
    first.systems.economy.addGems(5, 'test.gems');
    first.systems.upgrades.start('upgrade.test.cafe.1' as never);
    first.clock.advance(5_000);
    first.systems.save.save('drift-check');
    const before = {
      coins: first.systems.economy.getCoins(),
      gems: first.systems.economy.getGems(),
      remaining: Math.round(first.systems.upgrades.getRemainingMs('upgrade.test.cafe.1' as never) / 1000),
    };
    first.dispose();

    // Session 2 opens 5 seconds after the save: the job must resume with exactly the
    // remaining time it had, not restart and not jump forward.
    const second = startSession(storage, T0 + 5_000);
    second.systems.upgrades.rehydrate();

    expect(second.systems.economy.getCoins()).toBe(before.coins);
    expect(second.systems.economy.getGems()).toBe(before.gems);
    expect(Math.round(second.systems.upgrades.getRemainingMs('upgrade.test.cafe.1' as never) / 1000)).toBe(
      before.remaining,
    );
    second.dispose();
  });
});
