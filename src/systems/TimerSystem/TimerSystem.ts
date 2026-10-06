import { DisposableBag } from '@/core/Disposable';
import { logger } from '@/core/Logger';
import type { GameClock } from '@/core/Time';
import { clamp } from '@/core/utils/NumberUtils';

/**
 * REUSABLE TIMER SYSTEM
 * =====================
 * Every countdown in the game - construction, upgrades, temporary boosts, event
 * windows, future automation - is a *timestamp* pair, never a frame accumulator.
 *
 * Why that matters: a phone can suspend the WebGL context, a browser can throttle a
 * background tab to 1 fps, and a player can reload mid-upgrade. Because a timer only
 * stores `startedAt` + `completesAt` (epoch ms), the remaining time is always
 * `completesAt - clock.now()`. Suspension therefore costs no accuracy, and a timer can
 * be rehydrated from a save by re-registering the same key.
 *
 * Ownership note: TimerSystem is deliberately *runtime only*. Systems that need their
 * timers to survive a reload (UpgradeSystem) persist the job data in `GameState` and
 * re-register it on load. That keeps one owner per fact instead of two competing
 * sources of truth.
 */

export type TimerKey = string;

export interface TimerSchedule {
  readonly key: TimerKey;
  readonly startedAt: number;
  readonly completesAt: number;
  readonly durationMs: number;
  /** Free-form tag for debugging/telemetry (`upgrade`, `boost`, `event`, ...). */
  readonly label: string;
}

export interface TimerStatus extends TimerSchedule {
  readonly remainingMs: number;
  readonly elapsedMs: number;
  /** 0..1 */
  readonly progress: number;
  readonly isComplete: boolean;
}

export interface TimerStartOptions {
  readonly label?: string;
  /** Called exactly once, when the timer becomes due (via `tick()` or `update()`). */
  readonly onComplete?: (schedule: TimerSchedule) => void;
  /** Original start timestamp (used when rehydrating a save). Defaults to now. */
  readonly startedAt?: number;
  /**
   * Absolute deadline. When rehydrating, pass this so the deadline is preserved exactly;
   * without it the duration would be re-derived from `startedAt` and drift.
   */
  readonly completesAt?: number;
}

interface TimerEntry extends Omit<TimerSchedule, 'completesAt'> {
  /** Mutable so boosts/speed-ups can move the deadline without replacing the entry. */
  completesAt: number;
  readonly onComplete?: (schedule: TimerSchedule) => void;
}

interface MutableTimerEntry {
  completesAt: number;
}

export class TimerSystem {
  private readonly timers = new Map<TimerKey, TimerEntry>();
  private readonly bag = new DisposableBag();

  constructor(private readonly clock: GameClock) {}

  /**
   * Starts (or restarts) a timer for `key`.
   * Restarting an existing key replaces it - call sites that need uniqueness should
   * derive the key from the owning entity (e.g. `upgrade:<id>`).
   */
  start(key: TimerKey, durationMs: number, options: TimerStartOptions = {}): TimerSchedule {
    const startedAt = options.startedAt ?? this.clock.now();
    const completesAt = Math.max(startedAt, Math.floor(options.completesAt ?? startedAt + Math.max(0, durationMs)));
    const entry: TimerEntry = {
      key,
      label: options.label ?? 'timer',
      startedAt,
      completesAt,
      durationMs: completesAt - startedAt,
      onComplete: options.onComplete,
    };
    this.timers.set(key, entry);

    // A zero-length timer is completed immediately by the next tick, which keeps
    // ordering deterministic (callbacks never run inside `start`).
    return entry;
  }

  /** Registers a timer that was already running before a reload. */
  restore(schedule: TimerSchedule, onComplete?: (schedule: TimerSchedule) => void): void {
    this.timers.set(schedule.key, { ...schedule, onComplete });
  }

  has(key: TimerKey): boolean {
    return this.timers.has(key);
  }

  getStatus(key: TimerKey): TimerStatus | null {
    const entry = this.timers.get(key);
    if (!entry) return null;
    return this.describe(entry);
  }

  getRemainingMs(key: TimerKey): number {
    const entry = this.timers.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.completesAt - this.clock.now());
  }

  isRunning(key: TimerKey): boolean {
    const entry = this.timers.get(key);
    return entry ? this.clock.now() < entry.completesAt : false;
  }

  list(): readonly TimerStatus[] {
    return [...this.timers.values()].map((entry) => this.describe(entry));
  }

  /** Adds time to a running timer (boosts, slow-downs). */
  extend(key: TimerKey, extraMs: number): boolean {
    const entry = this.timers.get(key) as MutableTimerEntry | undefined;
    if (!entry) return false;
    entry.completesAt += Math.max(0, Math.floor(extraMs));
    return true;
  }

  /**
   * Removes time from a running timer (rewarded-ad speed-ups, gem acceleration).
   * Never moves `completesAt` before `startedAt`, so progress stays within 0..1.
   */
  reduce(key: TimerKey, reduceMs: number): boolean {
    const entry = this.timers.get(key) as (MutableTimerEntry & { startedAt: number }) | undefined;
    if (!entry) return false;
    entry.completesAt = Math.max(entry.startedAt, entry.completesAt - Math.max(0, Math.floor(reduceMs)));
    return true;
  }

  /** Jumps a timer to its completion time; the next tick fires the callback. */
  finishNow(key: TimerKey): boolean {
    const entry = this.timers.get(key) as MutableTimerEntry | undefined;
    if (!entry) return false;
    entry.completesAt = this.clock.now();
    this.flushDue();
    return true;
  }

  /** Cancels without firing the completion callback. */
  cancel(key: TimerKey): boolean {
    return this.timers.delete(key);
  }

  /**
   * Completes every due timer. Called once per frame by the owning scene (cheap: only
   * due timers run their callback, and callbacks never allocate per frame).
   */
  tick(): number {
    return this.flushDue();
  }

  dispose(): void {
    this.timers.clear();
    this.bag.dispose();
  }

  private flushDue(): number {
    const now = this.clock.now();
    let completed = 0;

    // Snapshot keys first: completion callbacks are allowed to start/cancel timers.
    for (const [key, entry] of [...this.timers.entries()]) {
      if (now < entry.completesAt) continue;
      this.timers.delete(key);
      completed += 1;
      if (!entry.onComplete) continue;
      try {
        entry.onComplete(entry);
      } catch (error) {
        logger.error('timer', `completion callback for "${key}" threw`, error);
      }
    }

    return completed;
  }

  private describe(entry: TimerEntry): TimerStatus {
    const now = this.clock.now();
    const remainingMs = Math.max(0, entry.completesAt - now);
    // Derived from the deadline (not from `now - startedAt`) so a timer that was extended or
    // shortened still reports a monotonic, in-range progress.
    const elapsedMs = clamp(entry.durationMs - remainingMs, 0, entry.durationMs);
    const progress = entry.durationMs > 0 ? clamp(1 - remainingMs / entry.durationMs, 0, 1) : 1;
    return {
      key: entry.key,
      label: entry.label,
      startedAt: entry.startedAt,
      completesAt: entry.completesAt,
      durationMs: entry.durationMs,
      elapsedMs,
      remainingMs,
      progress,
      isComplete: remainingMs === 0,
    };
  }
}

/** Stable key builders so timers can never collide across systems. */
export const timerKeys = {
  upgrade: (upgradeId: string): TimerKey => `upgrade:${upgradeId}`,
  buildingRestore: (buildingId: string): TimerKey => `building:restore:${buildingId}`,
  boost: (boostId: string): TimerKey => `boost:${boostId}`,
  event: (eventId: string): TimerKey => `event:${eventId}`,
  automation: (workerId: string): TimerKey => `automation:${workerId}`,
} as const;
