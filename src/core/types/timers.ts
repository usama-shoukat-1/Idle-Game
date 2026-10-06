/**
 * Timestamp-based timer contracts.
 *
 * Timers never count frames. They store wall-clock anchors so that backgrounding,
 * device sleep, suspension and reloads cannot desync them.
 */

import type { TimerId } from './ids';

export type TimerKind =
  | 'upgrade'
  | 'construction'
  | 'event'
  | 'boost'
  | 'automation'
  | 'custom';

export type TimerStatus = 'running' | 'paused' | 'completed' | 'cancelled';

export interface TimerState {
  id: TimerId;
  kind: TimerKind;
  label: string;
  /** Id of the thing the timer belongs to (building, upgrade, event…). */
  targetId?: string;
  status: TimerStatus;
  /** Wall clock ms when the timer was first started. */
  startedAt: number;
  /** Wall clock ms when the timer should complete. */
  endsAt: number;
  /** Original (possibly extended/reduced) duration used for progress maths. */
  durationMs: number;
  /** Remaining ms captured when the timer was paused. */
  pausedRemainingMs?: number;
  createdAt: number;
  updatedAt: number;
  /** Free-form, serializable payload used by the owning system. */
  meta?: Record<string, string | number | boolean>;
}

export interface TimerStartRequest {
  kind: TimerKind;
  label: string;
  durationMs: number;
  targetId?: string;
  /** Optional caller-provided id; a deterministic id is generated otherwise. */
  id?: TimerId;
  meta?: Record<string, string | number | boolean>;
  /** Called once, right after the timer completes (in addition to the event). */
  onComplete?: (timer: TimerState) => void;
}

export interface TimerProgress {
  id: TimerId;
  status: TimerStatus;
  remainingMs: number;
  elapsedMs: number;
  /** 0..1 */
  normalized: number;
}

export interface ElapsedWindow {
  /** Timestamp recorded by the last save (untrusted input, sanitized). */
  lastSessionTime: number;
  currentTime: number;
  /** Sanitized elapsed time; never negative, never NaN. */
  elapsedMs: number;
  /** Elapsed time after the balance cap is applied. */
  cappedMs: number;
  /** True when the raw elapsed time exceeded the cap. */
  wasCapped: boolean;
  /** True when the stored timestamp was invalid and had to be discarded. */
  wasInvalid: boolean;
}

/** Offline progression reads the same window shape as the offline report. */
export type OfflineElapsed = ElapsedWindow;
