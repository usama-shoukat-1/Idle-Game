import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from '@/core/types/primitives';

/**
 * Time helpers.
 *
 * `computeElapsedMs` is the guard rail for offline progression: a device clock that
 * has been moved backwards, a corrupted save, or a "far future" lastSaveAt must all
 * degrade to a safe value instead of producing negative or gigantic income.
 */
export function computeElapsedMs(
  fromEpochMs: number,
  toEpochMs: number,
  maxElapsedMs = Number.POSITIVE_INFINITY,
): number {
  if (!Number.isFinite(fromEpochMs) || !Number.isFinite(toEpochMs)) return 0;
  const raw = toEpochMs - fromEpochMs;
  // Negative elapsed time: the clock moved backwards (or the save is from the future).
  if (raw <= 0) return 0;
  return Math.min(raw, maxElapsedMs);
}

/** True when a stored timestamp is plausible enough to use for progression math. */
export function isPlausibleTimestamp(value: unknown, nowMs: number, maxFutureMs = MS_PER_DAY): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false;
  return value <= nowMs + maxFutureMs;
}

export function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  if (safe < MS_PER_SECOND) return '0s';

  const totalSeconds = Math.floor(safe / MS_PER_SECOND);
  const days = Math.floor(totalSeconds / 86_400);
  const hoursPart = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutesPart = Math.floor((totalSeconds % 3_600) / 60);
  const secondsPart = totalSeconds % 60;

  if (days > 0) return `${days}d ${hoursPart}h`;
  if (hoursPart > 0) return `${hoursPart}h ${minutesPart}m`;
  if (minutesPart > 0) return `${minutesPart}m ${secondsPart}s`;
  return `${secondsPart}s`;
}

/** `mm:ss` for compact timer chips. */
export function formatClock(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const minutes = Math.floor(safe / 60);
  const secondsPart = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secondsPart).padStart(2, '0')}`;
}

export function formatRelative(epochMs: number, nowMs: number): string {
  const delta = nowMs - epochMs;
  if (delta < MS_PER_MINUTE) return 'just now';
  if (delta < MS_PER_HOUR) return `${Math.floor(delta / MS_PER_MINUTE)}m ago`;
  if (delta < MS_PER_DAY) return `${Math.floor(delta / MS_PER_HOUR)}h ago`;
  return `${Math.floor(delta / MS_PER_DAY)}d ago`;
}

