/** Numeric guards + formatting shared by every system. */

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True for values usable as a positive currency amount. */
export function isPositiveAmount(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

export function clamp(value: number, min: number, max: number): number {
  if (!isFiniteNumber(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * Currencies are floats internally (income accrues continuously) but are stored
 * rounded to a fixed precision to avoid binary drift accumulating in the save.
 */
export function roundCurrency(value: number, precision = 4): number {
  if (!isFiniteNumber(value)) return 0;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function toSafeInteger(value: unknown, fallback = 0): number {
  if (!isFiniteNumber(value)) return fallback;
  return Math.trunc(value);
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += isFiniteNumber(value) ? value : 0;
  return total;
}

const ABBREVIATIONS: ReadonlyArray<{ threshold: number; suffix: string }> = [
  { threshold: 1e15, suffix: 'Q' },
  { threshold: 1e12, suffix: 'T' },
  { threshold: 1e9, suffix: 'B' },
  { threshold: 1e6, suffix: 'M' },
  { threshold: 1e3, suffix: 'K' },
];

/** `1234` -> `1.23K`. Kept short so it fits a phone status-bar-sized HUD. */
export function formatNumber(value: number, decimals = 2): string {
  if (!isFiniteNumber(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  for (const { threshold, suffix } of ABBREVIATIONS) {
    if (abs >= threshold) {
      const scaled = abs / threshold;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : decimals;
      return `${sign}${scaled.toFixed(digits)}${suffix}`;
    }
  }
  return `${sign}${abs >= 1000 ? Math.trunc(abs) : Number(abs.toFixed(2))}`;
}

/** `0.75` -> `+75%`. */
export function formatMultiplier(value: number): string {
  const percent = (value - 1) * 100;
  const rounded = Math.round(percent * 10) / 10;
  return `${rounded >= 0 ? '+' : ''}${rounded}%`;
}
