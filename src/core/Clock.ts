/**
 * Clock abstraction.
 *
 * Every timestamp-based system takes a Clock instead of calling `Date.now()`
 * directly. That keeps timers/offline-progression deterministic under test and
 * leaves room for a server-synced clock later.
 */

export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** Test/dev clock with manual control. */
export class ManualClock implements Clock {
  constructor(private current: number = 0) {}

  now(): number {
    return this.current;
  }

  setTo(timestamp: number): void {
    this.current = timestamp;
  }

  advance(ms: number): number {
    this.current += Math.max(0, ms);
    return this.current;
  }
}

/**
 * A clock whose offset can be adjusted (e.g. after comparing with a server).
 * Offsets are clamped to a sane band; a hostile offset should not break timers.
 */
export class OffsetClock implements Clock {
  private offsetMs = 0;

  constructor(private readonly base: Clock = new SystemClock()) {}

  now(): number {
    return this.base.now() + this.offsetMs;
  }

  setOffset(offsetMs: number): void {
    const MAX_OFFSET = 24 * 60 * 60 * 1000;
    this.offsetMs = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, offsetMs));
  }

  get offset(): number {
    return this.offsetMs;
  }
}
