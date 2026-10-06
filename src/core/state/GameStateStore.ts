/**
 * Single owner of the mutable game state.
 *
 * Systems receive this store (not a global) and mutate the tree through their own
 * APIs. The store only tracks identity, dirtiness and replacement so the save
 * system always knows whether a write is worthwhile.
 */

import type { GameState } from '@/core/types/gameState';
import type { GameEventBus } from '@/systems/EventSystem';
import { createLogger } from '@/core/utils/logger';

export class GameStateStore {
  private current: GameState;
  private revision = 0;
  private dirty = false;
  private readonly log = createLogger('state');

  constructor(
    initial: GameState,
    private readonly events?: GameEventBus,
  ) {
    this.current = initial;
  }

  get state(): GameState {
    return this.current;
  }

  /** Increments on every full replacement (used by UI caches). */
  get currentRevision(): number {
    return this.revision;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Apply a mutation in place. `mutator` must be synchronous so all listeners see
   * a consistent state when the change is published.
   */
  update(mutator: (state: GameState) => void, at = Date.now()): void {
    mutator(this.current);
    this.current.timestamps.updatedAt = at;
    this.markDirty(at);
  }

  /** Replace the whole state tree (save load, reset, migration). */
  replace(next: GameState, reason: string, at = Date.now()): void {
    this.current = next;
    this.revision += 1;
    this.dirty = true;
    this.log.debug(`state replaced (${reason}) revision=${this.revision}`);
    this.events?.emit('state:replaced', { reason, at });
  }

  markDirty(at = Date.now()): void {
    const wasDirty = this.dirty;
    this.dirty = true;
    if (!wasDirty) this.events?.emit('state:dirty', { at });
  }

  markClean(): void {
    this.dirty = false;
  }

  /** Structured clone of the state; safe to serialize or hand to tests. */
  snapshot(): GameState {
    return cloneGameState(this.current);
  }
}

/** Structured-clone with a JSON fallback for older engines. */
export function cloneGameState<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through to JSON */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
