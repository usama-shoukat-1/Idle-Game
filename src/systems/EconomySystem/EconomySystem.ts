import type { GameClock } from '@/core/Time';
import type { ContentRegistry } from '@/core/content/ContentRegistry';
import type { EventBus } from '@/core/events/EventBus';
import { MAX_TRANSACTION_LOG } from '@/core/constants/GameConstants';
import type { Cost } from '@/core/types/settings';
import type { CurrencyId } from '@/core/types/primitives';
import type { GameState, TransactionLogEntry } from '@/core/types/state';
import { normalizeCurrencyAmount } from '@/core/utils/NumberUtils';
import type { TransactionReason } from '@/core/types/primitives';

/**
 * CENTRALISED ECONOMY
 * ===================
 * The only way currency changes. No system, scene or UI component may write
 * `state.wallet` directly - they call this service, which:
 *
 *  1. validates the amount (finite, non-negative, integer),
 *  2. enforces the balance rule (never spend more than you have),
 *  3. clamps to the configured caps,
 *  4. records a transaction with a `reason` tag (analytics + debugging),
 *  5. emits a typed event so UI reacts without polling.
 *
 * Phase 0 has no final balance: every number comes from the content registry.
 */
export interface TransactionRecord {
  readonly currency: CurrencyId;
  readonly delta: number;
  readonly balanceAfter: number;
  readonly reason: TransactionReason;
  readonly accepted: boolean;
}

export class EconomySystem {
  constructor(
    private readonly state: GameState,
    private readonly content: ContentRegistry,
    private readonly events: EventBus,
    private readonly clock: GameClock,
  ) {
    // Keep the journal in one place only (`state.transactions`) so a save reset - which
    // rewrites the state in place - can never leave a stale copy behind.
    if (!Array.isArray(this.state.transactions)) this.state.transactions = [];
  }

  // --- Reads ---------------------------------------------------------------

  getCoins(): number {
    return this.state.wallet.coins;
  }

  getGems(): number {
    return this.state.wallet.gems;
  }

  getBalance(currency: CurrencyId): number {
    return currency === 'coins' ? this.getCoins() : this.getGems();
  }

  canSpendCoins(amount: number): boolean {
    return this.canSpend('coins', amount);
  }

  canSpendGems(amount: number): boolean {
    return this.canSpend('gems', amount);
  }

  canSpend(currency: CurrencyId, amount: number): boolean {
    const normalized = normalizeCurrencyAmount(amount);
    if (normalized <= 0) return false;
    return this.getBalance(currency) >= normalized;
  }

  /** True when the player can pay this cost right now. */
  canAfford(cost: Cost): boolean {
    return this.canSpend(cost.currency, cost.amount);
  }

  /** How many of `amount` the player can currently pay for (0..amount). */
  affordableUnits(currency: CurrencyId, unitCost: number): number {
    const normalizedUnit = normalizeCurrencyAmount(unitCost);
    if (normalizedUnit <= 0) return 0;
    return Math.floor(this.getBalance(currency) / normalizedUnit);
  }

  // --- Writes --------------------------------------------------------------

  /** Adds coins. Invalid/negative amounts are rejected, never applied. */
  addCoins(amount: number, reason: TransactionReason): number {
    return this.add('coins', amount, reason);
  }

  addGems(amount: number, reason: TransactionReason): number {
    return this.add('gems', amount, reason);
  }

  /**
   * Spends coins if the balance allows it.
   * @returns true when the transaction happened.
   */
  spendCoins(amount: number, reason: TransactionReason): boolean {
    return this.applySpend('coins', amount, reason);
  }

  spendGems(amount: number, reason: TransactionReason): boolean {
    return this.applySpend('gems', amount, reason);
  }

  /** Spends an arbitrary cost (coins or gems). */
  spend(cost: Cost, reason: TransactionReason): boolean {
    return this.applySpend(cost.currency, cost.amount, reason);
  }

  /** Grants an arbitrary cost/currency pair - used by rewards and purchases. */
  grant(cost: Cost, reason: TransactionReason): number {
    return this.add(cost.currency, cost.amount, reason);
  }

  /** True when every cost in the list is affordable. */
  canAffordAll(costs: readonly Cost[]): boolean {
    return costs.every((cost) => this.canAfford(cost));
  }

  /** Spends a list of costs atomically: either all succeed or none are applied. */
  spendAll(costs: readonly Cost[], reason: TransactionReason): boolean {
    if (!this.canAffordAll(costs)) {
      for (const cost of costs) {
        if (!this.canAfford(cost)) {
          this.reject(cost.currency, cost.amount, reason);
        }
      }
      return false;
    }
    for (const cost of costs) this.spend(cost, reason);
    return true;
  }

  /** Recent transactions, most recent last. Read-only view for debug/UIs. */
  getRecentTransactions(limit = 20): readonly TransactionLogEntry[] {
    return this.state.transactions.slice(-limit);
  }

  // --- internals -----------------------------------------------------------

  private add(currency: CurrencyId, amount: number, reason: TransactionReason): number {
    const normalized = normalizeCurrencyAmount(amount);
    if (normalized <= 0) {
      this.reject(currency, amount, reason);
      return 0;
    }

    const caps = this.content.getEconomyBalance();
    const cap = currency === 'coins' ? caps.maxCoins : caps.maxGems;
    const before = this.getBalance(currency);
    const after = Math.min(cap, before + normalized);
    const applied = after - before;

    this.setBalance(currency, after);
    this.record({ currency, delta: applied, balanceAfter: after, reason, accepted: true });
    this.trackEarned(currency, applied);
    this.emitChange(currency, applied, after, reason);
    return applied;
  }

  private applySpend(currency: CurrencyId, amount: number, reason: TransactionReason): boolean {
    const normalized = normalizeCurrencyAmount(amount);
    const before = this.getBalance(currency);

    if (normalized <= 0 || before < normalized) {
      this.reject(currency, amount, reason);
      return false;
    }

    const after = before - normalized;
    this.setBalance(currency, after);
    this.record({ currency, delta: -normalized, balanceAfter: after, reason, accepted: true });
    this.trackSpent(currency, normalized);
    this.emitChange(currency, -normalized, after, reason);
    return true;
  }

  private reject(currency: CurrencyId, amount: number, reason: TransactionReason): void {
    this.record({
      currency,
      delta: 0,
      balanceAfter: this.getBalance(currency),
      reason,
      accepted: false,
    });
    this.events.emit('economy:transaction-rejected', {
      currency,
      requested: amount,
      balance: this.getBalance(currency),
      reason,
    });
  }

  private setBalance(currency: CurrencyId, value: number): void {
    if (currency === 'coins') {
      this.state.wallet.coins = value;
    } else {
      this.state.wallet.gems = value;
    }
  }

  private emitChange(currency: CurrencyId, delta: number, balance: number, reason: string): void {
    if (currency === 'coins') {
      this.events.emit('economy:coins-changed', { delta, balance, reason });
    } else {
      this.events.emit('economy:gems-changed', { delta, balance, reason });
    }
  }

  private trackEarned(currency: CurrencyId, amount: number): void {
    if (currency === 'coins') this.state.analytics.totalCoinsEarned += amount;
    else this.state.analytics.totalGemsEarned += amount;
  }

  private trackSpent(currency: CurrencyId, amount: number): void {
    if (currency === 'coins') this.state.analytics.totalCoinsSpent += amount;
    else this.state.analytics.totalGemsSpent += amount;
  }

  private record(entry: TransactionRecord): void {
    if (!entry.accepted) {
      // Rejected attempts are logged for debugging but never persisted: they carry no
      // player value and would only bloat the save.
      return;
    }
    const full: TransactionLogEntry = {
      at: this.clock.now(),
      currency: entry.currency,
      delta: entry.delta,
      balanceAfter: entry.balanceAfter,
      reason: entry.reason,
    };
    const journal = this.state.transactions;
    journal.push(full);
    if (journal.length > MAX_TRANSACTION_LOG) {
      journal.splice(0, journal.length - MAX_TRANSACTION_LOG);
    }
  }
}
