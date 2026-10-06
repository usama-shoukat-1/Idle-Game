# Upgrade System

`src/systems/UpgradeSystem/UpgradeSystem.ts` — one engine for instant upgrades, timed
upgrades, prerequisites, costs, gem acceleration and completion effects. Which upgrades
exist (and what they do) is content.

## Flow

```
evaluate(upgradeId)                     // pure: no mutation
   → start(upgradeId)
       ├─ durationMs === 0  → complete instantly (inline)
       └─ durationMs > 0    → TimerSystem.start({ kind: 'upgrade', meta: { upgradeId } })
                              → 'timer:completed' → complete()
   → complete()
       ├─ BuildingSystem.applyUpgradeEffects(buildingId, upgradeId, effects)
       ├─ BuildingSystem.setTier(...) when definition.tier > 0
       ├─ BuildingSystem.setVisualState(...) when definition.visualStateId is set
       ├─ non-local effects (unlock-building / unlock-district / offline-capacity)
       ├─ state.upgrades.completed / stats.upgradesCompleted
       ├─ emit 'upgrade:completed'
       └─ ProgressionSystem.onUpgradeCompleted() → district progress, mastery, stage unlocks
```

Because completion is driven by the **timer event**, an upgrade that finished while the
app was closed is completed at the right timestamp on load
(`OfflineIncomeSystem.syncTimers()`), not "when the player looks at it".

## Availability codes

`ok`, `unknown-upgrade`, `already-active`, `already-completed`, `max-purchases`,
`no-target`, `target-locked`, `prerequisites`, `not-affordable`.
Each `UpgradeAvailability` also carries `cost`, `skipCostGems`, `remainingMs`,
`durationMs` and `buildingId`, which is everything the UI needs to render a row without
duplicating rules.

## Gem acceleration

`computeSkipCost(definition, remainingMs)` = `ceil(remainingMinutes * gemSkipRatePerMinute)`
(the player never gets a cheaper deal by waiting). `gemSkipRatePerMinute` is content; when
it is undefined, acceleration is disabled for that upgrade. `skipWithGems()` charges gems
through the economy (`upgrade:skip`), completes the timer, and returns the gems spent.

## Cancellation

`cancel(upgradeId, refund?)` cancels the timer and clears the active record; with
`refund: true` the paid cost is returned through `upgrade:refund`. Instant upgrades that
already completed cannot be cancelled.

## State transitions covered by tests (`tests/upgrades.test.ts`)

- locked target refuses the upgrade and charges nothing
- instant upgrade: effect applied, tier changed, visual state changed, coins charged
- timed upgrade: timer created with the right `endsAt`, completes only after the
  timestamp passes, applies effects + tier
- prerequisites blocked (`prerequisites`) with a machine-readable reason
- double-start blocked (`already-active`)
- unaffordable blocked (`not-affordable`)
- gem acceleration completes the upgrade and charges the right gems
- cancellation with refund restores the wallet
- non-local effects (unlock-district) route through the progression system

## Deliberately not in Phase 0

Final upgrade values, the Old Café, upgrade art, gem packs, "speed up with ad" reward
placements and prestige. Those are content + Phase 1+ work.
