/**
 * Layout constants for the design-unit system.
 *
 * THE RULE: no UI element is positioned with raw device pixels. The game renders in
 * *design units* where the play frame is always `DESIGN_WIDTH` wide; the height grows
 * with the device aspect ratio (16:9 -> 19.5:9 -> modern tall phones). See
 * `src/ui/layout/LayoutMetrics.ts` and docs/MOBILE_DESIGN.md.
 */

/** Play frame width in design units. Everything scales from this number. */
export const DESIGN_WIDTH = 720;

/**
 * Minimum play frame height (16:9 portrait). Taller devices get *more* vertical room
 * instead of stretched UI, and shorter/landscape viewports are letterboxed to this.
 */
export const DESIGN_MIN_HEIGHT = 1280;

/** Reference height (18:9) used for authoring vertical rhythm. */
export const DESIGN_REFERENCE_HEIGHT = 1440;

/** Aspect ratios we explicitly support (width / height). */
export const DESIGN_ASPECT = {
  /** 16:9 - the shortest portrait we support. */
  portrait16x9: 720 / 1280,
  /** 18:9 contemporary phones. */
  portrait18x9: 720 / 1440,
  /** 19.5:9 modern flagships. */
  portrait19p5x9: 720 / 1560,
  /** 20:9 / 21:9 tall devices. */
  portrait21x9: 720 / 1680,
} as const;

/** Spacing scale in design units. UI code composes these instead of inventing values. */
export const SPACING = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 72,
  huge: 96,
} as const;

/** Corner radii for placeholder panels/buttons, in design units. */
export const RADIUS = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

/** Typography scale in design units (font sizes passed to Phaser text styles). */
export const FONT_SIZE = {
  micro: 16,
  tiny: 20,
  small: 24,
  body: 28,
  title: 36,
  heading: 48,
  display: 64,
} as const;

/** Font families with mobile-safe fallbacks (no web fonts in Phase 0). */
export const FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Minimum touch target in design units (>= 44 CSS px on a 360pt wide phone). */
export const MIN_TOUCH_TARGET = 88;

/** Placeholder palette (Phase 0 only - final art direction comes later). */
export const PALETTE = {
  background: 0x0e1116,
  surface: 0x1b2330,
  surfaceAlt: 0x243040,
  outline: 0x35455c,
  text: 0xe8eef6,
  textMuted: 0x93a1b3,
  accent: 0xf2b544,
  coin: 0xf2b544,
  gem: 0x5fd0ff,
  success: 0x5cd68a,
  warning: 0xf0a13c,
  danger: 0xe4606f,
  /** Restoration before/after placeholder tints. */
  dilapidated: 0x4a4f57,
  restored: 0x7fd8b0,
} as const;

/** Font family values are duplicated as CSS strings for Phaser text styles. */
export const COLORS_CSS = {
  text: '#e8eef6',
  textMuted: '#93a1b3',
  accent: '#f2b544',
  gem: '#5fd0ff',
  success: '#5cd68a',
  danger: '#e4606f',
  warning: '#f0a13c',
} as const;
