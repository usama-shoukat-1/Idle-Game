# Save System

`src/systems/SaveSystem/**` — the only component allowed to touch browser storage.

## Format

```jsonc
{
  "schemaVersion": 1,
  "savedAt": 1700000000000,
  "appVersion": "0.1.0-phase0",
  "data": { /* GameState */ }
}
```

- Always an **envelope** so an old payload can be detected and migrated.
- Payloads without an envelope (hand-written/legacy) are treated as `schemaVersion: 0`
  and go through the repair path.
- Stored under `STORAGE_KEYS.save` (`restore-it:save:v1`) via a `StorageAdapter`.

## API

```ts
save(state, reason): SaveResult      // serialize + write + emit save:saved
load(): LoadResult                   // read + migrate + validate + emit save:loaded
hasSave(): boolean
peek(): SaveStatus                   // metadata only, no repair
reset(): GameState                   // dev/QA + player "reset save"
exportRaw(state): string             // debug export
importRaw(text): LoadResult          // debug import (same repair path)
```

`SaveReason` (`autosave`, `manual`, `scene-change`, `visibility-hidden`, `state-change`,
`debug`, `shutdown`) is recorded for logging; `save:saved` carries it for telemetry later.

## Migrations

`SaveMigrations.ts` holds `Record<number, (data) => data>` keyed by the version it
migrates **from**. Rules:

- Never edit a shipped migration; add a new one and bump `SAVE_SCHEMA_VERSION`.
- If no migration is registered for a gap, the validator repairs field by field
  (documented Phase 0 behaviour) instead of throwing away the save.
- A save from a *newer* schema than the build is flagged (`fromFuture`) rather than
  destructively downgraded.

## Validation + repair

`validateAndRepairGameState(raw, { now, balance, content, defaults })`:

- Non-object payload → defaults + an `error` issue.
- Every numeric field is range-clamped (`tier` ≤ definition `maxTier`, volumes 0..1),
  every list is filtered against registered content ids, every timestamp is sanitized
  (invalid/negative/implausible-future → `now`).
- Wrong-typed values fall back to the balance/state defaults instead of inventing values;
  negative balances clamp to zero.
- Buildings and districts missing from the payload are rebuilt from the content registry,
  so a user who removes content temporarily does not lose progress.
- Expired boosts/timers are dropped on load.
- The repair report (`issues`) is surfaced at boot (`LoadingScene`) as a warning toast.

## Storage abstraction

`StorageAdapter` (`getItem`/`setItem`/`removeItem`/`keys`/`isAvailable`) with two
implementations: `LocalStorageAdapter` and `MemoryStorageAdapter`. When localStorage is
blocked (embedded webview, strict privacy mode) the game boots with memory storage and
warns instead of crashing. Replacing localStorage with IndexedDB or a native bridge is a
single-file change.

## Rules

- Scenes must never read or write storage; they call `SaveSystem`.
- Autosave only runs when the state store is dirty (fewer writes, less mobile IO).
- Every save path first calls `OfflineIncomeSystem.anchor()`, so `lastSessionTime` is a
  reliable offline anchor.
- `visibilitychange` (hidden) and `pagehide` trigger a save; `GameScene` also autosaves
  on `config.autosaveIntervalMs`.
