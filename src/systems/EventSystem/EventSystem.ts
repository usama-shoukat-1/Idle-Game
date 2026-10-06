import { DisposableBag } from '@/core/Disposable';
import { logger } from '@/core/Logger';
import { MAX_QUEUED_EVENTS_PER_FRAME } from '@/core/constants/GameConstants';
import type { GameClock } from '@/core/Time';
import type { EventBus, GameEventName, GameEventPayload } from '@/core/events/EventBus';

/**
 * EVENT SYSTEM
 * ============
 * Two jobs:
 *
 * 1. **Deferred dispatch.** Some reactions must not run inside the emitting system's
 *    call stack (e.g. an upgrade completing during a timer flush that then starts
 *    another upgrade). `emitLater` queues those and `flush()` drains a bounded number
 *    per frame, keeping frame time predictable on mobile.
 *
 * 2. **Scheduled windows.** Timestamp-based schedules for temporary world events
 *    (rush hours, festivals, boosts). Phase 0 ships no content here, but the timing
 *    primitives are the same ones everything else uses, so nothing needs rewriting
 *    when event content arrives.
 *
 * It is not a second event bus: everything still ends up on the single typed EventBus.
 */

interface QueuedEvent<K extends GameEventName = GameEventName> {
  readonly name: K;
  readonly payload: GameEventPayload<K>;
}

export interface ScheduledEvent<T = unknown> {
  readonly id: string;
  readonly data: T;
  readonly startsAt: number;
  readonly endsAt: number;
}

export class EventSystem {
  private readonly bag = new DisposableBag();
  private queue: QueuedEvent[] = [];
  private readonly schedules = new Map<string, ScheduledEvent>();

  constructor(
    private readonly events: EventBus,
    private readonly clock: GameClock,
  ) {}

  /** Queue an event for the next `flush()`. */
  emitLater<K extends GameEventName>(name: K, payload: GameEventPayload<K>): void {
    if (this.queue.length >= MAX_QUEUED_EVENTS_PER_FRAME * 4) {
      // A runaway producer must never grow the queue without bound.
      logger.warn('core', `event queue is full, dropping "${String(name)}"`);
      return;
    }
    this.queue.push({ name, payload } as QueuedEvent);
  }

  /** Drains up to `MAX_QUEUED_EVENTS_PER_FRAME` queued events. Returns how many ran. */
  flush(): number {
    if (this.queue.length === 0) return 0;
    const batch = this.queue.splice(0, MAX_QUEUED_EVENTS_PER_FRAME);
    for (const queued of batch) {
      this.events.emit(queued.name, queued.payload as never);
    }
    return batch.length;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  // --- Scheduled windows ---------------------------------------------------

  /** Schedules a window by absolute timestamps (never by "in N seconds"). */
  schedule<T>(event: ScheduledEvent<T>): void {
    if (event.endsAt <= event.startsAt) {
      logger.warn('core', `ignoring zero-length schedule "${event.id}"`);
      return;
    }
    this.schedules.set(event.id, event as ScheduledEvent);
  }

  cancelSchedule(id: string): boolean {
    return this.schedules.delete(id);
  }

  getSchedule<T>(id: string): ScheduledEvent<T> | null {
    return (this.schedules.get(id) as ScheduledEvent<T> | undefined) ?? null;
  }

  /** Schedules that are active right now. */
  getActiveSchedules(now = this.clock.now()): readonly ScheduledEvent[] {
    return [...this.schedules.values()].filter((event) => now >= event.startsAt && now < event.endsAt);
  }

  /** Removes finished schedules. Called once per frame - O(n) over a tiny map. */
  prune(now = this.clock.now()): number {
    let removed = 0;
    for (const [id, event] of [...this.schedules.entries()]) {
      if (now >= event.endsAt) {
        this.schedules.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  dispose(): void {
    this.queue = [];
    this.schedules.clear();
    this.bag.dispose();
  }
}
