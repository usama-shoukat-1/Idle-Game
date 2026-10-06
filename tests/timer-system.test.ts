import { describe, expect, it, vi } from 'vitest';

import { ManualClock } from '@/core/Time';
import { TimerSystem, timerKeys } from '@/systems/TimerSystem/TimerSystem';

/**
 * Timer guarantees: a timer is a pair of timestamps, so its remaining time is correct after
 * any amount of "suspension" - including a clock that jumps hours forward or backwards.
 */
describe('TimerSystem', () => {
  function createTimers(): { clock: ManualClock; timers: TimerSystem } {
    const clock = new ManualClock(1_000_000);
    return { clock, timers: new TimerSystem(clock) };
  }

  it('reports remaining time from wall-clock timestamps, not frame counts', () => {
    const { clock, timers } = createTimers();
    timers.start('upgrade:a', 30_000);

    expect(timers.getRemainingMs('upgrade:a')).toBe(30_000);

    // Simulate a suspended tab / backgrounded phone: no ticks happen, time passes.
    clock.advance(12_000);
    expect(timers.getRemainingMs('upgrade:a')).toBe(18_000);
    expect(timers.getStatus('upgrade:a')?.elapsedMs).toBe(12_000);
    expect(timers.getStatus('upgrade:a')?.progress).toBeCloseTo(0.4, 5);
  });

  it('fires completion callbacks exactly once when due', () => {
    const { clock, timers } = createTimers();
    const onComplete = vi.fn();
    timers.start('upgrade:b', 5_000, { onComplete, label: 'upgrade' });

    clock.advance(4_999);
    expect(timers.tick()).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();

    clock.advance(1);
    expect(timers.tick()).toBe(1);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Ticking again must not re-fire it.
    clock.advance(10_000);
    expect(timers.tick()).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(timers.has('upgrade:b')).toBe(false);
  });

  it('completes a long overdue timer immediately (offline upgrade case)', () => {
    const { clock, timers } = createTimers();
    const onComplete = vi.fn();
    timers.start('upgrade:c', 60_000, { onComplete });

    clock.advance(6 * 60 * 60 * 1000); // six hours "away"
    expect(timers.tick()).toBe(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('never reports negative remaining time when the clock moves backwards', () => {
    const { clock, timers } = createTimers();
    timers.start('boost:x', 20_000);
    clock.advance(-5_000);

    expect(timers.getRemainingMs('boost:x')).toBeGreaterThanOrEqual(20_000);
    expect(timers.getStatus('boost:x')?.elapsedMs).toBe(0);
    expect(timers.getStatus('boost:x')?.progress).toBe(0);
  });

  it('supports reduce/extend (speed-ups and boosts) without breaking progress bounds', () => {
    const { clock, timers } = createTimers();
    timers.start('upgrade:d', 60_000);

    timers.reduce('upgrade:d', 30_000);
    expect(timers.getRemainingMs('upgrade:d')).toBe(30_000);

    timers.extend('upgrade:d', 30_000);
    expect(timers.getRemainingMs('upgrade:d')).toBe(60_000);

    // Reducing past the start clamps instead of inverting the timer.
    timers.reduce('upgrade:d', 999_999);
    expect(timers.getRemainingMs('upgrade:d')).toBe(0);
    expect(timers.getStatus('upgrade:d')?.progress).toBe(1);

    clock.advance(1);
    expect(timers.tick()).toBe(1);
  });

  it('finishes a timer on demand (debug tools / gem acceleration)', () => {
    const { timers } = createTimers();
    const onComplete = vi.fn();
    timers.start('upgrade:e', 10 * 60_000, { onComplete });

    expect(timers.finishNow('upgrade:e')).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(timers.has('upgrade:e')).toBe(false);
  });

  it('cancels without firing the callback', () => {
    const { timers } = createTimers();
    const onComplete = vi.fn();
    timers.start('upgrade:f', 1_000, { onComplete });

    expect(timers.cancel('upgrade:f')).toBe(true);
    expect(timers.tick()).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('keeps independent timers isolated and survives a throwing callback', () => {
    const { clock, timers } = createTimers();
    const survivor = vi.fn();

    timers.start('event:a', 1_000, {
      onComplete: () => {
        throw new Error('boom');
      },
    });
    timers.start('event:b', 1_000, { onComplete: survivor });

    clock.advance(1_000);
    expect(timers.tick()).toBe(2);
    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it('builds stable keys so different systems cannot collide', () => {
    expect(timerKeys.upgrade('u1')).toBe('upgrade:u1');
    expect(timerKeys.buildingRestore('b1')).toBe('building:restore:b1');
    expect(timerKeys.boost('b2')).toBe('boost:b2');
    expect(new Set([timerKeys.upgrade('x'), timerKeys.boost('x'), timerKeys.event('x')]).size).toBe(3);
  });
});
