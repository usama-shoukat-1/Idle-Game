# Phase 1 — Old Café Vertical Slice

One building, played from a fresh install to a completed business, proving the commercial core
loop: **restore → earn → wait → come back → restore further**. Everything below is content; the
systems that run it are the generic Phase 0 systems.

Status: playable vertical slice. Not commercially ready, not balanced for release, no live
monetization. See `docs/PHASE_1_QA.md` for the verification evidence and known limitations.

## 1. Content map

| Id | Kind | File |
|---|---|---|
| `stage_old_neighborhood` | stage "Old Neighborhood" | `src/data/districts/district_01_old_town.ts` |
| `building_old_cafe` | building | `src/data/buildings/building_old_cafe.ts` |
| `old_cafe_tier_01` … `old_cafe_tier_10` | upgrades (one per tier) | `src/data/upgrades/old_cafe_tiers.ts` |
| `tutorial.old_cafe.*` | 7 tutorial steps | `src/data/tutorial/old_cafe_tutorial.ts` |
| economy balance | wallet, offline, acceleration, 4 rewarded rewards | `src/data/economy/balance.ts` |
| gem catalog (mock) | `gems.small` / `gems.medium` / `gems.large` | `src/config/content/index.ts` |

No scene, system or save file knows the café exists: it is a `BuildingDefinition` plus ten
`UpgradeDefinition`s. Adding the next location is a data change (see the header comment in
`src/config/content/index.ts`).

## 2. Restoration table

`baseIncome` for the café is `1 coin / minute`, so a tier's `incomeMultiplier` **is** its income
in coins per minute. Income is only ever produced by `BuildingSystem.accrueIncome` (timestamps,
never frame counting) and only paid through `EconomySystem`.

| Tier | Step | Cost (coins) | Duration | Income after (coins/min) |
|---|---|---|---|---|
| 0 | As found (derelict) | — | — | 0 |
| 1 | Clear the debris | 75 | instant | 0 |
| 2 | Repair the furniture | 125 | instant | 25 |
| 3 | Restore the electricity | 200 | 10 s | 40 |
| 4 | Rebuild the counter | 300 | 20 s | 65 |
| 5 | Fit the kitchen | 500 | 45 s | 100 |
| 6 | Add seating | 800 | 2 min | 160 |
| 7 | Hire the first worker | 1,250 | 5 min | 250 |
| 8 | Menu & table service | 2,000 | 12 min | 400 |
| 9 | Expand the frontage | 3,250 | 25 min | 650 |
| 10 | Premium renovation | 5,250 | 45 min | 1,050 |
| | **Total** | **13,750** | | |

A new save starts with **500 coins** — enough for tier 1 (75) and tier 2 (125) immediately, so
income starts inside the first minute. The first timed step (tier 3) is affordable after about
8 minutes of tier-2 income, and each later step requires either patience or an optional boost:
that is the idle loop. `tests/phase1-acceptance.test.ts` proves the whole table is reachable by
idling alone (well under a game day) with no dead ends.

Visual phases: **A Recovery** (tiers 1–3: debris cleared, furniture, lights on), **B Opening**
(4–6: counter, kitchen, seating), **C Growth** (7–10: worker, menu, extension, premium finish +
completion reveal). Each tier has its own illustration layer; removals (debris, boarded windows)
are separate layers that switch off, because a `Graphics` layer can only add.

## 3. Core loop rules

1. **Validate → spend → start → persist → update.** `UpgradeSystem.canStart` → `EconomySystem.spend`
   → instant apply or timed job (`TimerSystem`) → `SaveSystem.save` → UI refresh. A scene never
   mutates the wallet.
2. **Timers are deadlines, not counters.** `completesAt` is stored; a reload, a backgrounded tab
   or a suspended phone cannot drift or lose a job. Jobs that finished while the game was closed
   are applied on load (`UpgradeSystem.rehydrate`).
3. **Offline income is calculated, never paid at load.** `LoadingScene` → `OfflineIncomeSystem.settle()`
   stores a pending reward; the player sees a popup with COLLECT, and an *optional* ad to double
   it. The pending reward is part of the save, so reloading before collecting cannot lose it or
   pay it twice.
4. **Income feedback is restrained.** A small coin pop and a floating `+N` per accrual tick, a
   soft coin cue, a smooth counter. No particles, no screen shake, no per-frame DOM work.
5. **The café is alive during upgrades.** The illustration keeps its idle ambience, income keeps
   accruing, customers keep visiting, and the player can inspect future steps, watch an ad, or
   leave and come back — nothing asks them to stare at a timer.

## 4. Monetization (mocks only)

Provider-independent services (`MockRewardedAdService`, `MockPurchaseService`) behind
`AdRewardSystem` / `PurchaseSystem`. Rewarded ads are strictly opt-in: every button states the
reward, nothing auto-plays, nothing interrupts, and a reward with no valid target is refused
without consuming the view.

| Reward id | Placement | Effect | Cooldown |
|---|---|---|---|
| `reward.bonus_coins` | `placement.bonus_coins` | 8% of the next restoration cost, clamped to 50–500 coins | 5 min |
| `reward.upgrade_speedup` | `placement.upgrade_speedup` | 25% of the remaining job, capped at 15 min per view | 5 min |
| `reward.income_boost` | `placement.income_boost` | 2× café income for 30 minutes (extend, never stack) | 20 min |
| `reward.offline_double` | `placement.offline_double` | 2× the pending offline reward, once per absence | — |

Gems: 1 gem per remaining minute (minimum 1) to finish the running job instantly; the shop sells
100 / 600 / 1,500 gem packs through the mock store with clearly-labelled mock prices. These gem
values are placeholders for the flow, **not** final monetization balance. No ad unit ids, no
store SKUs and no billing code exist in the repository.

## 5. Onboarding

Seven content steps (`TUTORIAL_OLD_CAFE`) advance on domain events, so the tutorial contains no
gameplay logic: intro → first restoration → second step → income begins → next restoration →
"upgrades keep running while you are away" → optional speed-up ad. Steps that explain rather than
instruct need a `GOT IT` tap; the whole tutorial can be skipped at any time and the skip is
remembered in the save. It never blocks input.

## 6. Completion

Reaching tier 10 emits `building:completed` once, with the final income rate and the total
restoration cost (13,750). The completion popup shows `OLD CAFÉ RESTORED`, the final
coins/minute, the total spent, the completion percentage, and an inactive
`NEXT LOCATION — COMING NEXT` action — the honest placeholder for Phase 2 content.

## 7. Development tools (development builds only)

`npm run dev` binds the F-keys; a production build binds none of them and registers no cheat
handler at all.

| Key | Action |
|---|---|
| `F1` | toggle the FPS/state overlay (with a key legend) |
| `F2` | +1,000 coins |
| `F3` | +50 gems |
| `F4` | café tier +1 (wraps at max) — walks every visual state |
| `F5` | finish the running upgrade instantly |
| `F6` | reset the save |
| `F7` | simulate an offline absence (pending reward + popup) |
| `F8` | toggle the mock ad provider (proves the "unavailable" path) |
| `F9` | advance the clock by 60 s |
| `F10` | toggle the mock store |

`window.__RESTORE_IT__.context.debug` exposes the same tools plus `stateSummary()` / `stateSnapshot()`
for QA.

## 8. Known approximations and deliberate limits

- **Offline rate after a closed-game completion.** If an upgrade finished while the game was
  closed, the absence is paid at the tier the player returns to (one rate for the whole window),
  because the accrual model evaluates one rate per span. It always rounds in the player's favour
  and is bounded by one tier step. A future improvement is a segmented (per-tier timeline) payout.
- **Boosts apply at the rate evaluated while the boost is active.** A 2× boost that expires during
  a long absence therefore does not retroactively double offline income.
- **Balance is intentionally generous early.** 1,050 coins/min at tier 10 is a slice-level number
  chosen for a sub-hour review session, not a retention-tuned curve.
- **No live services.** No ad network, no billing, no analytics backend, no cloud saves; the
  providers are mocks and the analytics service counts events in memory.
