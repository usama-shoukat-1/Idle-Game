/**
 * Typed synchronous event bus.
 *
 * Systems publish facts ("timer completed", "coins changed") and the UI listens.
 * This keeps simulation code free of rendering references and lets any system be
 * tested without Phaser.
 */

import { createLogger } from '@/core/utils/logger';
import type { GameEventMap } from '@/core/types/events';

export type EventHandler<TPayload> = (payload: TPayload) => void;

export interface Subscription {
  off(): void;
}

type AnyHandler = (payload: never) => void;

export class TypedEventBus<TMap extends object> {
  private readonly handlers = new Map<keyof TMap, Set<AnyHandler>>();
  private readonly log = createLogger('events');
  /** Set while draining, so unsubscribing mid-emit is safe. */
  private emitting = false;

  on<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): Subscription {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as AnyHandler);
    return { off: () => this.off(event, handler) };
  }

  once<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): Subscription {
    const subscription = this.on(event, (payload) => {
      subscription.off();
      handler(payload);
    });
    return subscription;
  }

  off<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as AnyHandler);
    if (set.size === 0) this.handlers.delete(event);
  }

  emit<K extends keyof TMap>(event: K, payload: TMap[K]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    this.emitting = true;
    try {
      // Snapshot: handlers may subscribe/unsubscribe while reacting.
      for (const handler of [...set]) {
        try {
          (handler as EventHandler<TMap[K]>)(payload);
        } catch (error) {
          this.log.error(`handler for "${String(event)}" threw`, error);
        }
      }
    } finally {
      this.emitting = false;
    }
  }

  listenerCount<K extends keyof TMap>(event: K): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  removeAll(event?: keyof TMap): void {
    if (event) this.handlers.delete(event);
    else this.handlers.clear();
  }

  get isEmitting(): boolean {
    return this.emitting;
  }
}

export type GameEventBus = TypedEventBus<GameEventMap>;

export function createGameEventBus(): GameEventBus {
  return new TypedEventBus<GameEventMap>();
}
