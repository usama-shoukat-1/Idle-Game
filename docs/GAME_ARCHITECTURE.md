# Game Architecture

**Phase 0 — foundation only.** The game structure the architecture is built for is:

```
WORLD → STAGES/DISTRICTS → LEVELS/BUILDINGS → RESTORATION UPGRADES
      → BUSINESS OPERATIONS → INCOME → DISTRICT SYNERGY → MASTERY
      → REDEVELOPMENT/PRESTIGE → ENDLESS CONTENT
```

Only the reusable plumbing for that chain exists today. No building, no balance, no
ads, no purchases, no prestige content.

## Layering

```
src/
  core/        engine-agnostic types, state, config, utils, composition root
  systems/     simulation + services (no rendering)
  data/        game content (empty in Phase 0)
  config/      balance + non-gameplay configuration
  scenes/      Phaser scenes (flow + wiring only)
  ui/          reusable layout/components/panels/popups/screens
  services/    swappable backends (storage, later: real monetization providers)
  assets/      procedural placeholder art generator (real art goes here later)
  debug/       development-only tooling
```

Dependency direction is one-way: `core ← systems ← scenes/ui`. Systems never import
Phaser, scenes and UI never contain simulation maths. That is what keeps the whole
simulation testable in Node (see `tests/` — 78 tests, no DOM).

## Composition root

`src/core/GameContext.ts` constructs every system once and wires them together:

```
GameContext = { config, clock, events, content, balance, state, save, economy,
                timers, buildings, upgrades, progression, offline, rewards, ads,
                purchases, audio, debug }
```

Scenes read it from Phaser's registry (`getGameContext(scene)`), never construct it,
and never store game state. Tests construct it directly with a `ManualClock` and
`MemoryStorageAdapter`.

## Runtime loops

| Loop | Where | Cadence | Notes |
|---|---|---|---|
| Income accrual | `BuildingSystem.accrue()` | every frame (pure maths) | timestamp-based, no per-object timers |
| Income flush | `BuildingSystem.flush()` | `balance.incomeTickMs` | writes to the wallet + emits one event |
| Timers | `TimerSystem.update()` | every frame (one comparison per running timer) | completes exactly once |
| Autosave | `GameScene.update()` | `config.autosaveIntervalMs` | only when the state is dirty |
| Online anchor | `OfflineIncomeSystem.anchor()` | on save/hide/shutdown | writes `lastSessionTime` |

## Event bus

`src/systems/EventSystem/TypedEventBus.ts` is a typed, synchronous bus whose map lives
in `core/types/events.ts`. Systems publish facts; UI subscribes. Handlers are wrapped in
try/catch so one broken listener cannot stall the simulation.

## Scene flow

```
BootScene   → engine setup, procedural placeholder textures
PreloadScene→ asset manifest load (empty in Phase 0) + progress bar
LoadingScene→ save load/repair, content sync, timer catch-up, offline report
MainMenuScene → title, Play, Settings, Reset save, build info
GameScene   → placeholder world, HUD, panels, input, autosave, debug overlay
```

## Extending without touching core

1. **New building / upgrade / district / stage** → add data to `src/data/**` and export it
   from the matching index. `ContentRegistry` picks it up; `createDefaultGameState`
   creates its runtime record; `validate()` reports broken references at boot.
2. **New bonus source** (event, worker, premium) → `BuildingSystem.registerIncomeModifier(id, fn)`.
3. **New reward type** → extend `RewardGrantKind` + `RewardDispatcher`.
4. **New storage backend** → implement `StorageAdapter`; nothing else changes.
5. **Real ads/purchases** → implement `AdRewardService` / `PurchaseService`.

## Known Phase 0 simplifications

- No asset manifest entries: all art is generated at boot (`assets/placeholders`).
- No audio files: `AudioManager` registers keys but playback no-ops without a URL.
- No physics engine, no particles, no sprite atlases.
- Economy balance values in `config/balance/defaultBalance.ts` are explicit placeholders.
