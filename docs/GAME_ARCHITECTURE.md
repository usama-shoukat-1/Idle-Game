# RESTORE IT! — Game Architecture

Phase 0 status: **foundation only**. No buildings, no restoration gameplay, no tuned
economy, no ads, no purchases, no prestige. This document describes what exists and why.

## 1. Long-term game shape

```
WORLD → DISTRICTS → STAGES → BUILDINGS → RESTORATION TIERS → BUSINESS INCOME
      → DISTRICT SYNERGY → MASTERY → REDEVELOPMENT (prestige) → ENDLESS CONTENT
```

Every arrow is expressed as data plus one reusable system. Nothing in `src/systems` knows
about a specific building, stage or currency amount.

## 2. Layers

```
src/
  main.ts                 entry point: build services → create Phaser game → install context
  core/                   engine-agnostic foundation (types, config, clock, events, content registry)
  systems/                gameplay systems (save, economy, timers, buildings, upgrades, ...)
  entities/               Phaser view objects bound to content definitions
  ui/                     reusable UI: layout service, components, panels, popups, screens
  scenes/                 thin Phaser scenes: boot → preload → loading → main menu → game
  data/                   content: buildings, upgrades, districts, economy balance, workers
  config/                 build-time flags, store catalog, balance tuning surface
  services/               external boundaries: storage drivers, monetization providers
  debug/                  development-only cheats and overlays
  assets/                 art/audio landing zones (empty in Phase 0; textures are generated)
```

Dependency direction is strictly one way:

```
core  →  systems  →  entities/scenes/ui
             ↑
          services (boundaries)
```

Scenes and entities never read storage, never serialise a save, never compute balance.

## 3. Composition root

`ServiceContainer` (`src/core/ServiceContainer.ts`) owns the systems and their wiring:

```
clock ─┐
events ┴→ content → save → economy/timers → buildings → upgrades → offline/progression/ads/purchases/audio
```

`main.ts` loads the save **before** Phaser starts, then installs a `GameContext`
(`systems`, `layout`, `debug`, `loadResult`) into the game registry. Scenes obtain it with
`getGameContext(this)` — there are no service singletons inside scenes and no gameplay state
in module scope.

## 4. How a frame works (performance model)

1. `TimerSystem.tick()` — completes due timers (deadline comparison only).
2. `EventSystem.flush()` — drains a bounded queue of deferred events.
3. Pooled entity updates (customers) — no allocation per spawn.
4. UI refresh is **throttled to 4 Hz** (countdown labels), not per frame.
5. `setTextIfChanged` guards every label so Phaser never re-rasterises unchanged text.

There is no physics engine, no per-object timer, no polling of game state. Everything that
changes announces itself on the typed `EventBus`; UI and other systems subscribe.

## 5. Determinism

- All progression maths uses epoch milliseconds from the injected `GameClock`
  (`SystemClock` in game, `ManualClock` in tests).
- Randomness goes through `Rng` (seeded mulberry32) — never `Math.random()` in gameplay.
- Timers store `startedAt` + `completesAt` only.

## 6. What Phase 1 plugs into (no core rewrites required)

| Phase 1 need | Existing hook |
|---|---|
| Old Café building | `BuildingDefinition` in `src/data/buildings`, referenced by a stage |
| Restoration steps | `UpgradeDefinition` list, tier indices matching `restorationTiers` |
| Real art | `visualStates[].layers` + `BuildingEntity` (replace the placeholder renderer) |
| Offline tuning | `economy.offline.efficiency` / `maxDurationMs` in `src/data/economy/balance.ts` |
| Rewarded ads | `AdRewardSystem` + a real `RewardedAdService` behind `FEATURE_FLAGS.rewardedAds` |
| Store | `STORE_CATALOG` entries + real `PurchaseService` behind `FEATURE_FLAGS.purchases` |
| Puzzle/restoration mini-game | new system + events; nothing in the economy layer changes |

## 7. Known Phase 0 limitations

- No art or audio assets: placeholder textures are generated at runtime; audio is a no-op backend.
- Rewarded reward kinds `incomeMultiplier` and `offlineBoost` are declared and validated but
  intentionally refuse to grant until the Phase 1 boost system exists (they fail loudly).
- Canvas backing store is 1 device-independent pixel per CSS pixel (see
  `RENDER_SCALE_POLICY_NOTE` in `src/core/GameConfig.ts`); text resolution adapts per layout pass.
- Ad reward cooldowns are in-memory (they reset on reload) — must be persisted with the
  Phase 1 boost work.
- No service worker / offline asset caching yet (the game itself needs no network assets).
