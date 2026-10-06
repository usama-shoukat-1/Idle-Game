/**
 * Currency + transaction contracts.
 *
 * Every currency movement in the game must flow through the economy service so
 * that balances, validation and the `reason` audit trail stay in one place.
 */

export type CurrencyKind = 'coins' | 'gems';

export const CURRENCY_KINDS: readonly CurrencyKind[] = ['coins', 'gems'];

/**
 * Why a transaction happened. Known reasons give autocomplete + analytics
 * grouping today; the `(string & {})` arm lets future content add reasons
 * without editing this union.
 */
export const CORE_TRANSACTION_REASONS = [
  'bootstrap',
  'building:income',
  'upgrade:purchase',
  'upgrade:skip',
  'upgrade:refund',
  'offline:income',
  'ad:reward',
  'purchase:grant',
  'event:reward',
  'debug:grant',
  'dev:probe',
  'system',
] as const;

export type CoreTransactionReason = (typeof CORE_TRANSACTION_REASONS)[number];
export type TransactionReason = CoreTransactionReason | (string & {});

export type TransactionDirection = 'credit' | 'debit';

export interface TransactionRecord {
  /** Monotonic id inside a session (deterministic, not random). */
  id: string;
  direction: TransactionDirection;
  currency: CurrencyKind;
  /** Always a positive magnitude for `spend`/`add` amounts. */
  amount: number;
  reason: TransactionReason;
  balanceAfter: number;
  at: number;
}

export type TransactionErrorCode =
  | 'invalid-amount'
  | 'invalid-balance'
  | 'insufficient-funds'
  | 'unknown-currency'
  | 'state-locked';

export interface TransactionResult {
  ok: boolean;
  code: TransactionErrorCode | null;
  message: string;
  record: TransactionRecord | null;
}

export interface EconomySnapshot {
  coins: number;
  gems: number;
  /** Lifetime counters kept for future analytics / balancing. */
  lifetimeEarned: Record<CurrencyKind, number>;
  lifetimeSpent: Record<CurrencyKind, number>;
  /**
   * Aggregate counters keyed by `${direction}:${currency}:${reason}` so we can
   * see where money comes from/goes without persisting a full ledger.
   */
  reasonCounters: Record<string, { count: number; total: number }>;
}
