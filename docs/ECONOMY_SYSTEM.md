# Economy System

`src/systems/EconomySystem/EconomySystem.ts` — every currency movement in the game goes
through this service. Nothing else may write `state.currencies`.

## API

```ts
getCoins(): number
getGems(): number
getBalance(currency): number
canSpend(currency, amount): boolean
canAfford(cost: CurrencyCost): boolean
getSnapshot(): EconomySnapshot
getRecentTransactions(limit?): TransactionRecord[]      // session-only ring buffer

add(currency, amount, reason): TransactionResult        // amount must be > 0
spend(currency, amount, reason): TransactionResult
spendCost(cost, reason): TransactionResult              // atomic across currencies
forceSet(currency, amount, reason?): TransactionResult  // debug only
```

## Guarantees

1. **No negative currency through normal APIs.** `add`/`spend` reject non-finite,
   zero and negative amounts (`invalid-amount`). Balances cannot be driven below zero by
   gameplay code — overspending returns `insufficient-funds` and changes nothing.
2. **Atomic multi-currency costs.** `spendCost({ coins, gems })` verifies *all*
   currencies before charging any, so a mixed upgrade can never half-charge a player.
3. **Reason trail.** Every transaction carries a `TransactionReason` (a known reason for
   autocomplete, plus an open arm for future content). Reasons power
   `state.stats.reasonCounters[direction:currency:reason]` for balancing/analytics.
4. **Overflow safety.** Credits that would exceed safe numeric range are rejected
   (`invalid-balance`) rather than producing `Infinity`.
5. **UI isolation.** The economy knows nothing about rendering; it emits
   `economy:transaction` / `economy:changed` / `economy:rejected` and the UI reacts.

## Where money comes from / goes

| Source | Reason |
|---|---|
| Building income (timestamp accrual) | `building:income` |
| Offline payout | `offline:income` |
| Rewarded ad / purchase / event grants | `reward:<source>`, `purchase:grant` |
| Upgrade purchase | `upgrade:purchase` |
| Gem acceleration | `upgrade:skip` |
| Cancelled upgrade refund | `upgrade:refund` |
| Debug tooling (dev builds only) | `debug:grant`, `dev:probe` |

## Income pipeline (kept out of the economy service)

`BuildingSystem` owns income because it needs content + modifiers:

```
incomePerSecond =
    (baseIncome * 1000 / incomeIntervalMs)
  * building.incomeMultiplier          // from completed upgrades (data-driven)
  * Π registered income modifiers      // boosts, district synergy, future events/workers
  * balance.globalIncomeMultiplier     // difficulty dial
  + building.incomeBonus
```

Modifiers are registered in `GameContext` (`boosts`, `district-synergy`) and can be added
by any future system with `registerIncomeModifier(id, fn)` — no core edits.

Accrual is timestamp-based (`lastIncomeAt`) and only *flushes* into the wallet every
`balance.incomeTickMs`, which keeps the wallet write count (and event traffic) low on
mobile while remaining exact over time.

## Balance configuration

`src/config/balance/defaultBalance.ts` — **placeholder values, explicitly not tuned**
(starting currencies, offline cap/efficiency, income tick, reserved redevelopment flag).
Real balancing is a data change; systems read the numbers, they never contain them.
