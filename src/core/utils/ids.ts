/**
 * Deterministic id generation.
 *
 * Ids must be stable enough to diff between sessions and cheap to produce during
 * simulation, so counters (not UUIDs) drive them by default.
 */

export interface IdFactory {
  (): string;
  /** Current counter value, for persisting/resuming a stream. */
  peek(): number;
}

export function createIdFactory(prefix: string, start = 1): IdFactory {
  let counter = start;
  const factory = (() => `${prefix}-${counter++}`) as IdFactory;
  factory.peek = () => counter;
  return factory;
}

let sessionSalt = 0;

/** Session-unique id (used for in-memory records that are never persisted). */
export function nextSessionId(prefix: string): string {
  sessionSalt += 1;
  return `${prefix}-${Date.now().toString(36)}-${sessionSalt.toString(36)}`;
}
