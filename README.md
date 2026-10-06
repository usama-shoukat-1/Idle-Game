# RESTORE IT!

A mobile-first 2D restoration / tycoon / idle game. You restore abandoned places, turn
them into businesses, grow a district and eventually redevelop the city.

> **Status: Phase 0 — technical foundation.**
> Reusable systems, save/offline/economy/timer/upgrade/monetization/UI architecture and
> tests are in place. **No gameplay content ships yet** — the first playable building
> (the Old Café) is Phase 1 work and will be added as data.

## Stack

- Phaser **3.90.0** (HTML5 Canvas/WebGL)
- TypeScript (strict) + Vite
- Vitest for headless simulation tests
- No React, no UI framework, no physics engine, no unnecessary dependencies

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173  (portrait phone emulation recommended)
npm run typecheck  # tsc --noEmit
npm run test       # vitest run (86 tests)
npm run build      # typecheck + production bundle
npm run preview    # serve the production build
```

Dev helpers: `?debug=1` enables the debug overlay + cheats + `window.__RESTORE_IT__`.

## What actually runs today

```
Boot → Preload → Loading → Main Menu → Game (placeholder world)
```

- The engine boots, scenes transition, placeholder textures are generated.
- Game state initializes from content + balance, is versioned, validated and repaired.
- Save/load/autosave/reset work end to end (localStorage, swappable backend).
- Economy, timers, upgrades, buildings, progression, offline income, rewards, mock ads,
  mock purchases, audio and input layers are wired and unit tested.
- A "foundation probe" in the Game scene proves input → economy → state → save in one tap.
- With no content registered, panels show explicit empty states instead of fake gameplay.

## Project layout

```
src/
  core/      types, state, config, utils, composition root (GameContext)
  systems/   SaveSystem, EconomySystem, TimerSystem, BuildingSystem, UpgradeSystem,
             ProgressionSystem, OfflineIncomeSystem, AdRewardSystem, PurchaseSystem,
             AudioSystem, InputSystem, EventSystem, ContentSystem
  data/      game content (empty in Phase 0) + registry assembly
  config/    balance + balance-adjacent configuration
  scenes/    BootScene, PreloadScene, LoadingScene, MainMenuScene, GameScene
  ui/        layout (Viewport), components, panels, popups, screens
  services/  storage backends (localStorage / memory)
  assets/    procedural placeholder art (real art plugs in here later)
  debug/     dev-only tooling (overlay, cheats, state summary)
tests/       headless vitest suites for the systems
docs/        architecture + system documentation
```

## Documentation

| Document | Contents |
|---|---|
| [docs/GAME_ARCHITECTURE.md](docs/GAME_ARCHITECTURE.md) | layering, composition root, loops, extension points |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | content definitions + the game-state tree |
| [docs/SAVE_SYSTEM.md](docs/SAVE_SYSTEM.md) | envelope, migrations, validation/repair, storage abstraction |
| [docs/ECONOMY_SYSTEM.md](docs/ECONOMY_SYSTEM.md) | currency API guarantees, income pipeline, reasons |
| [docs/UPGRADE_SYSTEM.md](docs/UPGRADE_SYSTEM.md) | upgrade flow, availability codes, gem acceleration, tests |
| [docs/MONETIZATION_ARCHITECTURE.md](docs/MONETIZATION_ARCHITECTURE.md) | provider interfaces, opt-in rewarded ads, purchases, mocks |
| [docs/MOBILE_DESIGN.md](docs/MOBILE_DESIGN.md) | responsive scaling, safe areas, input, performance rules |
| [docs/DEVELOPMENT_RULES.md](docs/DEVELOPMENT_RULES.md) | the rules this codebase is held to |
| [docs/PHASE_0_QA.md](docs/PHASE_0_QA.md) | automated + manual QA checklist |

## Adding content (no engine changes)

1. Author definitions in `src/data/buildings`, `src/data/upgrades` or `src/data/districts`
   and export them from the matching `index.ts`.
2. Register them in `src/data/index.ts` (already wired; the arrays just need entries).
3. Run `npm test` — content validation reports broken references (unknown ids, bad tiers,
   non-opt-in ad placements) and the default state picks the new definitions up
   automatically.

## License

UNLICENSED — internal project.
