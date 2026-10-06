/**
 * The single source of time for the whole game.
 *
 * Why this exists:
 * - Timers, offline progression and save timestamps must never be derived from
 *   frame counts or `performance.now()` deltas, because browser tab throttling,
 *   mobile suspension, device sleep and reloads all destroy that accuracy.
 *   Everything authoritative is derived from wall-clock epoch milliseconds.
 * - Tests need deterministic, controllable time, so the clock can be injected and
 *   overridden in a test/debug context.
 *
 * Usage rules (enforced by review, see docs/DEVELOPMENT_RULES.md):
 * - Gameplay/systems code calls `clock.now()`.
 * - `Date.now()` is only acceptable inside this module.
 */
export interface GameClock {
  /** Current wall-clock time in epoch milliseconds. */
  now(): number;
  /** Monotonic time used for animation/perf numbers only - never for saved state. */
  monotonic(): number;
}

export class SystemClock implements GameClock {
  now(): number {
    return Date.now();
  }

  monotonic(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }
}

/** Clock with a manually controlled `now`, used by tests and debug tooling. */
export class ManualClock implements GameClock {
  private current: number;
  private mono = 0;

  constructor(startEpochMs = 1_700_000_000_000) {
    this.current = startEpochMs;
  }

  now(): number {
    return this.current;
  }

  monotonic(): number {
    return this.mono;
  }

  /** Advance the clock by `ms` (negative values are allowed: useful for testing guards). */
  advance(ms: number): void {
    this.current += ms;
    this.mono += Math.max(0, ms);
  }

  set(epochMs: number): void {
    this.current = epochMs;
  }
}

export const clock: GameClock = new SystemClock();
