# Save System

Single owner: `src/systems/SaveSystem/*`. **No scene, system or UI component may touch
storage, serialise state, or write `state.*` from outside its own system API.**

## Public API

```ts
save.save(reason?)      // → { ok, bytes?, reason? }   never throws
save.load()             // → { state, status: 'fresh' | 'loaded' | 'recovered', issues, migratedFrom }
save.hasSave()          // → boolean
save.reset(options)     // → fresh GameState (written in place, see below)
save.wipe()             // removes every key in the namespace
save.getLastSavedAt()   // → epoch ms | null
save.markDirty()        // autosave/visibility flush will persist it
```

Storage access goes through `StorageDriver` (`src/services/storage/StorageDrivers.ts`):
`LocalStorageDriver` (namespace `restore-it.*`), `MemoryStorageDriver` (tests / blocked
storage). Swapping to IndexedDB, a native bridge or cloud saves is a one-line change in
`main.ts` — the save format does not move.

## Envelope

```json
{
  "schemaVersion": 1,
  "savedAt": 1762250000000,
  "savedAtIso": "2025-11-04T12:33:20.000Z",
  "gameVersion": "0.1.0-phase0",
  "checksum": "1f2k3z",
  "state": { /* GameState */ }
}
```

The envelope exists so a migration can read *which* schema produced a blob before touching
it, and so the timestamp is trustworthy even if the state body is partially unreadable.
`checksum` is a djb2 hash: corruption detection, never security.

## Load pipeline

```
read → JSON.parse → envelope checks → structural validation → migration chain
     → sanitize (repair) → merge defaults → hand to systems
```

Guarantees (each has a test in `tests/save-system.test.ts`):

| Situation | Behaviour |
|---|---|
| No save | fresh state, `status: 'fresh'` |
| Valid save | `status: 'loaded'`, `profile.sessionCount++`, `session.resumed = true` |
| Invalid JSON / not an object | payload archived to `save.backup`, fresh state, `status: 'recovered'` |
| Checksum mismatch | issue reported, state still validated and loaded |
| Repairable damage (negative wallet, bad timestamps, non-array journal) | repaired, issues reported |
| Unknown stage ids | dropped; missing stage rows created |
| Invalid upgrade job (`completesAt < startedAt`, NaN) | job removed |
| Newer schema than the build | archived + fresh state with an explicit reason |
| Unmigratable old schema | archived + fresh state with an explicit reason |

`status: 'recovered'` is the only path that discards player progress, and it always keeps the
broken blob in `restore-it.save.backup` for inspection.

## Migrations

`src/systems/SaveSystem/Migrations.ts` holds an ordered, append-only chain
(`from → to`, pure function, never throws). Phase 0 ships schema **1** and an empty chain:
the machinery is exercised by tests that feed it synthetic old/future versions.

Rules for every future migration:
1. return a new object — never mutate the input;
2. be safe to run twice (do not double-apply bonuses);
3. never throw on missing fields; fall back to defaults and let `sanitizeState` finish;
4. add a test.

To ship one: bump `SAVE_SCHEMA_VERSION`, append `{ from: N, to: N+1, ... }`, add the test.

## Reset semantics (important)

`GameState` is a stable object reference shared by every system (economy, buildings,
upgrades, UI). `save.reset()` therefore **rewrites the tree in place**
(`replaceStateContents`) instead of replacing the reference — otherwise systems would keep
mutating a detached object and the game would silently ignore the reset.
`tests/session-lifecycle.test.ts` guards this.

## When saves happen

- periodic autosave (`AUTOSAVE_INTERVAL_MS`, 20 s) **only when state is dirty**;
- immediately on `visibilitychange → hidden` and `pagehide` (mobile browsers can kill a tab);
- on `beforeunload`;
- on explicit requests (pause menu, scene exit);
- any meaningful state change marks the save dirty automatically (`ServiceContainer`
  subscribes to economy/upgrade/building/stage events).

Because `session.lastSaveAt` is refreshed on every write, the offline-progression anchor is
never more than ~20 seconds stale.

## Offline anchor contract

- Written on every save (`lastSaveAt` = save time).
- Read on load; a missing/invalid/far-future anchor is rejected (`isPlausibleTimestamp`).
- Never trusted blindly: elapsed time is clamped to `economy.offline.maxDurationMs` and
  negative elapsed is treated as 0.

### Pending offline rewards (Phase 1)

The offline payout is **not** granted at load. `state.offline.pending` holds the calculated
reward (`coins`, `elapsedMs`, `effectiveElapsedMs`, `capped`, `perBuilding`, `boosted`) until the
player collects it, which is what makes the summary popup honest and duplicate-proof:

- reloading before collecting keeps the same reward (`settle()` **merges** a new window into an
  already pending one instead of overwriting it — sum of coins/elapsed, union of the per-building
  breakdown, `capped` OR-ed, so nothing is lost and nothing overlaps);
- collecting clears the pending reward *before* the payout, so a failure mid-collect cannot pay
  twice (losing a reward is recoverable; duplicating it is not);
- income anchors are advanced when the reward is *calculated*, never when it is collected, so the
  same span can never be earned as both offline and live income;
- an upgrade that completed while the game was closed is applied with
  `applyTier(..., { preserveIncomeAnchor: true })`, so its tier change does not rewind the income
  anchor and silently discard the absence (`docs/PHASE_1_QA.md` §3, bug 1).
