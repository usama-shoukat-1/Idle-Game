# Development Rules

These are enforced by review, and several are enforced by tests or types. If a rule blocks
real progress, change the rule in this file deliberately — do not quietly make an exception.

## Architecture

1. **No building-specific logic in systems.** Systems read content definitions. If you write
   `if (buildingId === 'building.old_town.cafe')`, the design has failed.
2. **No duplicated upgrade logic.** Instant, timed, free and gem-accelerated upgrades all go
   through `UpgradeSystem`. Tier changes happen through it too.
3. **No economy maths outside `EconomySystem`.** Never write `state.wallet.*`; call
   `addCoins` / `spendCoins` with a reason tag.
4. **No direct save manipulation outside `SaveSystem`.** No component reads storage, no system
   serialises state. Persist through the save API (or just change state and let the dirty
   flag + autosave handle it).
5. **No monetization logic inside gameplay scenes.** Ads/purchases go through
   `AdRewardSystem` / `PurchaseSystem`. Scenes may only ask for a reward after an explicit
   player action.
6. **No gameplay state in scenes, entities or module scope.** It lives in `GameState`; scenes
   are views with lifecycles.
7. **Systems announce, they do not poll.** Use the typed `EventBus`; do not add per-frame
   state checks in scenes.
8. **One time source.** `GameClock` for anything persisted or timed; `Date.now()` only inside
   `src/core/Time.ts`. Randomness goes through `Rng`.
9. **Reusable systems before one-off implementations.** If a feature is even probably
   recurring (timers, rewards, unlocks), build the system, then the content.
10. **Content belongs in `src/data` / `src/config`.** Balance numbers, costs, durations,
    drop weights and copy — never in system code.

## Implementation

11. **Mobile first.** Portrait, touch, safe areas, throttled UI updates. Every new UI element
    is anchored through `Screen`/`Widget` helpers — no magic pixel offsets.
12. **Keep dependencies minimal.** Adding a runtime dependency needs a written reason.
    Phase 0's only runtime dependency is Phaser.
13. **No production use of debug cheats.** Debug tools live behind
    `FEATURE_FLAGS.debugTools` (development builds only) and systems never import `debug/`.
14. **Save compatibility.** Additive schema changes only, or a migration + a test. Never reuse
    a field name with different semantics.
15. **Validate at the boundary.** Content is validated on load; saves are validated on load;
    currency amounts are validated on entry. Inside the core, trust the types.
16. **Fail loudly in development, degrade gracefully in production.** Content errors throw in
    dev builds; hostile saves recover with logged issues.
17. **Do not modify unrelated systems during a focused task.** Scope creep in a shared
    foundation is how the whole codebase becomes hard to reason about.
18. **Documentation stays synchronised.** If behaviour and docs disagree, fix both in the
    same change.

## Quality gates (run before every commit)

```bash
npm run typecheck   # strict TS, no unused locals/params, no implicit any, branded ids
npm test            # 123+ unit/integration tests
npm run build       # production bundle must succeed
```

Additional expectations:
- New system ⇒ new tests, including the failure paths (insufficient funds, invalid input,
  clock moved backwards, corrupt save).
- New content ⇒ a `ContentRegistry.validate()`-passing definition; add a test if the shape is new.
- New UI ⇒ verify on at least one tall phone ratio and one landscape desktop window
  (`docs/PHASE_0_QA.md` lists the viewports used).
- New timers ⇒ timestamps, never accumulators.
