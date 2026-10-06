import { describe, expect, it } from 'vitest';
import { createTestHarness, TEST_START_TIME } from './helpers/fixtures';
import { computeElapsed, sanitizeTimestamp } from '@/core/utils/time';

describe('TimerSystem', () => {
  it('is timestamp based, not frame based', () => {
    const { context, clock } = createTestHarness();
    const timer = context.timers.start({ kind: 'upgrade', label: 'test', durationMs: 60_000 });

    expect(timer.startedAt).toBe(TEST_START_TIME);
    expect(timer.endsAt).toBe(TEST_START_TIME + 60_000);
    expect(context.timers.getRemainingMs(timer.id)).toBe(60_000);

    // Jumping the wall clock (backgrounded tab, sleeping phone) must work.
    clock.advance(45_000);
    expect(context.timers.getRemainingMs(timer.id)).toBe(15_000);
    expect(context.timers.getProgress(timer.id)?.normalized).toBeCloseTo(0.75, 5);
  });

  it('completes exactly once when the timestamp passes', () => {
    const { context, clock } = createTestHarness();
    const timer = context.timers.start({ kind: 'construction', label: 'build', durationMs: 1_000 });

    let completions = 0;
    context.events.on('timer:completed', () => {
      completions += 1;
    });

    clock.advance(500);
    expect(context.timers.update()).toEqual([]);

    clock.advance(600);
    expect(context.timers.update()).toEqual([timer.id]);
    expect(context.timers.update()).toEqual([]);
    expect(completions).toBe(1);
    expect(context.timers.get(timer.id)?.status).toBe('completed');
  });

  it('supports pause/resume without losing time', () => {
    const { context, clock } = createTestHarness();
    const timer = context.timers.start({ kind: 'boost', label: 'boost', durationMs: 10_000 });

    clock.advance(4_000);
    context.timers.pause(timer.id);
    expect(context.timers.getRemainingMs(timer.id)).toBe(6_000);

    clock.advance(60_000); // time passes while paused
    expect(context.timers.getRemainingMs(timer.id)).toBe(6_000);

    context.timers.resume(timer.id);
    expect(context.timers.get(timer.id)?.status).toBe('running');
    clock.advance(6_000);
    expect(context.timers.update()).toEqual([timer.id]);
  });

  it('reduces and extends running timers (rewarded-ad hooks)', () => {
    const { context } = createTestHarness();
    const timer = context.timers.start({ kind: 'upgrade', label: 'long', durationMs: 3_600_000 });

    context.timers.reduceTime(timer.id, 600_000);
    expect(context.timers.getRemainingMs(timer.id)).toBe(3_000_000);

    context.timers.extendTime(timer.id, 300_000);
    expect(context.timers.getRemainingMs(timer.id)).toBe(3_300_000);

    context.timers.reduceTime(timer.id, 10_000_000);
    expect(context.timers.get(timer.id)?.status).toBe('completed');
  });

  it('cancels timers and can purge finished ones', () => {
    const { context } = createTestHarness();
    const timer = context.timers.start({ kind: 'custom', label: 'cancel me', durationMs: 1_000 });
    context.timers.cancel(timer.id, 'test');
    expect(context.timers.get(timer.id)?.status).toBe('cancelled');

    const done = context.timers.start({ kind: 'custom', label: 'finish me', durationMs: 0 });
    context.timers.completeNow(done.id);
    expect(context.timers.purgeFinished()).toBeGreaterThanOrEqual(1);
    expect(context.timers.get(done.id)).toBeNull();
  });

  it('keeps timers serializable for the save file', () => {
    const { context } = createTestHarness();
    const timer = context.timers.start({
      kind: 'upgrade',
      label: 'serialize',
      durationMs: 5_000,
      targetId: 'building.test-shop',
      meta: { upgradeId: 'upgrade.test.clean' },
    });

    const persisted = JSON.parse(JSON.stringify(context.state.state.timers)) as Record<string, unknown>;
    expect(persisted[timer.id]).toMatchObject({ kind: 'upgrade', status: 'running', durationMs: 5_000 });
  });
});

describe('timestamp helpers', () => {
  it('protects against invalid offline timestamps', () => {
    const now = 1_000_000;

    expect(computeElapsed(-5, now).elapsedMs).toBe(0);
    expect(computeElapsed(-5, now).wasInvalid).toBe(true);
    expect(computeElapsed(Number.NaN, now).elapsedMs).toBe(0);
    expect(computeElapsed(Number.POSITIVE_INFINITY, now).elapsedMs).toBe(0);
    // A future timestamp (clock tampering) is discarded, not credited.
    expect(computeElapsed(now + 60 * 60 * 1000, now).elapsedMs).toBe(0);
    expect(computeElapsed(now - 5_000, now).elapsedMs).toBe(5_000);
  });

  it('caps the credited window', () => {
    const now = 1_700_000_000_000;
    const result = computeElapsed(now - 86_400_000, now, { maxMs: 60_000 });

    expect(result.elapsedMs).toBe(86_400_000);
    expect(result.cappedMs).toBe(60_000);
    expect(result.wasCapped).toBe(true);
  });

  it('sanitizes garbage timestamps to a fallback', () => {
    expect(sanitizeTimestamp(undefined, 42)).toBe(42);
    expect(sanitizeTimestamp(-1, 42)).toBe(42);
    expect(sanitizeTimestamp(Number.NaN, 42)).toBe(42);
    expect(sanitizeTimestamp(1_000, 42)).toBe(1_000);
  });
});
