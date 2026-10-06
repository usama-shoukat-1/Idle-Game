/**
 * SCHEDULED GAME EVENTS
 * =====================
 * Data for timed world events (festivals, rush hours, limited-time boosts). The
 * EventSystem can add/list/remove schedules; Phase 0 registers none so the release
 * build carries zero event content.
 */
export interface GameEventScheduleDefinition {
  readonly id: string;
  readonly displayName: string;
  /** Duration of the event window. */
  readonly durationMs: number;
  /** How often the event may repeat, in ms. `null` means one-shot. */
  readonly repeatEveryMs: number | null;
  /** Optional content hooks resolved later (boost ids, reward ids, ...). */
  readonly modifiers?: Readonly<Record<string, number>>;
}

export const GAME_EVENTS: readonly GameEventScheduleDefinition[] = [];
