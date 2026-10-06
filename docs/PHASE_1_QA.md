# Phase 1 QA — Old Café Vertical Slice

Verification evidence for `docs/PHASE_1_OLD_CAFE.md`. Two parts: what is proven automatically
(§1–§3) and what still needs a human in front of a screen (§4). Everything below was run against
the working tree that produced this document.

## 1. Automated gates

```bash
npm run typecheck   # tsc --noEmit, strict
npm test            # 14 files, 214 tests
npm run build       # typecheck + vite production build
npm run dev         # dev server on 0.0.0.0:5173 (debug tools enabled)
npm run preview     # serves the production bundle on 0.0.0.0:4173
```

| Check | Result |
|---|---|
| `npm run typecheck` | clean (0 errors) |
| `npm test` | 14 files / 214 tests passed |
| `npm run build` | succeeded — `index` 175.71 kB (gzip 49.72 kB), `phaser` 1.208 MB (gzip 332.21 kB), sourcemaps on |
| Dev server | boots, all Phase 1 modules compile (200s on every scene/system/UI module) |
| Release build | `debugTools` flag `false` → no F-keys bound, no cheat handler registered |

## 2. Phase 1 test suites

| File | Tests | What it proves |
|---|---|---|
| `tests/phase1-old-cafe.test.ts` | 22 | content/balance table, new-game state, income maths, upgrade flow, restoration to tier 10, save integrity, schema-v1 migration, 30-minute run |
| `tests/phase1-monetization.test.ts` | 18 | all four rewarded rewards (amounts, caps, cooldowns, dismissal, provider disabled), 2× boost across a reload, mock gem packs, gem acceleration, analytics contract |
| `tests/phase1-offline.test.ts` | 16 | 4-hour cap, the brief's 9,600-coin example, pending-not-paid model, doubling the pending reward, reload before collecting, duplicate-collection guard, clock tampering, corrupt save |
| `tests/phase1-tutorial.test.ts` | 5 | 7 content steps, event-driven advancement, skip persistence, tutorial never blocks play |
| `tests/phase1-acceptance.test.ts` | 3 | the whole acceptance flow on one save; "no dead ends" walk of all 10 tiers; 24-hour economy invariant run |
| Phase 0 suites (9 files) | 150 | the foundation the slice runs on, unchanged and still green |

Notable assertions that would catch real regressions:

- **The brief's offline example is exact:** tier 6 (160 coins/min) × 60 minutes = 9,600 coins.
- **The restoration total is exact:** the ten tiers cost 13,750 coins and nothing else is charged.
- **No upgrade dead ends:** starting from a fresh wallet, every tier becomes affordable through
  income alone (`minutes < 24 h` for the full restoration).
- **Offline cannot be double-collected:** collect-then-reload yields a skip and no second payout.
- **Reload before collecting cannot lose the reward:** the second window is *merged* into the
  pending reward (9,600 + 1,600 = 11,200), not overwritten.
- **The wallet stays consistent:** `totalCoinsEarned − totalCoinsSpent === walletDelta` after
  86,400 income ticks.

## 3. Bugs found and fixed while testing Phase 1

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | Offline earnings vanished when an upgrade had completed while the game was closed | `UpgradeSystem.rehydrate()` applied the tier, which re-anchored `lastIncomeAt` to "now", so the offline window had zero elapsed time | `applyTier` accepts `{ preserveIncomeAnchor }` and rehydration passes it (`BuildingSystem`, `UpgradeSystem`) |
| 2 | Reloading with an uncollected offline reward replaced it with a much smaller one (up to 4 hours of earnings lost) | `OfflineIncomeSystem.settle()` overwrote `state.offline.pending` | `settle()` now merges consecutive uncollected windows (sum + per-building breakdown merge) |
| 3 | Income accumulator expectation was wrong in a test, not in the game | Integer coin payouts carry a sub-coin remainder | Test rewritten as a drift bound (`payTotal ∈ [exact − 1, exact]`, never behind) |

## 4. Manual QA checklist (needs a human + a browser)

Run `npm run dev` and open the preview. These are the parts automated tests cannot cover.

**First run / onboarding**
- [ ] New save shows 500 coins, 0 gems, `Old Café · Tier 0 / 10`, `Not earning yet`.
- [ ] Tutorial banner shows the intro step; `GOT IT` advances it.
- [ ] `RESTORE FOR 75` restores tier 1: debris disappears, coins drop to 425.
- [ ] Tier 2 (`RESTORE FOR 125`) starts income: the illustration changes again and the HUD shows
      `25 Coins/min`.
- [ ] Tier 3 shows an upgrade in progress: `UPGRADING`, remaining time counting down, progress bar.

**Timer / lifecycle**
- [ ] Reload mid-upgrade: the job resumes with the correct remaining time.
- [ ] Backgrounding the tab and returning does not reset or duplicate progress.
- [ ] `F9` (advance 60 s) moves the timer; `F5` finishes it and the café visibly changes tier.

**Ads (opt-in only)**
- [ ] Ad buttons appear only when the reward is offered, and always state the reward.
- [ ] Watching a speed-up ad removes a quarter of the remaining time.
- [ ] `F8` disables the mock provider: ad buttons disappear or refuse with a message, and the
      game continues normally.
- [ ] Nothing auto-plays an ad, at any point in the flow.

**Offline**
- [ ] Close the game for a few minutes, come back: the offline popup appears with a plausible
      amount; `COLLECT` adds it to the wallet.
- [ ] The optional ad doubles the popup amount; dismissing still collects the earned coins.
- [ ] Set the device clock back, reload: no negative balance, no crash, no payout.

**Store / gems**
- [ ] Gem counter opens the mock store; it is clearly labelled as a mock purchase.
- [ ] Buying a pack adds gems and never claims a real payment.
- [ ] Finishing an upgrade with gems deducts the cost shown on the button.

**Completion**
- [ ] `F4` cycling shows every tier's illustration (no blank or repeated states).
- [ ] Reaching tier 10 shows `OLD CAFÉ RESTORED` with the final income, the total spent and an
      inactive `NEXT LOCATION — COMING NEXT`.
- [ ] Customers appear from tier 4 and increase with the tier, without affecting income.

**Layout**
- [ ] 720×1280, 1080×1920, a narrow portrait (e.g. 360×780) and a desktop window all render
      without overlap or clipped text; the CTA stays reachable with one thumb.
- [ ] Rotating a phone/tablet does not leave ghost UI.

## 5. Known limitations (carried into Phase 2)

1. Offline income after a closed-game completion pays the whole absence at the returned tier (see
   `docs/PHASE_1_OLD_CAFE.md` §8) — an approximation in the player's favour, bounded by one tier.
2. A 2× boost that expires during an absence does not retroactively double offline income.
3. Balance is a slice-level curve, not a retention-tuned economy; gem acceleration and mock prices
   are placeholders.
4. No live ad network, billing, analytics backend or cloud save: all providers are mocks.
5. No art assets — the café is procedural vector art (deliberate: no binary assets in the repo).
6. Browser-level verification (touch feel, animation smoothness, audio mix) still requires manual
   QA on a device; this repository cannot automate a real browser.
