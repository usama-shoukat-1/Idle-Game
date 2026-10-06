# Mobile Design Foundation

Target: modern phones in **portrait**, 16:9 → 19.5:9 and beyond, plus desktop browsers for
development. Touch is the primary input; mouse/keyboard exist for dev/testing only.

## Resolution strategy

- `scale.mode = Phaser.Scale.RESIZE` — the canvas is exactly the window/screen, no letterboxing.
- `src/ui/layout/Viewport.ts` recomputes on every resize:
  - `width`/`height`, `orientation`, `aspect`
  - `scale` = `clamp(min(w,h) / 720, 0.62, 1.9)` — one UI scale for the whole HUD
  - `bounds` with `safeTop/Right/Bottom/Left` and `usableHeight`
  - `font(band)` for text sizes (`xs…title`) and `touchTarget` for minimum hit size
- Safe areas come from CSS `env(safe-area-inset-*)` read through the hidden
  `#safe-area-probe` element (notch / home indicator).
- Layout helpers (`topBarRect`, `contentRect`, `bottomSheetRect`, `centeredRect`,
  `rowRects`) express everything as fractions of the viewport. **No UI element is placed
  with hard-coded pixel coordinates.**

Gameplay is independent of display resolution: simulation works in seconds/milliseconds
and logical units, and only the view layer maps to pixels.

## Orientation

Portrait is the design target. In landscape on a small screen the DOM overlay
`#rotate-hint` asks the player to rotate; tablet/desktop landscape keeps working (the
layout is fraction-based, so panels simply get wider).

## Input

`src/systems/InputSystem/InputManager.ts` wraps Phaser's pointer/keyboard plugins and
publishes semantic events: `tap`, `drag`, `dragend`, `swipe`, `key`. Defaults are
mobile-tuned (16px tap slop, 350ms tap window, 550px/s swipe threshold) and live in one
place. Gameplay subscribes to `onTap/onDrag/onSwipe` — it never reads raw pointer state.
Desktop debug keys are registered through `registerKeyAction()` (dev builds only).

## Performance rules followed in Phase 0

- **No physics engine, no particle systems** (`physics` intentionally not configured).
- **Event-driven UI**: panels repaint on events (`economy:changed`, `upgrade:*`,
  `timer:completed`), not by polling state every frame.
- **Timestamps instead of per-object timers**: one comparison per running timer per frame;
  no `setInterval` per building.
- **Throttled work**: timer progress events at

  `config.timerProgressIntervalMs` (250ms), debug overlay at 2Hz, income flushes at
  `balance.incomeTickMs`, autosave only when dirty.
- **Texture reuse**: a single 1×1 pixel texture plus a handful of generated placeholder
  textures; UI panels are `Graphics` so no per-size textures are created.
- **DPR clamped to 2** and `powerPreference: 'low-power'` to protect mobile fill rate and
  battery.
- **No DOM UI** beyond the boot splash/rotate hint (removed once the canvas is up).

## Audio policy

Browsers block audio before a user gesture. `AudioManager.unlock()` is called on the first
tap; the manager keeps master/music/sfx volumes + mute in save settings. Phase 0 ships no
audio files, so playback no-ops cleanly.

## Manual device checklist

See `docs/PHASE_0_QA.md` for the concrete steps (portrait/landscape, reload persistence,
notch insets, background/foreground, tap targets).
