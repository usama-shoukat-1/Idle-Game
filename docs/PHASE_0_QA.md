# Phase 0 QA Checklist

Foundation verification. This phase ends when the reusable systems are functional — not when
there is gameplay content (there deliberately is none).

## 1. Automated gates

```bash
npm install
npm run typecheck     # strict TypeScript, zero errors
npm test              # unit + integration suite
npm run build         # production bundle (typecheck + vite build)
npm run dev           # http://localhost:5173
```

| Check | Expected |
|---|---|
| `npm run typecheck` | no errors |
| `npm test` | all tests pass (9 files: economy, save, timer, upgrade, offline, state, layout, content, session lifecycle) |
| `npm run build` | `dist/` produced; phaser + game chunks; no warnings other than chunk size |
| Dev server console | no errors, no unhandled rejections |

## 2. Runtime / scene flow

- [ ] Boot splash disappears and the canvas appears.
- [ ] Scene order observed in the console: `boot complete` → `preload complete` → main menu.
- [ ] Main menu shows title, Play, Settings, wallet line, save-age line and a build stamp.
- [ ] Play → LoadingScene (`Restoring the district…`) → GameScene placeholder world.
- [ ] GameScene shows the stage card (stage name + description from content), the top bar with
      coins and gems, and a hint line.
- [ ] Pause (☰) → Pause → Resume works; Main menu returns to the menu.
- [ ] Settings from both menu and pause; rotating/closing the settings screen leaves no ghost UI.

## 3. Input (mobile + desktop)

- [ ] Tapping the world shows the "Input works" toast.
- [ ] Long press (>500 ms without moving) shows the long-press toast.
- [ ] A quick swipe shows a direction toast; dragging does not fire a tap.
- [ ] Buttons ignore a press that is released outside them.
- [ ] While a modal is open, world taps do nothing.
- [ ] Desktop keyboard shortcuts work: `F1` overlay, `F2` coins, `F3` gems, `F4` unlock,
      `F5` finish timers, `F6` reset, `1` unlock stage.

## 4. State, save & load

- [ ] On first run the wallet matches the placeholder starting balance in
      `src/data/economy/balance.ts`.
- [ ] Debug `+coins` increases the HUD immediately (event-driven UI, no refresh needed).
- [ ] Reload the page: wallet, stage, progress and settings survive.
- [ ] Pause → "Save now" reports success in a toast.
- [ ] Settings → "Reset save" wipes progress (confirm dialog first) and the HUD returns to the
      starting balance — **without a page reload**.
- [ ] DevTools: `localStorage.getItem('restore-it.save.v1')` is a versioned envelope with
      `schemaVersion`, `savedAt`, `savedAtIso`, `gameVersion`, `checksum`, `state`.
- [ ] DevTools: `window.__RESTORE_IT__.context.debug.stateSummary()` prints the state summary.
- [ ] Corrupt the save (`localStorage.setItem('restore-it.save.v1', '{broken')`) and reload:
      the game starts fresh, logs the issue, and archives the junk to `restore-it.save.backup`.

## 5. Timestamp / offline foundation

- [ ] Close the tab (or hide it) for 2+ minutes, reopen: the LoadingScene/log reports the
      elapsed absence.
- [ ] With `offline.efficiency: 0` (Phase 0 default) **no coins are awarded** and the reason
      `zero-efficiency` appears in the console log — this is the expected foundational state.
- [ ] Temporarily set `offline.efficiency: 0.5` in `src/data/economy/balance.ts` and repeat:
      coins are granted once, tagged `offline.income`, and a second settlement in the same
      session grants nothing.
- [ ] Set the OS clock backwards by an hour and reload: no negative income, no crash, and the
      log reports `clock-backwards`.

## 6. Economy & timer APIs

- [ ] Debug `+coins` / `+gems` work; spending more than the balance never happens
      (covered automatically, but confirm no negative numbers appear in the HUD).
- [ ] Settings → "Preview offline reward" opens a reward popup describing the elapsed time,
      cap and efficiency.
- [ ] With no upgrades registered, an upgrade action reports a clear reason instead of
      silently doing nothing.

## 7. Responsive scaling

Test in DevTools device toolbar (portrait) and as a desktop window:

- [ ] 720x1280 (16:9), 1080x2160 (18:9), 1170x2532 (19.5:9), 360x640 (small phone).
- [ ] 1920x1080 and 1280x900 desktop windows → portrait strip, horizontally centred, UI legible.
- [ ] Rotating the device mid-session re-lays out the HUD without restarting the game.
- [ ] Nothing overlaps the top bar or the bottom toasts at any of the above sizes.
- [ ] Buttons are comfortably tappable (>= 44 CSS px) on the smallest phone.

## 8. Performance sanity

- [ ] With `F1` overlay open on a mid-range phone, idle FPS stays at the target (60) and the
      game does not drop frames while a timer counts down.
- [ ] Backgrounding the tab for a minute and returning does not corrupt timers or the clock.
- [ ] No memory growth when tapping the world repeatedly (customer entities are pooled).

## 9. Explicitly out of scope for Phase 0

Not defects — deliberately absent, and required before Phase 1 ships to players:

- no Old Café or any building content,
- no restoration gameplay or puzzle,
- no final economy balance or offline tuning,
- no ad network or store integration,
- no prestige, events, story or 45-level progression,
- no art or audio assets.
