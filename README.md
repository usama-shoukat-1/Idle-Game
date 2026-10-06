# RESTORE IT!

Mobile-first 2D restoration / tycoon / idle game. Restore abandoned buildings, turn them into
businesses, earn virtual currency, upgrade them, expand the district, develop the city.

**Current status: Phase 0 — technical foundation complete.** The reusable systems, save
format, content pipeline, UI framework, input layer and test suite exist. There is no
gameplay content yet by design (no buildings, no economy balance, no ads, no purchases).

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
| `npm run preview` | serve the production build |

## Tech

- **Phaser 3.90.0** (WebGL with canvas fallback) — the only runtime dependency.
- **TypeScript** (strict: no implicit any, no unused locals, branded ids, exhaustive unions).
- **Vite** for dev/build, **Vitest** for tests (node environment — game logic is
  DOM-independent by design).
- No React, no state library, no physics engine, no UI framework.

## What exists (Phase 0)

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
| [`docs/PHASE_0_QA.md`](docs/PHASE_0_QA.md) | manual QA checklist |

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

## Adding the first building (the Phase 1 path)

1. Create `src/data/buildings/building_old_town_cafe.ts` exporting a `BuildingDefinition`
   (id, `baseIncome`, `restorationTiers`, `visualStates`, unlock requirements, synergy rules).
2. Register it in `src/data/buildings/index.ts` and reference it from the stage in
   `src/data/districts/district_01_old_town.ts`.
3. Add its tier upgrades in `src/data/upgrades/index.ts`.
4. Run `npm test` — `ContentRegistry.validate()` rejects inconsistent content (tier index
   mismatch, unknown visual state, unknown prerequisite, missing stage).

No engine code changes: the economy, upgrade engine, save layer, HUD and panels operate purely
on definitions.

## Known limitations (Phase 0)

See the end of [`docs/GAME_ARCHITECTURE.md`](docs/GAME_ARCHITECTURE.md). Highlights: no art or
audio assets yet (placeholder textures are generated at runtime), `incomeMultiplier` /
`offlineBoost` ad rewards intentionally refuse until the Phase 1 boost system exists, and ad
reward cooldowns are in-memory only.
