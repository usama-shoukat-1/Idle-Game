import { logger } from '@/core/Logger';
import { clamp } from '@/core/utils/NumberUtils';

/**
 * Synchronous, typed event bus - the backbone of the "event-driven updates" rule.
 *
 * Systems announce *what happened* (a domain event); UI and other systems react.
 * Nobody polls game state in an update loop, and no scene reaches into another
 * system's internals.
 *
 * Design notes:
 * - Synchronous delivery keeps ordering obvious and avoids microtask surprises
 *   during save/load; handlers must therefore stay cheap (no heavy work, no layout
 *   thrash). Anything expensive belongs in a queued system, not in a handler.
 * - A handler may unsubscribe during dispatch; that is safe.
 * - Payload types are declared in `src/core/types/events.ts` and filled in by
 *   systems as they are implemented (`EventBusRegistry`).
 */

export type EventHandler<T> = (payload: T) => void;

export interface EventBusRegistry {
  // --- Engine / meta --------------------------------------------------------
  'engine:ready': { readonly buildStamp: string };
  'engine:save-requested': { readonly reason: string };

  // --- Economy -------------------------------------------------------------
  'economy:coins-changed': {
    readonly delta: number;
    readonly balance: number;
    readonly reason: string;
  };
  'economy:gems-changed': {
    readonly delta: number;
    readonly balance: number;
    readonly reason: string;
  };
  'economy:transaction-rejected': {
    readonly currency: 'coins' | 'gems';
    readonly requested: number;
    readonly balance: number;
    readonly reason: string;
  };

  // --- Buildings / upgrades ------------------------------------------------
  'building:unlocked': { readonly buildingId: string; readonly stageId: string };
  'building:tier-changed': {
    readonly buildingId: string;
    readonly tier: number;
    readonly visualState: string;
  };
  'building:income-accrued': {
    readonly buildingId: string;
    readonly coins: number;
    readonly elapsedMs: number;
  };
  'upgrade:started': {
    readonly upgradeId: string;
    readonly buildingId: string;
    readonly completesAt: number;
  };
  'upgrade:completed': {
    readonly upgradeId: string;
    readonly buildingId: string;
    readonly tier: number;
  };
  'upgrade:cancelled': { readonly upgradeId: string; readonly buildingId: string };
  /** A running job was shortened (gems, rewarded ad, debug). */
  'upgrade:speed-up': {
    readonly upgradeId: string;
    readonly source: 'gems' | 'ad' | 'debug';
    /** Milliseconds actually removed. */
    readonly appliedMs: number;
  };
  /** A building reached its final tier (drives the completion celebration). */
  'building:completed': {
    readonly buildingId: string;
    readonly totalCost: number;
    readonly incomePerMinute: number;
  };

  // --- Temporary boosts ----------------------------------------------------
  'boost:applied': {
    readonly boostId: string;
    readonly kind: string;
    readonly amount: number;
    readonly expiresAt: number;
    readonly source: string;
    /** True when an already-running boost was extended instead of created. */
    readonly extended: boolean;
  };
  'boost:expired': { readonly count: number };

  // --- Progression ---------------------------------------------------------
  'stage:unlocked': { readonly stageId: string };
  'mastery:changed': { readonly stageId: string; readonly mastery: number };

  // --- Economy side channels ----------------------------------------------
  'offline:summary-ready': {
    readonly elapsedMs: number;
    readonly coins: number;
    readonly cappedAtMs: number;
  };
  /** The player collected the pending offline reward (`doubled` when a rewarded ad was used). */
  'offline:collected': {
    readonly coins: number;
    readonly baseCoins: number;
    readonly doubled: boolean;
    readonly elapsedMs: number;
  };

  // --- Audio / UI / input --------------------------------------------------
  'audio:play': { readonly key: string; readonly volume?: number };
  'audio:settings-changed': {
    readonly master: number;
    readonly music: number;
    readonly sfx: number;
    readonly muted: boolean;
  };
  'ui:toast': { readonly message: string; readonly variant?: 'info' | 'success' | 'warning' | 'error' };

  // --- Monetization (provider-independent) ---------------------------------
  /** Emitted when the player explicitly opts in (before the provider is asked). */
  'ads:reward-requested': { readonly placementId: string; readonly rewardId: string };
  'ads:reward-granted': {
    readonly placementId: string;
    readonly rewardId: string;
    readonly amount: number;
  };
  'ads:reward-failed': {
    readonly placementId: string;
    readonly rewardId: string;
    readonly status: string;
  };
  'purchase:started': { readonly productId: string };
  'purchase:completed': { readonly productId: string; readonly currency: string; readonly amount: number };
  'purchase:failed': { readonly productId: string; readonly status: string };

  // --- Tutorial ------------------------------------------------------------
  'tutorial:step': { readonly stepId: string; readonly index: number; readonly total: number };
  'tutorial:completed': { readonly skipped: boolean };

  // --- Analytics -----------------------------------------------------------
  /**
   * Normalised, provider-independent analytics event. Gameplay code never talks to an
   * SDK; an AnalyticsService implementation (dev console today, a real SDK later)
   * subscribes here. See docs/DEVELOPMENT_RULES.md for the naming contract.
   */
  'analytics:track': {
    readonly name: string;
    readonly props: Readonly<Record<string, string | number | boolean>>;
  };

  // --- Debug ---------------------------------------------------------------
  'debug:state-changed': { readonly summary: string };
}

export type GameEventName = keyof EventBusRegistry;
export type GameEventPayload<K extends GameEventName> = EventBusRegistry[K];

interface Subscription {
  readonly handler: EventHandler<never>;
  readonly once: boolean;
}

export class EventBus {
  private readonly listeners = new Map<GameEventName, Subscription[]>();

  /** Subscribe for the lifetime of the caller. Returns an unsubscribe function. */
  on<K extends GameEventName>(event: K, handler: EventHandler<GameEventPayload<K>>): () => void {
    return this.subscribe(event, handler as EventHandler<never>, false);
  }

  /** Subscribe for a single delivery. */
  once<K extends GameEventName>(event: K, handler: EventHandler<GameEventPayload<K>>): () => void {
    return this.subscribe(event, handler as EventHandler<never>, true);
  }

  off<K extends GameEventName>(event: K, handler: EventHandler<GameEventPayload<K>>): void {
    const list = this.listeners.get(event);
    if (!list) return;
    const index = list.findIndex((entry) => entry.handler === (handler as EventHandler<never>));
    if (index >= 0) list.splice(index, 1);
  }

  emit<K extends GameEventName>(event: K, payload: GameEventPayload<K>): void {
    const list = this.listeners.get(event);
    if (!list || list.length === 0) return;

    // Copy before dispatch: handlers are allowed to subscribe/unsubscribe inside a handler.
    const snapshot = list.slice();
    for (const entry of snapshot) {
      if (entry.once) {
        const index = list.indexOf(entry);
        if (index >= 0) list.splice(index, 1);
      }
      try {
        (entry.handler as EventHandler<GameEventPayload<K>>)(payload);
      } catch (error) {
        // One misbehaving listener must not break the emitting system.
        logger.error('core', `listener for "${String(event)}" threw`, error);
      }
    }
  }

  /** Number of live listeners for an event (debug/tests). */
  listenerCount(event: GameEventName): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  removeAll(): void {
    this.listeners.clear();
  }

  private subscribe(event: GameEventName, handler: EventHandler<never>, once: boolean): () => void {
    const list = this.listeners.get(event) ?? [];
    const subscription: Subscription = { handler, once };
    list.push(subscription);
    this.listeners.set(event, list);

    return () => {
      const current = this.listeners.get(event);
      if (!current) return;
      const index = current.indexOf(subscription);
      if (index >= 0) current.splice(index, 1);
    };
  }
}

/** Shared bus. Systems take it via constructor so tests can supply a private one. */
export const gameEvents = new EventBus();

/** Human-readable number formatting for debug/toast output. Never used for balancing. */
export function formatCompactNumber(value: number): string {
  const clamped = clamp(value, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const abs = Math.abs(clamped);
  if (abs < 1000) return String(Math.floor(clamped));
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No'];
  let unitIndex = -1;
  let scaled = abs;
  while (scaled >= 1000 && unitIndex < units.length - 1) {
    scaled /= 1000;
    unitIndex += 1;
  }
  const sign = clamped < 0 ? '-' : '';
  return `${sign}${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)}${units[unitIndex] ?? ''}`;
}
