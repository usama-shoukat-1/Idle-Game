/**
 * Timestamp helpers.
 *
 * All progression maths is timestamp based, so these functions are the single
 * place that decides what a "valid" timestamp means. Untrusted input (a tampered
 * or corrupted save) must never produce negative elapsed time or NaN rewards.
 */

import type { ElapsedWindow } from '@/core/types/timers';
import { isFiniteNumber } from './numbers';

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export const SECOND = MS_PER_SECOND;
export const MINUTE = MS_PER_MINUTE;
export const HOUR = MS_PER_HOUR;
export const DAY = MS_PER_DAY;

/** A timestamp must be a finite, non-negative, representable epoch-ms value. */
export function isValidTimestamp(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

/**
 * Coerce untrusted input into a usable timestamp.
 * Invalid values (NaN, negative, Infinity, huge) fall back to `fallback`.
 */
export function sanitizeTimestamp(value: unknown, fallback: number): number {
  if (!isValidTimestamp(value)) return fallback;
  // Small clock skew into the future is tolerated; anything beyond a day is junk.
  if (value > fallback + MS_PER_DAY) return fallback;
  return value;
}

export interface ElapsedOptions {
  /** Hard cap in ms; `0`/`undefined` means "no cap". */
  maxMs?: number;
  /** Tolerance for clock skew into the future (defaults to 5 minutes). */
  futureToleranceMs?: number;
}

/** The canonical elapsed-window shape shared with the offline report types. */
export type ElapsedResult = ElapsedWindow;

/**
 * Compute the elapsed wall-clock window between the last session and now,
 * protecting against invalid/negative/future timestamps.
 */
export function computeElapsed(
  lastSessionTime: unknown,
  currentTime: unknown,
  options: ElapsedOptions = {},
): ElapsedResult {
  const { maxMs = 0, futureToleranceMs = 5 * MS_PER_MINUTE } = options;
  const now = isValidTimestamp(currentTime) ? currentTime : Date.now();
  // A timestamp that is implausible (NaN/negative) or meaningfully in the future
  // (clock tampering, timezone jumps) is discarded rather than trusted.
  const wasInvalid =
    !isValidTimestamp(lastSessionTime) ||
    (lastSessionTime as number) > now + Math.max(0, futureToleranceMs);
  const anchor = wasInvalid ? now : (lastSessionTime as number);

  const delta = now - anchor;
  const elapsedMs = delta > 0 ? delta : 0;

  const cap = maxMs > 0 ? maxMs : Number.POSITIVE_INFINITY;
  const cappedMs = Math.min(elapsedMs, cap);

  return {
    lastSessionTime: anchor,
    currentTime: now,
    elapsedMs,
    cappedMs,
    wasCapped: cappedMs < elapsedMs,
    wasInvalid,
  };
}

/** Clamp an arbitrary duration into a sane, non-negative range. */
export function sanitizeDuration(value: unknown, fallback = 0): number {
  if (!isFiniteNumber(value) || value < 0) return fallback;
  return Math.min(value, 365 * MS_PER_DAY);
}

/** `90_000` -> `1m 30s`. Used by countdown/offline UI placeholders. */
export function formatDuration(ms: number): string {
  if (!isFiniteNumber(ms)) return '0s';
  const total = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Local calendar day key for daily counters (`YYYY-MM-DD`). */
export function dayKey(timestamp: number): string {
  const date = new Date(isValidTimestamp(timestamp) ? timestamp : 0);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
