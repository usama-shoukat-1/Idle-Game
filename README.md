# RESTORE IT!

Mobile-first 2D restoration / tycoon / idle game. Restore abandoned buildings, turn them into
businesses, earn virtual currency, upgrade them, expand the district, develop the city.

**Current status: Phase 1 — Old Café vertical slice playable.** One building can be played
from a fresh install to a completed business: ten restoration tiers, live and offline income,
rewarded-ad and gem speed-ups (mocks only), a mock gem store, onboarding, and a completion state.
The Phase 0 foundation underneath is unchanged. This is **not** a commercially ready game and
**not** a balanced economy — see `docs/PHASE_1_OLD_CAFE.md` for the slice and its limits, and
`docs/PHASE_1_QA.md` for the verification evidence.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 (binds 0.0.0.0 for remote/preview access)
```

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run typecheck` | strict TypeScript check (`tsc --noEmit`) |
| `npm test` | unit + integration tests (Vitest) |
| `npm run build` | typecheck + production build into `dist/` |
| `npm run preview` | serve the production build (`0.0.0.0:4173`) |
| `npm run check` | typecheck + tests + build in one shot |

Dev builds bind debug shortcuts (`F1` overlay … `F10` mock store); release builds bind none.

## Tech

- **Phaser 3.90.0** (WebGL with canvas fallback) — the only runtime dependency.
- **TypeScript** (strict: no implicit any, no unused locals, branded ids, exhaustive unions).
- **Vite** for dev/build, **Vitest** for tests (node environment — game logic is
  DOM-independent by design).
- No React, no state library, no physics engine, no UI framework.

## What exists (Phase 1 — the Old Café)
- **Playable loop** — restore → earn → wait → return: ten content-defined tiers, instant
  restorations, timestamp-driven timers, live and offline income, completion state.
- **Old Café content** — `building_old_cafe` + `old_cafe_tier_01..10` + a 7-step tutorial, all
  data (`src/data/`). Nothing about the café exists in a system, scene or save file.
- **Offline earnings** — calculated at load into a persistent pending reward, collected from a
  summary popup, optionally doubled by an ad; a 4-hour cap and 100 % efficiency from balance.
- **Monetization mocks** — four opt-in rewarded rewards and a three-pack mock gem store, all
  behind the provider interfaces (no ad network, no billing, no product ids).
- **Presentation** — procedural café art that visibly changes per tier, coin pops, scripted
  customers, restrained audio cues, a bottom restore panel with CTA/timer/progress/speed-ups, and
  a portrait-first responsive layout.
- **Analytics** — the Phase 1 event contract (`building_unlocked`, `upgrade_started`,
  `upgrade_completed`, `coins_earned/spent`, `rewarded_ad_requested/rewarded`, `speedup_used`,
  `offline_reward_collected`, `purchase_started/completed`, `building_completed`) through a
  provider interface with a development implementation.

## What exists (Phase 0 foundation)

- **Engine foundation** — `ServiceContainer` composition root, typed `EventBus`, injected
  `GameClock`, seeded `Rng`, structured logger, `DisposableBag` teardown.
- **Central typed game state** — one serialisable tree (`GameState`), no scattered globals.
- **Save system** — versioned envelope, validation, repair, migration chain ready, corruption
  recovery with backup, safe defaults, reset/wipe.
- **Economy** — the only writer of currency: validation, balance checks, caps, reason-tagged
  transaction journal.
- **Timers** — timestamp based (browser suspension, backgrounding and reloads cannot break
  accuracy); supports extension, speed-ups and instant completion.
- **Buildings** — generic runtime state, unlock evaluation, tier multipliers, synergy hooks and
  time-based income accrual. No building is hard-coded anywhere.
- **Upgrades** — one engine for instant and timed upgrades, prerequisites, gem acceleration,
  rewarded time-skips, completion events, offline completion and reload rehydration.
- **Offline progression** — last-session anchor, clamped elapsed time, negative/future clock
  protection, efficiency-driven payout (0 until Phase 1 tunes it) through the same income maths.
- **Monetization architecture** — provider-independent `RewardedAdService` / `PurchaseService`
  with development mocks, content-driven rewards, an empty store catalog, opt-in-only ad flow.
- **UI framework** — design-unit layout service (16:9 → 21:9 tested), `UiRoot` scale transform,
  reusable components (panel, button, slider, progress bar, currency chip, top bar, toasts,
  popups) and screens (HUD, pause, settings, main menu).
- **Input** — unified gestures (tap, long press, drag, swipe) plus debug keyboard shortcuts.
- **Audio** — volume model (master/music/sfx/mute) with a no-op backend until assets exist.
- **Debug tools** — cheats + FPS/state overlay, disabled outside development builds.

## Documentation

| Document | Contents |
|---|---|
| [`docs/GAME_ARCHITECTURE.md`](docs/GAME_ARCHITECTURE.md) | layers, composition root, frame loop, Phase 1 hooks |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | content definitions, persisted state, runtime-only state |
| [`docs/SAVE_SYSTEM.md`](docs/SAVE_SYSTEM.md) | envelope, load pipeline, migrations, reset semantics |
| [`docs/ECONOMY_SYSTEM.md`](docs/ECONOMY_SYSTEM.md) | currency API, invariants, income maths, reason tags |
| [`docs/UPGRADE_SYSTEM.md`](docs/UPGRADE_SYSTEM.md) | upgrade engine, state transitions, persistence |
| [`docs/MONETIZATION_ARCHITECTURE.md`](docs/MONETIZATION_ARCHITECTURE.md) | ad/store boundaries, opt-in ads, catalog |
| [`docs/MOBILE_DESIGN.md`](docs/MOBILE_DESIGN.md) | design units, safe areas, touch, performance |
| [`docs/DEVELOPMENT_RULES.md`](docs/DEVELOPMENT_RULES.md) | the rules this codebase is held to |
| [`docs/PHASE_1_OLD_CAFE.md`](docs/PHASE_1_OLD_CAFE.md) | the Phase 1 slice: content, balance table, loop rules, mocks |
| [`docs/PHASE_1_QA.md`](docs/PHASE_1_QA.md) | Phase 1 verification evidence, bugs fixed, manual checklist, limits |
| [`docs/PHASE_0_QA.md`](docs/PHASE_0_QA.md) | foundation QA checklist |

## Project layout

```
src/core/       engine foundation (types, config, clock, events, content registry)
src/systems/    save, economy, timers, buildings, upgrades, offline, progression, ads, store, audio, input
src/entities/   Phaser views bound to content definitions (building, customer, worker)
src/ui/         layout service, components, panels, popups, screens, theme
src/scenes/     boot → preload → loading → main menu → game
src/data/       content: buildings, upgrades, districts, economy balance, workers, events
src/config/     feature flags, store catalog, balance tuning surface
src/services/   storage drivers, monetization providers (mock)
src/debug/      development-only cheats and overlays
tests/          unit + integration tests (Vitest)
```

## Adding the next location

`building_old_cafe` is the worked example; a second building is the same four steps:

1. Add its id to `src/data/ids.ts`, then create `src/data/buildings/building_xxx.ts` exporting a
   `BuildingDefinition` (id, `baseIncome`, `restorationTiers`, `visualStates`, unlock
   requirements, synergy rules) and register it in `src/data/buildings/index.ts`.
2. Reference it from a stage in `src/data/districts/`.
3. Add its tier upgrades in `src/data/upgrades/` (one `UpgradeDefinition` per tier).
4. Run `npm test` — `ContentRegistry.validate()` rejects inconsistent content (tier index
   mismatch, unknown visual state, unknown prerequisite, missing stage), and the layout/UI layer
   reads only definitions.

No engine code changes and **no café code to copy**: the economy, upgrade engine, save layer,
scenes and panels operate purely on definitions. Building-specific *art* is the only new code, and
even that is a content-keyed illustration (`CafeIllustration` is switched on by
`visualStates[i].key`).

## Known limitations (Phase 1)

See `docs/PHASE_1_OLD_CAFE.md` §8 and `docs/PHASE_1_QA.md` §5. Highlights: no live ad network,
billing, analytics backend or cloud save (mocks only); procedural art, no bitmap/audio assets;
offline income after a closed-game completion pays the returned tier's rate for the whole absence
(bounded approximation, in the player's favour); rewarded-ad cooldowns are tracked in memory, so a
reload resets them; the economy is slice-tuned, not retention-tuned.
