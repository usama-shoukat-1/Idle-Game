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

### Reward kinds and Phase 0 wiring

| kind | Status |
|---|---|
| `coins` | fully wired (EconomySystem) |
| `gems` | fully wired (EconomySystem) |
| `timeSkip` | fully wired (UpgradeSystem.reduceRemaining); refuses with `no-target` when nothing is running so the player never wastes an ad |
| `incomeMultiplier` | declared + validated, **intentionally refuses** until the Phase 1 boost system exists (`not-supported`, logged loudly) |
| `offlineBoost` | same as above |

Shipped Phase 0 content uses only `coins` and `timeSkip` (two clearly-labelled placeholders so
QA can exercise the mock flow).

### Mock provider behaviour

`MockRewardedAdService`: `initialize()`, `getAvailability()`, `show()` with a configurable
outcome (`rewarded` | `dismissed` | `failed`), optional latency and placement allow-list, plus
`setOutcome()` for QA toggles. Zero network.

## Purchases

`PurchaseSystem` wraps the store provider and applies grants from the **catalog**
(`src/config/content/store_catalog.ts`), which is **empty in Phase 0** — no product id exists
in the repository yet.

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
FEATURE_FLAGS = { debugTools: import.meta.env.DEV, rewardedAds: false, purchases: false, layoutDebugOverlay: false }
```

Phase 1 turns `rewardedAds`/`purchases` on when a real provider exists. Until then the UI paths
exist but the systems report `unavailable`, and no monetization code executes in gameplay.
