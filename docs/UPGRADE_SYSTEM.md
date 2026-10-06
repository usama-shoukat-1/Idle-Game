# Upgrade System

`src/systems/UpgradeSystem/UpgradeSystem.ts` is the single engine behind every restoration
step in the game — instant or timed, free or paid, with or without prerequisites.

```
canStart → pay → (instant ? apply : persist job + start timer) → apply → announce
```

Because the engine only reads `UpgradeDefinition` fields, **adding content never edits this
file**. Phase 0 registers zero upgrades on purpose; the engine is proven against synthetic
definitions in `tests/upgrade-engine.test.ts`.

## API

```ts
getStatus(id)                    // 'locked' | 'available' | 'running' | 'completed'
canStart(id) → { ok, reason?, message? }
start(id) → { ok, reason?, message? }   // spends the cost, starts or completes
completeNow(id, reason?) → boolean      // timer expiry, gem acceleration, debug
reduceRemaining(id, ms) → appliedMs      // rewarded-ad speed-up hook
getAccelerationCost(id) → Cost | null    // gem price for an instant finish
accelerate(id) → boolean
cancel(id) → boolean                     // no refund (policy is a Phase 1 decision)
getActiveJobs() / getActiveJobForBuilding(id) / getPrimaryActiveJob()
getRemainingMs(id) / getProgress(id) / isRunning(id) / isCompleted(id)
rehydrate() → { resumed, completedOffline }
```

## Check reasons

`unknown-upgrade`, `already-completed`, `already-running`, `missing-prerequisite`,
`building-locked`, `tier-not-available`, `insufficient-funds` — each carries a player-facing
`message` so UI never has to invent copy for a failure.

## Ordering guarantees

1. Requirements are validated **before** any currency moves; a rejected start changes nothing.
2. Completion is applied exactly once: the job is removed from `state.upgrades.active`, the
   timer is cancelled, the upgrade is added to `completed`, the building tier is advanced via
   `BuildingSystem.applyTier`, `unlocks` are processed, and `upgrade:completed` is emitted.
3. Cancelling removes the job without applying effects and emits `upgrade:cancelled`.
4. A speed-up that covers the remaining time completes through the timer path, so event
   ordering is identical to a natural completion.

## Persistence & reload

Running jobs live in `GameState.upgrades.active` as absolute timestamps
(`startedAt`, `completesAt`). On load, `rehydrate()`:

- drops jobs whose upgrade id no longer exists in content (content removed/renamed);
- **applies** jobs whose `completesAt` already passed while the game was closed
  ("upgrades finish while you are away");
- re-registers the rest into `TimerSystem` passing the **absolute deadline**, so a resumed job
  finishes at exactly the same wall-clock moment it would have — no drift, no restart.

Upgrade state transitions are asserted in `tests/upgrade-engine.test.ts`
(locked → available → running → completed, plus prerequisites, funds, cancellation, gem
acceleration, ad time-skip, offline completion and partial-elapse resume).

## Why the tier flow lives here

Tier advancement is the *effect* of an upgrade, and the cost/duration/prerequisite data lives
in the upgrade definition. Keeping spend + apply in one place is what prevents
"two code paths that both upgrade a building" — the failure mode this architecture exists to
avoid. `BuildingSystem.applyTier` remains public for content-driven one-off transitions
(scripted unlocks, debug tools), but gameplay must go through upgrades.

## Gems & ads (foundation only)

- **Gem acceleration**: `economy.acceleration { gemsPerMinute, minimumGems }` in content
  converts remaining time to a gem price. Values are placeholders.
- **Rewarded time skip**: `AdRewardSystem` calls `reduceRemaining` only when a reward
  definition says `kind: 'timeSkip'` and only after the provider confirms a completed view.
- Neither is tuned, gated, or surfaced as a final UX in Phase 0.
