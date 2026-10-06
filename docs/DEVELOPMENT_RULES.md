# Development Rules

Short, enforceable rules for this codebase. If a change violates one of these, change the
change — not the rule.

## Architecture

1. **No hard-coded building-specific economy logic.** Buildings live in `src/data/buildings`
   as `BuildingDefinition`s. Systems may not branch on a building id, display name or type.
2. **No duplicated upgrade logic.** Instant/timed upgrades, effects, prerequisites and gem
   acceleration live in `UpgradeSystem`. Add an `UpgradeEffectType` rather than a special
   case in a scene.
3. **No monetization logic inside gameplay scenes.** Ads/purchases go through
   `AdRewardSystem` / `PurchaseSystem` + `RewardDispatcher`. No provider types in UI code,
   no ad unit ids or store product ids anywhere in game code or content.
4. **No direct save manipulation outside `SaveSystem`.** Nothing else calls
   `StorageAdapter`, `localStorage` or JSON (de)serialization of the state.
5. **No game state outside `GameState`.** No module-level mutable globals for progress;
   no parallel state trees in scenes or UI.
6. **Systems do not import Phaser.** The simulation must stay testable in Node. Phaser is
   allowed in `scenes/**`, `ui/**`, `debug/DebugOverlay.ts` and input/audio providers only.
7. **Content belongs in data/configuration.** Numbers (costs, durations, income, caps)
   live in `src/data/**` or `src/config/**`; systems read them.
8. **Reusable systems before one-off implementations.** If two features would do the same
   thing, extend the shared system and add tests for it.
9. **Requirement checks go through `ProgressionSystem`.** Don't re-implement unlock rules.
10. **Boost/bonus sources register modifiers** (`registerIncomeModifier`) instead of editing
    `BuildingSystem`.

## Quality

11. **TypeScript strict mode stays on.** No `any` in new public APIs; no `@ts-ignore`
    without a comment explaining why (and a follow-up task).
12. **Timestamps, not frame counts** for anything that must survive suspension/reload.
13. **Validate all external input** (saves, timestamps, provider callbacks) with the
    helpers in `core/utils` — never trust a payload.
14. **Currency only through `EconomySystem`.** Never assign `state.currencies.*` directly.
15. **Add tests with behaviour**: economy, timers, save/load, upgrade transitions, offline
    maths, content validation and monetization flows all have coverage in `tests/`.
16. **Keep `npm run typecheck`, `npm run test` and `npm run build` green** before reporting
    work as done.

## Mobile-first

17. **Design for portrait touch first**; desktop input is a development convenience.
18. **No hard-coded pixel positions** in UI: use `Viewport` + layout helpers.
19. **Respect safe areas** (`bounds.safeTop/safeBottom`) and minimum touch targets.
20. **Watch the per-frame budget**: prefer events over polling, throttled updates, texture
    reuse, no particle spam, no per-object timers, no physics without a reason.

## Process

21. **No production use of debug cheats.** Debug tooling is dev-only, uses `import.meta.env`
    gating, and is replaced by `NullDebugTools` when debug is off.
22. **Do not modify unrelated systems during a focused task.** Keep diffs scoped; note
    cleanup as a follow-up instead of doing drive-by refactors.
23. **Do not claim more than the code does.** Placeholders are labelled as placeholders,
    and "not tuned" numbers say so in the file that holds them.
24. **Documentation stays synchronized**: when behaviour changes, update the matching doc in
    `docs/` in the same change.
