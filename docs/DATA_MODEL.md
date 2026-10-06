# Data Model

Two data families, kept strictly apart:

- **Content** (`src/core/types/content.ts` + `src/data/**`) — authored definitions.
  Immutable at runtime; adding content never requires engine changes.
- **Game state** (`src/core/types/gameState.ts`) — the single mutable tree that is saved.

## Content definitions

### `BuildingDefinition`
| Field | Purpose |
|---|---|
| `id`, `displayName`, `description` | identity |
| `stageId`, `districtId`, `order` | world placement/ordering |
| `type`, `rarity`, `tags` | presentation/filtering metadata |
| `baseIncome`, `incomeIntervalMs` | tier-0 income rate (coins per interval) |
| `maxTier` | highest restoration tier |
| `restorationTiers[]` | `{ tier, displayName, visualStateId, upgradeIds, incomeMultiplier }` |
| `visualStates[]` | art swap points (`textureKey` optional → procedural placeholder) |
| `upgradeIds[]` | upgrades offered for this building |
| `unlockRequirements` | `UnlockRequirementDefinition` (stage/building/cost/district progress/mastery) |
| `synergyRules[]` | `SynergyRuleDefinition` (district/stage/global multiplier) |
| `workerSlots` | reserved for Phase 2+ |

### `UpgradeDefinition`
The spec's flat fields (`targetBuildingId`, `tier`, `cost`, `duration`, `incomeMultiplier`,
`unlocks`, `visualState`, `prerequisites`) are represented as a **typed target + effect
list** instead of ad-hoc fields, which keeps the same intent while staying type-safe:

| Field | Purpose |
|---|---|
| `target` | discriminated union: `building` / `district` / `global` |
| `kind` | `instant`, `timed`, `tier-restoration`, `automation`, `capacity`, `cosmetic` |
| `tier` | tier the target reaches on completion (0 = utility upgrade) |
| `cost` | `CurrencyCost` (`coins`/`gems`) |
| `durationMs` | 0 = instant |
| `gemSkipRatePerMinute` | optional gem acceleration rate (undefined = disabled) |
| `effects[]` | data-driven effects (see below) |
| `prerequisites[]` | upgrade/building/tier/stage/mastery gates |
| `visualStateId` | visual state applied on completion |
| `repeatable`, `maxPurchases` | repeatable upgrades with caps |

Effect types: `income-multiplier`, `income-add`, `income-interval`, `unlock-building`,
`unlock-district`, `visual-state`, `worker-slot`, `offline-capacity`, `flag`
(with `mode: add | set | multiply`). `UpgradeSystem` applies building-local effects via
`BuildingSystem.applyUpgradeEffects` and non-local ones itself — one implementation per
effect type, so two upgrades with the same effect can never behave differently.

### `StageDefinition`, `DistrictDefinition`, `MasteryTrackDefinition`
World structure: stages own districts, districts own buildings and a synergy/mastery
track, mastery tracks define an xp curve and a per-level income bonus.

### `EconomyBalanceDefinition`
`startingCoins/Gems`, `globalIncomeMultiplier`, `incomeTickMs`, `offline`
(`enabled`, `maxOfflineMs`, `minElapsedMs`, `efficiency`, `enhancedEfficiency`,
`enhancedDurationMs`) and a reserved `redevelopment` flag. Lives in
`src/config/balance/defaultBalance.ts` — **placeholder values, not tuned**.

### Monetization content (types only in Phase 0)
`RewardedAdPlacementDefinition` (with literal `requiresOptIn: true` — a non-opt-in
placement cannot even be registered), `ProductCatalogEntry` (no store ids: those come
from the provider at runtime), `EntitlementDefinition`.

## Game state

`GameState` (see `core/types/gameState.ts`) — one tree, one owner (`GameStateStore`):

| Section | Contents |
|---|---|
| `currencies` | `coins`, `gems` |
| `progression` | `currentStageId`, unlocked stages/districts, per-stage progress |
| `buildings` | per building: `unlocked`, `tier`, `visualStateId`, active/completed upgrades, `purchaseCounts`, `incomeMultiplier`, `incomeBonus`, `incomeIntervalMsOverride`, `workerSlotsBonus`, `lastIncomeAt`, `lifetimeEarned`, `workerIds` |
| `upgrades` | `active` (timer id + cost paid) and `completed` ids |
| `timers` | every timestamp-based timer |
| `workers` | hired workers (no worker content yet) |
| `districts` | progress/synergy cache per district |
| `mastery` | level + xp per track |
| `boosts` | temporary multipliers (income/offline/upgrade speed) with `endsAt` |
| `events` | active/completed event instances |
| `entitlements` | purchased entitlements (+ expiry) |
| `ads` | per-placement cooldown/daily counters |
| `settings` | volumes, mute, haptics, reduced motion, floating numbers, language |
| `tutorial` | completed/skipped state and step ids |
| `stats` | taps, sessions, lifetime currency, per-reason counters |
| `timestamps` | `createdAt`, `updatedAt`, `lastSessionTime`, `sessionStartedAt`, offline markers |
| `flags`, `rngSeed` | generic content flags + deterministic RNG seed |

No system keeps a parallel state tree; everything a reload must preserve lives here.
