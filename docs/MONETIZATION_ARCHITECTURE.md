# Monetization Architecture

**Phase 0 ships mock providers only.** No ad network SDK, no store SDK, no AdMob unit
ids, no StoreKit/Play product ids, no network calls, no real money path.

## Interfaces (provider-independent)

```ts
interface AdRewardService {
  readonly providerName: string;                  // "mock" today, "admob"/"levelplay" later
  isAvailable(): boolean;
  preload(placementIds: AdPlacementId[]): Promise<void>;
  show(placementId: AdPlacementId): Promise<RewardedAdResult>;
}

interface PurchaseService {
  readonly providerName: string;                  // "mock-store" today
  isAvailable(): boolean;
  listProducts(productIds: ProductId[]): Promise<StoreProduct[]>;  // provider-localized prices
  purchase(productId: ProductId): Promise<PurchaseResult>;
  restore(): Promise<PurchaseResult[]>;           // non-consumable re-delivery
}
```

Swapping in a real provider = one new class + one line in `GameContext`. Gameplay code
never sees a provider type.

## Rewarded ads are always opt-in

- `RewardedAdPlacementDefinition.requiresOptIn` is a **literal `true`** type; the registry
  throws if a placement is registered with anything else (`registerAdPlacement`).
- `AdRewardSystem.offer()` is only ever called from an explicit player action; nothing in
  the codebase shows a rewarded ad automatically or as a gate to normal play.
- Cooldowns and daily caps live in `AdRewardSystem.getCooldown()` and are persisted
  (`state.ads.placements`, local day key).
- Every outcome (`granted`, `dismissed`, `cooldown`, `unavailable`, `error`) is reported
  through `ad:outcome`; only `granted` delivers rewards.
- Implementation guidance for a real provider: follow the platform's rewarded-ads policy,
  which documents rewarded formats as an explicit user opt-in (`Google` documents this for
  AdMob). The architecture already encodes that rule.

## Reward delivery is shared

`RewardDispatcher` is the single place that turns a `RewardGrant` into a state change:
`coins`, `gems`, `timer-reduction`, `income-boost`, `offline-enhance`, `entitlement`,
`flag`. Ads, purchases, offline payouts and future events all grant through it, so an
"ad boost" and a "paid boost" cannot drift apart. Each applied grant emits
`reward:granted` for the reward popup.

Placement categories reserved by the design (content, not code): bonus coins, upgrade
time reduction, temporary income multiplier, enhanced offline reward.

## Purchases

- Catalogue is content (`ProductCatalogEntry`) with `enabled` flags; **no store ids**
  (`storeProductId` is optional and normally supplied by the provider at runtime).
- Prices always come from the provider (`StoreProduct.priceLabel`); nothing in the game
  hard-codes a price string.
- Types supported: `consumable` (gem packs), `non-consumable` (remove ads, permanent
  boosts, premium content), `subscription`.
- `restore()` re-applies entitlements (required by App Store guidelines) — the mock
  implementation supports it so the flow can be tested today.
- `PurchaseSystem.hasRemoveAds` gives content a clean hook (e.g. hide ad offers) without
  touching ad code.

## Testing without accounts

`MockAdRewardService` / `MockPurchaseService` implement every branch deterministically:
`available`, `latencyMs`, `forcedOutcome`/`forcedStatus`, `dismissedProbability`,
`cancelledProbability`. `tests/monetization.test.ts` covers granted/dismissed ads,
cooldowns, daily limits, unavailable providers, timer-reduction rewards, consumable and
entitlement purchases, cancellations, unknown catalogue entries and price sourcing.
