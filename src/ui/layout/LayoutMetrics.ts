import { DESIGN_MIN_HEIGHT, DESIGN_WIDTH } from '@/core/constants/Layout';
import { clamp } from '@/core/utils/NumberUtils';

/**
 * Pure layout math - no Phaser, no DOM, no globals.
 *
 * The game is authored in *design units*: the play frame is always `DESIGN_WIDTH`
 * wide and at least `DESIGN_MIN_HEIGHT` tall. Taller phones simply receive more
 * vertical space; desktop/landscape viewports are letterboxed to a portrait frame
 * instead of stretching the UI.
 *
 * Being pure makes this the one part of the responsive system that is fully unit
 * tested across aspect ratios (see tests/layout-metrics.test.ts).
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutMetrics {
  /** Device/viewport size in pixels. */
  readonly viewport: Size;
  /** Play frame in pixels (a centred portrait strip on wide viewports). */
  readonly frame: Rect;
  /** Pixels per design unit. */
  readonly scale: number;
  /** The visible area expressed in design units (may be wider than DESIGN_WIDTH). */
  readonly viewportUnits: Size;
  /** The play frame expressed in design units: always DESIGN_WIDTH wide. */
  readonly frameUnits: Rect;
  /** Safe-area insets (notches, home indicator) expressed in design units. */
  readonly safeAreaUnits: Insets;
  /** True when the frame is narrower than the viewport (letterboxing is active). */
  readonly letterboxed: boolean;
  /** Portrait means height >= width. Used to decide layout variants. */
  readonly isPortrait: boolean;
}

export const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Computes layout metrics for a viewport.
 *
 * @param viewport Pixels of the usable viewport (already excluding CSS safe areas if
 *                 the host page applies them; pass `safeAreaPx` for the raw insets).
 * @param safeAreaPx Raw CSS safe-area insets in pixels.
 */
export function computeLayoutMetrics(viewport: Size, safeAreaPx: Insets = ZERO_INSETS): LayoutMetrics {
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));

  // Scale is the *smaller* of the two fits, so the design frame can never be larger than
  // the viewport:
  //  - width-fit (width / DESIGN_WIDTH) is used by every phone: the UI fills the screen
  //    horizontally and the extra height of a tall phone becomes extra design height;
  //  - height-fit (height / DESIGN_MIN_HEIGHT) takes over on short/landscape viewports
  //    (desktop dev windows, tablets in landscape), which is what produces the centred
  //    portrait strip instead of a squashed or over-sized layout.
  const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_MIN_HEIGHT);

  // The frame is always DESIGN_WIDTH wide and always as tall as the viewport, so the
  // design-space height grows with the device aspect ratio (16:9 -> 19.5:9 -> 21:9).
  const frameUnitsWidth = DESIGN_WIDTH;
  const frameUnitsHeight = Math.max(DESIGN_MIN_HEIGHT, height / scale);
  const frameUnitsX = (width / scale - frameUnitsWidth) / 2;

  const frameWidth = frameUnitsWidth * scale;
  const frameHeight = frameUnitsHeight * scale;
  const frameX = frameUnitsX * scale;
  const frameY = 0;

  const toUnits = (pixels: number): number => pixels / scale;

  // Convert px insets into design units and clamp so a bogus inset can never eat the frame.
  const safeAreaUnits: Insets = {
    top: clamp(toUnits(safeAreaPx.top), 0, toUnits(height) * 0.25),
    bottom: clamp(toUnits(safeAreaPx.bottom), 0, toUnits(height) * 0.25),
    left: clamp(toUnits(safeAreaPx.left), 0, toUnits(width) * 0.25),
    right: clamp(toUnits(safeAreaPx.right), 0, toUnits(width) * 0.25),
  };

  return {
    viewport: { width, height },
    frame: { x: frameX, y: frameY, width: frameWidth, height: frameHeight },
    scale,
    viewportUnits: { width: toUnits(width), height: toUnits(height) },
    frameUnits: {
      x: frameUnitsX,
      y: 0,
      width: frameUnitsWidth,
      height: frameUnitsHeight,
    },
    safeAreaUnits,
    letterboxed: frameX > 0.5 || frameY > 0.5,
    isPortrait: height >= width,
  };
}

export type AnchorX = 'left' | 'center' | 'right';
export type AnchorY = 'top' | 'middle' | 'bottom';

export interface AnchorPlacement {
  readonly anchorX: AnchorX;
  readonly anchorY: AnchorY;
  readonly offsetX?: number;
  readonly offsetY?: number;
  /** Size in design units: when given, the widget is placed by its near edge. */
  readonly size?: { readonly width: number; readonly height: number };
  /** Inset by the device safe area as well. */
  readonly respectSafeArea?: boolean;
}

/**
 * Resolves an anchored design-unit position inside the play frame.
 *
 * Placing a widget by its *near edge* (rather than its centre) when a size is provided is what
 * keeps panels and buttons fully on screen - the single most common source of off-screen mobile
 * UI. Pure and unit tested (tests/layout-metrics.test.ts).
 */
export function resolveAnchorPosition(metrics: LayoutMetrics, placement: AnchorPlacement): [number, number] {
  const frame = metrics.frameUnits;
  const safe = placement.respectSafeArea ? metrics.safeAreaUnits : ZERO_INSETS;
  const halfWidth = (placement.size?.width ?? 0) / 2;
  const halfHeight = (placement.size?.height ?? 0) / 2;
  const offsetX = placement.offsetX ?? 0;
  const offsetY = placement.offsetY ?? 0;

  const baseX = placement.anchorX === 'left' ? safe.left : placement.anchorX === 'right' ? frame.width - safe.right : frame.width / 2;
  const directionX = placement.anchorX === 'left' ? 1 : placement.anchorX === 'right' ? -1 : 0;

  const baseY = placement.anchorY === 'top' ? safe.top : placement.anchorY === 'bottom' ? frame.height - safe.bottom : frame.height / 2;
  const directionY = placement.anchorY === 'top' ? 1 : placement.anchorY === 'bottom' ? -1 : 0;

  return [baseX + directionX * (offsetX + halfWidth), baseY + directionY * (offsetY + halfHeight)];
}

/** Convenience: converts design units to pixels for the given metrics. */
export function unitsToPx(metrics: LayoutMetrics, units: number): number {
  return units * metrics.scale;
}

/** Convenience: converts pixels to design units for the given metrics. */
export function pxToUnits(metrics: LayoutMetrics, pixels: number): number {
  return pixels / metrics.scale;
}

/** Anchored positions inside the frame, in pixels. UI components use these. */
export function anchorX(metrics: LayoutMetrics, anchor: 'left' | 'center' | 'right', offsetUnits = 0): number {
  const offset = unitsToPx(metrics, offsetUnits);
  switch (anchor) {
    case 'left':
      return metrics.frame.x + offset;
    case 'right':
      return metrics.frame.x + metrics.frame.width - offset;
    default:
      return metrics.frame.x + metrics.frame.width / 2 + offset;
  }
}

export function anchorY(metrics: LayoutMetrics, anchor: 'top' | 'middle' | 'bottom', offsetUnits = 0): number {
  const offset = unitsToPx(metrics, offsetUnits);
  switch (anchor) {
    case 'top':
      return metrics.frame.y + offset;
    case 'bottom':
      return metrics.frame.y + metrics.frame.height - offset;
    default:
      return metrics.frame.y + metrics.frame.height / 2 + offset;
  }
}

/** Content box = frame minus safe-area insets, in design units. */
export function contentBoxUnits(metrics: LayoutMetrics): Rect {
  return {
    x: metrics.safeAreaUnits.left,
    y: metrics.safeAreaUnits.top,
    width: metrics.frameUnits.width - metrics.safeAreaUnits.left - metrics.safeAreaUnits.right,
    height: metrics.frameUnits.height - metrics.safeAreaUnits.top - metrics.safeAreaUnits.bottom,
  };
}

/** True for aspect ratios that need vertically compressed UI (short phones). */
export function isCompactHeight(metrics: LayoutMetrics): boolean {
  return metrics.frameUnits.height < DESIGN_MIN_HEIGHT + 40;
}
