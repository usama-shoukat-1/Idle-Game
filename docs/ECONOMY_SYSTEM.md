# Economy System

`src/systems/EconomySystem/EconomySystem.ts` is the **only** writer of currency. Systems,
scenes and UI call its API; nothing else may touch `state.wallet`.

## API

```ts
getCoins() / getGems() / getBalance(currency)
canSpendCoins(n) / canSpendGems(n) / canSpend(currency, n)
canAfford(cost) / canAffordAll(costs) / affordableUnits(currency, unitCost)
addCoins(n, reason)  → granted      addGems(n, reason) → granted
spendCoins(n, reason) → boolean     spendGems(n, reason) → boolean
spend(cost, reason) / grant(cost, reason)
spendAll(costs, reason)  // atomic: all or nothing
getRecentTransactions(limit)
```

## Invariants (tested in `tests/economy-system.test.ts`)

1. Amounts are normalised: finite, non-negative, integers. `NaN`, `Infinity`, `-5` and `0`
   are rejected with a `economy:transaction-rejected` event — never applied.
2. **A spend can never exceed the balance.** The balance is checked before mutation; a failed
   spend leaves the wallet untouched and returns `false`.
3. Additions are clamped to `economy.maxCoins` / `maxGems` from content, so the wallet can
   never overflow into `Infinity`.
4. Every accepted mutation appends a `TransactionLogEntry` with a **reason tag** and the
   resulting balance; the journal is bounded (200 entries) and lives in
   `state.transactions` (single source of truth, survives a save reset).
5. Analytics counters (`totalCoinsEarned/Spent`, gems) are updated in the same call.

## Reason tags

Format: `<domain>.<action>[:<contentId>]`. Current tags in the codebase:

| Tag | Emitted by |
|---|---|
| `building.income` | `BuildingSystem.accrueIncome` (online ticks) |
| `offline.income` | `OfflineIncomeSystem.settle` (distinct so offline is separable in analytics) |
| `upgrade.start:<upgradeId>` | `UpgradeSystem.start` |
| `upgrade.accelerate:<upgradeId>` | `UpgradeSystem.accelerate` (gems) |
| `ads.reward.<rewardId>` | `AdRewardSystem` |
| `purchase.<productId>` | `PurchaseSystem` |
| `debug.addCoins` / `debug.addGems` | `DebugTools` (development builds only) |
| `test.*` | tests |

Keep the format: it is what makes "where did these 4 million coins come from?" answerable
from a save file.

## Balance configuration

All numbers live in `src/data/economy/balance.ts` (`EconomyBalanceConfig`):
`startingCoins`, `startingGems`, caps, `offline { maxDurationMs, efficiency, minimumDurationMs }`,
`acceleration { gemsPerMinute, minimumGems }`, `rewardedRewards[]`.

**Phase 0 values are placeholders** (documented in the file) and are explicitly not final.
`offline.efficiency` is `0` until Phase 1 tunes offline income.

## Income maths (single implementation)

`BuildingSystem` owns income:

```
ratePerMs = baseRate(model) × currentTierMultiplier × (1 + synergyBonus/100)
earned    = floor(ratePerMs × elapsedMs × efficiency)
```

- `baseRate` comes from the `IncomeModel` union (`perInterval`, `perSecond`; `flat` is one-shot).
- Elapsed time is clamped (`STATE_LIMITS.maxOfflineDurationMs`) and negative elapsed is 0.
- Fractional coins are **banked**: `lastIncomeAt` advances only by the time actually paid for,
  so slow producers still pay out correctly instead of rounding to zero forever.
- The same function serves online ticks and offline settlement, so there is no second,
  divergent "offline rate". `tests/game-state.test.ts` + `tests/offline-progression.test.ts`
  cover both.

## What NOT to do

- ❌ `state.wallet.coins += x` anywhere outside `EconomySystem`.
- ❌ A second currency store (e.g. a UI-owned counter).
- ❌ Balance numbers in system code — put them in content and read them through the registry.
- ❌ Granting a reward in a UI callback: call the owning system, then show the popup.
