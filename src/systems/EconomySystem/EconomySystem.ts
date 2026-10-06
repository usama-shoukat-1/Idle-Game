/**
 * Central economy service.
 *
 * All currency movement goes through here. The API is intentionally boring:
 * `add`, `spend`, `canSpend`, `spendCost`. Negative amounts are rejected on the
 * "add" path too, so a bug or a debug cheat cannot silently drive a balance
 * below zero through normal gameplay APIs (the debug tooling uses `forceSet`
 * instead, which is explicit and dev-only).
 */

import type { Clock } from '@/core/Clock';
import type { CurrencyCost } from '@/core/types/content';
import type {
  CurrencyKind,
  EconomySnapshot,
  TransactionErrorCode,
  TransactionReason,
  TransactionRecord,
  TransactionResult,
} from '@/core/types/economy';
import type { GameState } from '@/core/types/gameState';
import type { GameStateStore } from '@/core/state/GameStateStore';
import { createIdFactory } from '@/core/utils/ids';
import { createLogger } from '@/core/utils/logger';
import { isFiniteNumber, roundCurrency } from '@/core/utils/numbers';
import type { GameEventBus } from '@/systems/EventSystem';

const MAX_TRANSACTION_LOG = 200;

export interface EconomySystemDeps {
  store: GameStateStore;
  events: GameEventBus;
  clock: Clock;
}

export class EconomySystem {
  private readonly log = createLogger('economy');
  private readonly nextTransactionId = createIdFactory('tx');
  /** In-memory ring buffer for the debug overlay / QA; never persisted. */
  private readonly recent: TransactionRecord[] = [];

  constructor(private readonly deps: EconomySystemDeps) {}

  /* ----------------------------------------------------------------- reads */

  getCoins(): number {
    return this.deps.store.state.currencies.coins;
  }

  getGems(): number {
    return this.deps.store.state.currencies.gems;
  }

  getBalance(currency: CurrencyKind): number {
    return currency === 'coins' ? this.getCoins() : this.getGems();
  }

  canSpend(currency: CurrencyKind, amount: number): boolean {
    return this.validateAmount(amount) === null && this.getBalance(currency) >= amount;
  }

  /** True only when every currency in the cost is affordable. */
  canAfford(cost: CurrencyCost): boolean {
    return (['coins', 'gems'] as const).every(
      (currency) => (cost[currency] ?? 0) === 0 || this.canSpend(currency, cost[currency] as number),
    );
  }

  getSnapshot(): EconomySnapshot {
    const { currencies, stats } = this.deps.store.state;
    return {
      coins: currencies.coins,
      gems: currencies.gems,
      lifetimeEarned: { ...stats.lifetimeEarned },
      lifetimeSpent: { ...stats.lifetimeSpent },
      reasonCounters: { ...stats.reasonCounters },
    };
  }

  /** Most recent N transactions, newest first (session only). */
  getRecentTransactions(limit = 20): TransactionRecord[] {
    return this.recent.slice(0, limit);
  }

  /* ---------------------------------------------------------------- writes */

  add(currency: CurrencyKind, amount: number, reason: TransactionReason): TransactionResult {
    const invalid = this.validateAmount(amount);
    if (invalid) return this.reject(currency, amount, reason, invalid, 'add amount must be a positive finite number');

    const current = this.getBalance(currency);
    const next = roundCurrency(current + amount);
    if (!isFiniteNumber(next) || next < current) {
      return this.reject(currency, amount, reason, 'invalid-balance', 'balance would overflow');
    }
    return this.commit(currency, next, amount, 'credit', reason);
  }

  spend(currency: CurrencyKind, amount: number, reason: TransactionReason): TransactionResult {
    const invalid = this.validateAmount(amount);
    if (invalid) return this.reject(currency, amount, reason, invalid, 'spend amount must be a positive finite number');

    const current = this.getBalance(currency);
    if (current < amount) {
      return this.reject(
        currency,
        amount,
        reason,
        'insufficient-funds',
        `cannot spend ${amount} ${currency} (balance ${current})`,
      );
    }

    return this.commit(currency, roundCurrency(current - amount), amount, 'debit', reason);
  }

  /**
   * Spend a multi-currency cost atomically: either every currency is charged or
   * none is (important for upgrade purchases that mix coins + gems).
   */
  spendCost(cost: CurrencyCost, reason: TransactionReason): TransactionResult {
    const charges = ([
      ['coins', cost.coins ?? 0],
      ['gems', cost.gems ?? 0],
    ] as const).filter(([, amount]) => amount > 0);

    if (charges.length === 0) {
      return {
        ok: true,
        code: null,
        message: 'nothing to spend',
        record: null,
      };
    }

    for (const [currency, amount] of charges) {
      if (!this.canSpend(currency, amount)) {
        return this.reject(
          currency,
          amount,
          reason,
          this.validateAmount(amount) ?? 'insufficient-funds',
          `cannot afford ${amount} ${currency}`,
        );
      }
    }

    let last: TransactionResult | null = null;
    for (const [currency, amount] of charges) {
      last = this.spend(currency, amount, reason);
      if (!last.ok) return last;
    }
    return last as TransactionResult;
  }

  /**
   * Debug-only absolute setter. Never call from gameplay code: it exists so QA
   * can reproduce a state, and it is unreachable when cheats are disabled.
   */
  forceSet(currency: CurrencyKind, amount: number, reason: TransactionReason = 'debug:grant'): TransactionResult {
    if (!isFiniteNumber(amount)) {
      return this.reject(currency, amount, reason, 'invalid-amount', 'forceSet requires a finite number');
    }
    const next = roundCurrency(Math.max(0, amount));
    const current = this.getBalance(currency);
    const delta = next - current;
    return this.commit(currency, next, Math.abs(delta), delta >= 0 ? 'credit' : 'debit', reason);
  }

  /* -------------------------------------------------------------- internals */

  private validateAmount(amount: number): TransactionErrorCode | null {
    if (!isFiniteNumber(amount) || amount <= 0) return 'invalid-amount';
    return null;
  }

  private reject(
    currency: CurrencyKind,
    amount: number,
    reason: TransactionReason,
    code: TransactionErrorCode,
    message: string,
  ): TransactionResult {
    this.log.debug(`rejected ${reason}: ${message}`);
    this.deps.events.emit('economy:rejected', { currency, amount, reason, code, message });
    return { ok: false, code, message, record: null };
  }

  private commit(
    currency: CurrencyKind,
    nextBalance: number,
    amount: number,
    direction: 'credit' | 'debit',
    reason: TransactionReason,
  ): TransactionResult {
    const now = this.deps.clock.now();
    const record: TransactionRecord = {
      id: this.nextTransactionId(),
      direction,
      currency,
      amount: roundCurrency(amount),
      reason,
      balanceAfter: nextBalance,
      at: now,
    };

    this.deps.store.update((state) => {
      state.currencies[currency] = nextBalance;
      applyStats(state, record);
    }, now);

    this.recent.unshift(record);
    if (this.recent.length > MAX_TRANSACTION_LOG) this.recent.length = MAX_TRANSACTION_LOG;

    this.deps.events.emit('economy:transaction', record);
    this.deps.events.emit('economy:changed', {
      coins: this.getCoins(),
      gems: this.getGems(),
      reason,
      at: now,
    });

    return { ok: true, code: null, message: 'ok', record };
  }
}

function applyStats(state: GameState, record: TransactionRecord): void {
  const { stats } = state;
  if (record.direction === 'credit') {
    stats.lifetimeEarned[record.currency] = roundCurrency(stats.lifetimeEarned[record.currency] + record.amount);
  } else {
    stats.lifetimeSpent[record.currency] = roundCurrency(stats.lifetimeSpent[record.currency] + record.amount);
  }

  const key = `${record.direction}:${record.currency}:${record.reason}`;
  const counter = stats.reasonCounters[key] ?? { count: 0, total: 0 };
  counter.count += 1;
  counter.total = roundCurrency(counter.total + record.amount);
  stats.reasonCounters[key] = counter;
}
