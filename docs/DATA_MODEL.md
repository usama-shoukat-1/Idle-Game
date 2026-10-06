# Data Model

Three separate models, deliberately not mixed:

| Model | Lives in | Persisted? | Owned by |
|---|---|---|---|
| **Content** (definitions) | `src/data/**` + `ContentRegistry` | no (shipped with the build) | designers |
| **Game state** (player progress) | `GameState` in `src/core/types/state.ts` | yes, versioned | SaveSystem |
| **Runtime** (derived, per session) | `RuntimeSnapshot` + system internals | no | systems |

Rule: if the player can influence it, it is in `GameState`. If it can be recomputed, it is not.

## 1. Content definitions

### BuildingDefinition
`id`, `displayName`, `description`, `stageId`, `type`, `order`, `baseIncome`,
`restorationTiers[]`, `visualStates[]`, `unlockRequirements[]`, `synergyRules[]`,
optional `placeholder { tint, iconKey }`.

### IncomeModel (discriminated union — no magic numbers in code)
```ts
{ kind: 'perInterval', coinsPerInterval, intervalMs }  // classic idle tick
{ kind: 'perSecond',   coinsPerSecond }                // rate-based business
{ kind: 'flat',        coins }                         // one-shot (rate maths ignores it)
```

### RestorationTierDefinition
`tier` (**must equal its array index**, validated), `displayName`, `cost`, `durationMs`,
`incomeMultiplier`, `visualState`, `prerequisites[]`, `unlocks[]`.

**Multiplier semantics:** the active multiplier is the *absolute* multiplier of the current
tier's definition (not a product of all previous tiers). This keeps one tier → one number and
removes a whole class of double-counting bugs. Document any change here before making it.

### UpgradeDefinition
`id`, `displayName`, `description`, `targetBuildingId`, `tier`, `cost`, `durationMs`,
`incomeMultiplier`, `unlocks[]`, `visualState`, `prerequisites[]`,
optional `options { gemAcceleration, rewardedTimeSkip }`.

### StageDefinition / DistrictDefinition
Districts group stages (`stageIds[]`, theme colours). Stages own `buildingIds[]`,
`unlockRequirements[]` and `synergy { masteryMax, synergyScalePercent }`.

### WorkerDefinition
`id`, `displayName`, `hireCost`, `incomeMultiplier`, optional `automationIntervalMs`.
Registered but unused in Phase 0 (automation is Phase 2).

## 2. Game state (persisted)

```ts
GameState {
  schemaVersion
  profile      { playerId, createdAt, saveCount, sessionCount }
  wallet       { coins, gems }
  buildings    { entries: Record<BuildingId, BuildingRuntimeState> }   // sparse
  upgrades     { active: Record<UpgradeId, UpgradeJobState>, completed: UpgradeId[] }
  workers      { entries: Record<WorkerId, WorkerRuntimeState> }
  progression  { currentStageId, stages: Record<StageId, StageProgressState>, unlockedStageIds }
  redevelopment{ level, points }        // prestige placeholder, no economy yet
  session      { startedAt, lastSaveAt, playTimeMs, resumed }
  analytics    { totalCoinsEarned, totalCoinsSpent, totalGemsEarned, totalGemsSpent, lastSessionAt }
  settings     { audio, display, gameplay, notificationsOptIn }
  tutorial     { completed, currentStepId, completedStepIds, skips }
  transactions TransactionLogEntry[]    // bounded (200), most recent last
}
```

Notes:
- `session.lastSaveAt` is the anchor for offline progression — see `SAVE_SYSTEM.md`.
- `buildings.entries` is **sparse**: a row is created on first interaction
  (`BuildingSystem.ensureRuntime`), so a 45-building game does not pay for 45 idle rows.
- `incomeProgress` is a cached display value only; all maths derives from timestamps, so a
  stale value can never affect income.
- `TransactionLogEntry.reason` is the analytics/debug tag passed to every economy call.

## 3. Runtime model (not persisted)

`RuntimeSnapshot` (frames/offline counters/FPS) and system-owned internals such as
`TimerSystem`'s live timer map. `System.lint`: never add a runtime-only field to
`GameState` — it would be written to storage and go stale on the next load.

## 4. Adding content (the whole process)

1. `src/data/buildings/building_x.ts` → export a `BuildingDefinition` (id, tiers, visual states).
2. Register it in `src/data/buildings/index.ts`.
3. Reference the id from the owning stage in `src/data/districts/*`.
4. Add the tier upgrades in `src/data/upgrades/index.ts` (tier indices must match).
5. `npm test` — `ContentRegistry.validate()` fails the build on inconsistent content
   (missing stage, tier index mismatch, unknown visual state, unknown prerequisite, …).
