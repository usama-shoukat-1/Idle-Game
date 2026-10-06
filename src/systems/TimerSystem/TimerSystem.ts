/**
 * Timestamp-based timer system.
 *
 * A timer stores `startedAt` / `endsAt` / `durationMs` only - never a per-frame
 * counter - so backgrounding the browser, locking a phone or reloading the page
 * cannot desync it. `update()` is a cheap comparison over running timers; when the
 * date passes `endsAt` the timer completes exactly once.
 */

import type { Clock } from '@/core/Clock';
import type { TimerId } from '@/core/types/ids';
import type { TimerProgress, TimerStartRequest, TimerState, TimerStatus } from '@/core/types/timers';
import { sanitizeDuration, sanitizeTimestamp } from '@/core/utils/time';
import { createIdFactory } from '@/core/utils/ids';
import { createLogger } from '@/core/utils/logger';
import type { GameEventBus } from '@/systems/EventSystem';
import type { GameStateStore } from '@/core/state/GameStateStore';

export interface TimerSystemDeps {
  store: GameStateStore;
  events: GameEventBus;
  clock: Clock;
  /** Throttle for `timer:progress` emissions (UI repaint budget). */
  progressIntervalMs?: number;
}

export class TimerSystem {
  private readonly log = createLogger('timers');
  private readonly nextTimerId = createIdFactory('timer');
  private readonly completions = new Map<TimerId, (timer: TimerState) => void>();
  private lastProgressEmitAt = 0;

  constructor(private readonly deps: TimerSystemDeps) {}

  /* --------------------------------------------------------------- queries */

  get(id: TimerId): TimerState | null {
    return this.deps.store.state.timers[id] ?? null;
  }

  getAll(status?: TimerStatus): TimerState[] {
    const timers = Object.values(this.deps.store.state.timers);
    const filtered = status ? timers.filter((timer) => timer.status === status) : timers;
    return filtered.sort((a, b) => a.endsAt - b.endsAt);
  }

  getByKind(kind: TimerState['kind'], status: TimerStatus = 'running'): TimerState[] {
    return this.getAll(status).filter((timer) => timer.kind === kind);
  }

  getByTarget(targetId: string, status?: TimerStatus): TimerState[] {
    return this.getAll(status).filter((timer) => timer.targetId === targetId);
  }

  getRemainingMs(id: TimerId, at = this.deps.clock.now()): number {
    const timer = this.get(id);
    if (!timer) return 0;
    if (timer.status === 'completed' || timer.status === 'cancelled') return 0;
    if (timer.status === 'paused') return sanitizeDuration(timer.pausedRemainingMs, 0);
    return Math.max(0, timer.endsAt - at);
  }

  getProgress(id: TimerId, at = this.deps.clock.now()): TimerProgress | null {
    const timer = this.get(id);
    if (!timer) return null;
    const remainingMs = this.getRemainingMs(id, at);
    const elapsedMs = Math.max(0, timer.durationMs - remainingMs);
    const normalized = timer.durationMs > 0 ? Math.min(1, elapsedMs / timer.durationMs) : 1;
    return { id, status: timer.status, remainingMs, elapsedMs, normalized };
  }

  /** True when the timer is due right now (used by UI + tests). */
  isDue(id: TimerId, at = this.deps.clock.now()): boolean {
    const timer = this.get(id);
    if (!timer || timer.status !== 'running') return false;
    return at >= timer.endsAt;
  }

  /* ---------------------------------------------------------------- writes */

  start(request: TimerStartRequest): TimerState {
    const now = this.deps.clock.now();
    const durationMs = sanitizeDuration(request.durationMs, 0);
    const id = request.id ?? this.nextTimerId();
    const timer: TimerState = {
      id,
      kind: request.kind,
      label: request.label,
      status: 'running',
      startedAt: now,
      endsAt: now + durationMs,
      durationMs,
      createdAt: now,
      updatedAt: now,
      ...(request.targetId ? { targetId: request.targetId } : {}),
      ...(request.meta ? { meta: { ...request.meta } } : {}),
    };

    this.deps.store.update((state) => {
      state.timers[id] = timer;
    }, now);

    if (request.onComplete) this.completions.set(id, request.onComplete);
    this.deps.events.emit('timer:started', { timer: { ...timer } });
    return timer;
  }

  pause(id: TimerId): TimerState | null {
    const timer = this.get(id);
    if (!timer || timer.status !== 'running') return null;
    const now = this.deps.clock.now();
    const remaining = Math.max(0, timer.endsAt - now);
    const next: TimerState = { ...timer, status: 'paused', pausedRemainingMs: remaining, updatedAt: now };
    this.write(id, next, now);
    this.deps.events.emit('timer:paused', { timer: { ...next } });
    return next;
  }

  resume(id: TimerId): TimerState | null {
    const timer = this.get(id);
    if (!timer || timer.status !== 'paused') return null;
    const now = this.deps.clock.now();
    const remaining = sanitizeDuration(timer.pausedRemainingMs, 0);
    const next: TimerState = {
      ...timer,
      status: 'running',
      endsAt: now + remaining,
      pausedRemainingMs: undefined,
      updatedAt: now,
    };
    this.write(id, next, now);
    this.deps.events.emit('timer:resumed', { timer: { ...next } });
    return next;
  }

  cancel(id: TimerId, reason = 'cancelled'): TimerState | null {
    const timer = this.get(id);
    if (!timer || timer.status === 'completed' || timer.status === 'cancelled') return null;
    const now = this.deps.clock.now();
    const next: TimerState = { ...timer, status: 'cancelled', updatedAt: now };
    this.write(id, next, now);
    this.completions.delete(id);
    this.deps.events.emit('timer:cancelled', { timer: { ...next }, reason });
    return next;
  }

  /** Instantly finish a timer (instant upgrades, debug "finish timers"). */
  completeNow(id: TimerId): TimerState | null {
    const timer = this.get(id);
    if (!timer || timer.status === 'completed') return null;
    return this.finish(id, this.deps.clock.now());
  }

  /** Shorten a running timer (rewarded-ad "upgrade time reduction"). */
  reduceTime(id: TimerId, ms: number): TimerState | null {
    const timer = this.get(id);
    if (!timer || timer.status !== 'running') return null;
    const reduction = Math.max(0, sanitizeDuration(ms, 0));
    const now = this.deps.clock.now();
    const endsAt = timer.endsAt - reduction;
    const next: TimerState = {
      ...timer,
      endsAt,
      durationMs: Math.max(1, timer.durationMs - reduction),
      updatedAt: now,
    };
    this.write(id, next, now);
    if (endsAt <= now) return this.finish(id, now);
    return next;
  }

  extendTime(id: TimerId, ms: number): TimerState | null {
    const timer = this.get(id);
    if (!timer || timer.status !== 'running') return null;
    const extension = Math.max(0, sanitizeDuration(ms, 0));
    const now = this.deps.clock.now();
    const next: TimerState = {
      ...timer,
      endsAt: timer.endsAt + extension,
      durationMs: timer.durationMs + extension,
      updatedAt: now,
    };
    this.write(id, next, now);
    return next;
  }

  /**
   * Advance every running timer to `at`, completing those that are due.
   * Called once per frame with the current time and once on load (offline catch-up).
   */
  update(at = this.deps.clock.now()): TimerId[] {
    const running = this.getAll('running');
    if (running.length === 0) return [];

    const completed: TimerId[] = [];
    for (const timer of running) {
      if (at >= timer.endsAt) {
        this.finish(timer.id, at);
        completed.push(timer.id);
      }
    }

    if (completed.length === 0 && at - this.lastProgressEmitAt >= (this.deps.progressIntervalMs ?? 250)) {
      this.lastProgressEmitAt = at;
      for (const timer of running) {
        const progress = this.getProgress(timer.id, at);
        if (progress) this.deps.events.emit('timer:progress', { timer: { ...timer }, progress });
      }
    }

    return completed;
  }

  /** Convenience for offline catch-up: same as `update(now)` but explicit. */
  advanceTo(at: number): TimerId[] {
    return this.update(at);
  }

  /** Remove finished timers from the persisted state (housekeeping). */
  purgeFinished(olderThanMs = 0, at = this.deps.clock.now()): number {
    const removable = Object.values(this.deps.store.state.timers).filter(
      (timer) =>
        (timer.status === 'completed' || timer.status === 'cancelled') &&
        timer.updatedAt + olderThanMs <= at,
    );
    if (removable.length === 0) return 0;
    const removableIds = new Set(removable.map((timer) => timer.id));
    this.deps.store.update((state) => {
      for (const timer of removable) delete state.timers[timer.id];
      // Drop active-upgrade bookkeeping that pointed at a purged timer.
      for (const [upgradeId, active] of Object.entries(state.upgrades.active)) {
        if (removableIds.has(active.timerId)) delete state.upgrades.active[upgradeId];
      }
    }, at);
    return removable.length;
  }

  /* ------------------------------------------------------------- internals */

  private write(id: TimerId, timer: TimerState, at: number): void {
    this.deps.store.update((state) => {
      state.timers[id] = timer;
    }, at);
  }

  private finish(id: TimerId, at: number): TimerState | null {
    const timer = this.get(id);
    if (!timer || timer.status === 'completed') return null;
    const finished: TimerState = { ...timer, status: 'completed', endsAt: Math.min(timer.endsAt, at), updatedAt: at };
    this.log.debug(`timer ${id} (${timer.kind}) completed`);
    this.write(id, finished, at);

    const callback = this.completions.get(id);
    this.completions.delete(id);
    if (callback) {
      try {
        callback({ ...finished });
      } catch (error) {
        this.log.error(`completion callback for ${id} threw`, error);
      }
    }

    this.deps.events.emit('timer:completed', { timer: { ...finished } });
    return finished;
  }

  /** Test/teardown helper: drops session-only completion callbacks. */
  clearCallbacks(): void {
    this.completions.clear();
  }

  /** Validate a timestamp sourced from outside the system (offline catch-up). */
  static safeTimestamp(value: unknown, fallback: number): number {
    return sanitizeTimestamp(value, fallback);
  }
}
