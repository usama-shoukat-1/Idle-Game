# Monetization Architecture

Phase 0 ships **provider-independent interfaces plus development mocks**. There is no ad
network, no billing integration, no ad unit id and no store product id anywhere in the code.

## Boundaries

```
AdRewardSystem  → RewardedAdService   (interface)  → MockRewardedAdService   (Phase 0)
PurchaseSystem  → PurchaseService     (interface)  → MockPurchaseService     (Phase 0)
```

Interfaces live in `src/core/types/services.ts`; mocks in `src/services/monetization/`.
Real providers (AdMob/AdSense/Unity, Apple/Google/Web billing) plug in behind the same
interfaces and are selected in `ServiceContainer` — gameplay code does not change.

## Rewarded ads — opt-in only

The design enforces the platform rule that rewarded ads are an **explicit user choice**:

1. Nothing auto-plays. There is no interstitial or forced format modelled at all — the
   interface has only `show(placementId)`, and it is called from a player tap on a button that
   states the reward.
2. `AdRewardSystem.requestReward({ placementId, rewardId })` is the only entry point, and it
   grants **only** when the provider returns `rewarded: true` (i.e. the view reached the
   provider's reward threshold). Dismissed/failed views grant nothing.
3. Rewards are content (`EconomyBalanceConfig.rewardedRewards[]`): amount, kind, cooldown and
   copy all live in `src/data/economy/balance.ts`.
4. A busy or unavailable slot changes button state; the player is never blocked from playing.
5. Cooldowns are checked before showing an ad, so a player cannot be shown a second ad for a
   reward they cannot receive yet.

### Reward kinds and Phase 1 wiring

| kind | Status |
|---|---|
| `coins` | wired (EconomySystem); optional `percentOfNextUpgradeCost` scaling with min/max clamp |
| `gems` | wired (EconomySystem) |
| `timeSkip` | wired (UpgradeSystem.reduceRemaining); refuses with `no-target` when nothing is running so the player never wastes an ad |
| `incomeMultiplier` | wired (BoostSystem): timed multiplier, deadline-based, extends instead of stacking |
| `offlineBoost` | wired (OfflineIncomeSystem.applyOfflineBoost): doubles the *pending* reward once per absence |

All four kinds are shipped by Phase 1 content (see the table below).

### Mock provider behaviour

`MockRewardedAdService`: `initialize()`, `getAvailability()`, `show()` with a configurable
outcome (`rewarded` | `dismissed` | `failed`), optional latency and placement allow-list, plus
`setOutcome()` for QA toggles. Zero network.

## Purchases

`PurchaseSystem` wraps the store provider and applies grants from the **catalog**
(`src/config/content/index.ts`). Phase 1 ships a three-entry **development** catalog
(`gems.small` 100, `gems.medium` 600, `gems.large` 1,500) so the flow, entitlement bookkeeping
and gem economy can be exercised end to end. No real product id or price exists in the
repository: prices come from the provider (`MOCK_STORE_PRICES` labels them `mock · …`).

Rules encoded in the implementation:

- a product id that is not in the catalog is refused (`not-in-catalog`) instead of granted;
- `pending` never grants (the platform confirmation may never arrive);
- consumables grant currency through `EconomySystem` with a `purchase.<productId>` reason;
- non-consumables record an entitlement (`ENTITLEMENTS`) and are restorable
  (`PurchaseSystem.restore()`), which mobile stores require;
- localised prices come from the provider (`StoreProduct.localizedPrice`) — never hard-coded;
- receipt data is treated as opaque and is marked for server-side validation before the
  economy is trusted in production.

Adding a product later = one catalog entry + provider mapping. No gameplay code changes.

## Feature flags

`src/config/content/index.ts`:

```ts
FEATURE_FLAGS = { debugTools: import.meta.env.DEV, rewardedAds: true, purchases: true, layoutDebugOverlay: false }
```

**Phase 1 state:** both flags are on, because both are wired to *mock* providers — the flow,
cooldowns, caps, analytics and rewards are real, the network is not. Turning a flag off hides
every affordance without touching gameplay code (and `F8`/`F10` in a dev build disable the mock
providers at runtime to prove the `unavailable` paths).

Phase 1 reward set (content, `src/data/economy/balance.ts`):

| Reward | Kind | Effect | Cooldown |
|---|---|---|---|
| `reward.bonus_coins` | `coins` | 8 % of the next restoration cost, clamped 50–500 | 5 min |
| `reward.upgrade_speedup` | `timeSkip` | 25 % of the remaining job, capped at 15 min | 5 min |
| `reward.income_boost` | `incomeMultiplier` | 2× income for 30 min (extends, never stacks) | 20 min |
| `reward.offline_double` | `offlineBoost` | 2× the pending offline reward, once per absence | — |

Gem acceleration is content-driven (`1 gem per remaining minute`, minimum 1) and the gem packs are
development catalog entries with mock prices — **not** final monetization balance. Cooldowns are
tracked in memory for now, so a reload resets them (documented limitation, see
`docs/PHASE_1_QA.md` §5).
