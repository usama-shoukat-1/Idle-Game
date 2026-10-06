# Phase 0 — QA Checklist

Scope reminder: Phase 0 is the technical foundation. There is intentionally **no gameplay
content** yet — no Old Café, no buildings, no balanced economy, no ads, no purchases.

## 1. Automated checks

```bash
npm install
npm run typecheck     # TypeScript strict, no errors
npm run test          # 86 unit tests (vitest, node env, no DOM/Phaser needed)
npm run build         # production bundle
npm run dev           # dev server on http://localhost:5173
```

| Suite | Covers |
|---|---|
| `tests/economy.test.ts` | cannot overspend, negative/NaN/Infinity rejected, atomic multi-currency cost, reason counters, events |
| `tests/timers.test.ts` | timestamp maths, completion-once, pause/resume, reduce/extend, purge, invalid/future timestamp handling, offline cap |
| `tests/save.test.ts` | no-save path, round trip, reset, unreadable payload, partial payload repair, legacy payload, export/import |
| `tests/gameState.test.ts` | default state shape, JSON-serializable, repair rules (currencies, tiers, ids, timestamps, timers) |
| `tests/upgrades.test.ts` | locked target, instant upgrade, timed upgrade via timer, prerequisites, double-start, unaffordable, gem skip, cancel+refund, district effects |
| `tests/buildings.test.ts` | content-derived state, no income while locked, accrual + flush, unlock timing, modifier hooks, district progress, visual states |
| `tests/offline.test.ts` | sub-threshold windows, same-pipeline estimate, cap, invalid timestamp, claim-once, absorb, timer catch-up, disable switch |
| `tests/entities.test.ts` | building entity facade, worker assignment/level caps, customer visit lifecycle + patience |
| `tests/content.test.ts` | id lookup, duplicate ids, cross-reference validation, empty-content warning, opt-in ad policy, district grouping |
| `tests/monetization.test.ts` | rewarded ad granted/dismissed/cooldown/daily-limit/unavailable, timer-reduction reward, gem pack, entitlement, cancellation, unknown product, provider prices |

## 2. Runtime smoke test (browser)

1. `npm run dev`, open the preview (port 5173).
2. **Splash** disappears once the engine is ready (no black screen).
3. Scene flow: Boot → Preload (progress bar) → Loading ("Reading save data" … "Restoring
   systems") → **Main Menu** (title, Play, Settings, Reset save, build/content info).
4. Main menu shows a toast: "Fresh start • no save yet" on a first run, or
   "Save loaded • schema v1" after a reload.
5. Press **Play** → Game scene: top currency bar, three HUD buttons, world placeholder
   text, building panel with an explicit empty state, upgrade panel with an empty state.
6. **Input**: tap the world → `taps` counter increments in the debug overlay; tapping the
   probe pulses it (dev builds also add +1 coin with the reason `dev:probe`).
7. **Save/load**: in a dev build tap the probe a few times → "Save now" → reload the page →
   the coin count is preserved and the menu reports "Save loaded".
8. **Reset save**: Main Menu → "Reset save" → confirm → balances return to the balance
   defaults and a fresh default state is created.
9. **Settings**: open Settings → drag each volume slider (values persist to the save),
   toggle mute/haptics, close. Verify `sfx`/`music` never throw without audio files.
10. **Offline foundation**: with a save present, wait > 1 minute (or run
    `__RESTORE_IT__.tools` from the console: nothing needed — simply reload after a
    minute) → the "Welcome back" popup appears only when elapsed ≥ `offline.minElapsedMs`
    and something was earned; "Collect" credits the coins exactly once.
11. **Debug tools** (dev only, `?debug=1`): overlay shows FPS/coins/income/timers; keys
    `1` add coins, `2` add gems, `3` unlock all buildings, `4` unlock next stage,
    `5` finish timers, `6` toggle overlay, `7` reset save, `8` print a state summary.
    `window.__RESTORE_IT__` exposes the same helpers.
12. **No blocking console errors.** Warnings are acceptable only for expected conditions
    (e.g. "no building definitions registered yet", "save payload repaired").

## 3. Responsive / mobile checks

Simulate in devtools or use a device:

- [ ] 16:9 portrait (e.g. 1080×1920), 18:9, 19.5:9 (e.g. 1170×2532), tablet, desktop window.
- [ ] Rotating/resizing reflows the currency bar, panels, buttons, toasts (no clipping, no
      overlapping HUD, no elements off-screen).
- [ ] Safe areas: on a notched device the top bar and bottom panel stay clear of the notch
      and home indicator.
- [ ] Buttons are comfortably tappable (≥ ~48 logical px); taps near the edge of a button
      do not misfire.
- [ ] Landscape on a phone shows the "rotate to portrait" hint.
- [ ] Backgrounding the browser then returning does not freeze timers, double income, or
      lose progress (income math is timestamp-based).
- [ ] Reload mid-session keeps progress; the offline window starts from the last save.

## 4. Known limitations (expected in Phase 0)

- Content is empty: no buildings/upgrades/districts/events/products/ad placements ship.
- All art is procedurally generated placeholder graphics; no audio files exist.
- Economy balance values are placeholders and are not tuned.
- `MockAdRewardService` / `MockPurchaseService` only — no real ad or store integration.
- No prestige/redevelopment, no workers, no customers, no events.
