/** Numeric helpers shared by systems. Pure functions only - no state, no logging. */

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Rounds a currency amount to a whole, safe, non-negative number.
 * All economy mutations go through this so the wallet can never hold NaN, Infinity
 * or fractional garbage.
 */
export function normalizeCurrencyAmount(value: unknown): number {
  if (!isFiniteNumber(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/**
 * Converts an integer percentage bonus into an income multiplier: `10 -> 1.1`.
 * Used by synergy maths so "percent" only ever means one thing.
 */
export function percentToMultiplier(percent: number): number {
  if (!isFiniteNumber(percent)) return 1;
  return 1 + percent / 100;
}
