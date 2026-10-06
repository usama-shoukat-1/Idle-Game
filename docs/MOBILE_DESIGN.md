# Mobile Design

Mobile portrait is the primary target. Desktop is a development/test surface that must work
but is not a separate design.

## 1. Design units — the one rule

No UI element is positioned with raw device pixels.

- The play frame is always **720 design units wide** (`DESIGN_WIDTH`).
- The frame is as tall as the viewport, so taller phones simply get **more vertical room**:
  16:9 → 1280, 18:9 → 1440, 19.5:9 → 1560, 21:9 → 1680 design units of height.
- The scale is `min(width / 720, height / 1280)`. On short/landscape viewports (desktop dev
  windows, landscape tablets) that keeps a **centred portrait strip** instead of a stretched or
  oversized layout.
- `LayoutService` converts, `LayoutMetrics` computes, and `UiRoot` applies the single
  design-unit → pixel transform.

```
LayoutMetrics (pure, unit tested)  →  LayoutService (DOM/Phaser glue, resize events)
                                   →  UiRoot (one scaled container per scene)
                                   →  Screen + Widget anchors
```

Every supported aspect ratio is verified in `tests/layout-metrics.test.ts`
(16:9, 18:9, 19.5:9, 20:9, 360x640, 1920x1080, 1280x900, 820x1180).

## 2. Safe areas

`LayoutService` reads CSS `env(safe-area-inset-*)` through a throwaway probe element, converts
them to design units and clamps them. `Widget`/`Screen` expose `respectSafeArea` and
`safe.top/bottom/left/right` helpers, so notches and home indicators are handled by anchoring,
not by per-device offsets. `index.html` additionally pads `#game-root`.

A landscape phone shows the rotate hint (`#orientation-hint`); everything else keeps playing.

## 3. Touch ergonomics

- `MIN_TOUCH_TARGET = 88` design units ≈ 44 CSS px on a 360 pt phone.
- Buttons give press feedback on pointer **down** and cancel on pointer-out.
- Sliders jump to the tapped position (no thumb-grabbing).
- World gestures go through `InputSystem`: tap (24 px slop), long press (500 ms), drag, swipe
  (48 px / 220 px/s). Gesture timing uses pointer event timestamps, so behaviour is identical
  at 30/60/144 fps.
- Modals swallow world input (`UiRoot.isOpen()`), so a tap can never fight the UI.

## 4. Performance rules

| Rule | Why |
|---|---|
| No physics engine configured | an idle game has no simulation step to pay for |
| Timers are timestamp comparisons | no per-object `setInterval`, survives suspension |
| UI text updates are throttled (4 Hz) and guarded by `setTextIfChanged` | Phaser re-rasterises text textures on every `setText` |
| Entities are pooled (`CustomerPool`) | no GC spikes during play |
| Textures are generated once and reused | fill-rate/bandwidth limits on mobile GPUs |
| Event-driven UI, no polling | idle games are mostly waiting |
| `RESIZE` scale mode + one scaled root | no per-frame layout maths in the render loop |
| Canvas backing store = CSS pixels, text resolution adapts | 3x DPR canvas costs ~9x fill rate |

## 5. Accessibility & comfort (foundation)

- `settings.display.reducedMotion` exists and is honoured by new animation work.
- Volume sliders + mute are wired to `AudioSystem`, and the audio context unlocks on the first
  gesture (mobile policy).
- Keyboard debug shortcuts exist for development only (F1–F6, 1) and are gated by
  `FEATURE_FLAGS.debugTools`.

## 6. Not yet done (Phase 1+)

- Haptics (the setting exists, no implementation yet).
- Landscape "wide" layout variant — currently letterboxed by design.
- Web fonts / localisation (locale is stored, content is English-only).
- Device-tier quality scaling (the `display.quality` setting is stored but unused).
