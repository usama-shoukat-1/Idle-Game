/**
 * Layout helpers.
 *
 * Everything is expressed as a fraction of the viewport (plus safe-area insets),
 * never as absolute pixels, so a 16:9 tablet and a 19.5:9 phone both get a sane HUD.
 */

import type { Viewport } from './Viewport';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Band of the screen reserved for the top currency bar. */
export function topBarRect(viewport: Viewport): Rect {
  const { bounds } = viewport;
  const height = Math.round(Math.max(bounds.width * 0.14, viewport.font('xl') * 2.4));
  return {
    x: bounds.safeLeft,
    y: bounds.safeTop,
    width: bounds.width - bounds.safeLeft - bounds.safeRight,
    height,
  };
}

/** Central content area between the top bar and the bottom panel. */
export function contentRect(viewport: Viewport, bottomPanelHeight = 0): Rect {
  const bar = topBarRect(viewport);
  const top = bar.y + bar.height + Math.round(viewport.font('sm') * 0.5);
  const bottom = viewport.height - viewport.bounds.safeBottom - bottomPanelHeight - Math.round(viewport.font('sm') * 0.75);
  return {
    x: bar.x,
    y: top,
    width: bar.width,
    height: Math.max(0, bottom - top),
  };
}

/** Bottom sheet used by the building/upgrade panels. */
export function bottomSheetRect(viewport: Viewport, fraction = 0.42): Rect {
  const { bounds } = viewport;
  const height = Math.round(bounds.usableHeight * fraction);
  return {
    x: bounds.safeLeft + Math.round(bounds.width * 0.04),
    y: viewport.height - bounds.safeBottom - height - Math.round(bounds.width * 0.03),
    width: bounds.width - bounds.safeLeft - bounds.safeRight - Math.round(bounds.width * 0.08),
    height,
  };
}

/** A centered rect (popups/modals) sized as a fraction of the viewport. */
export function centeredRect(viewport: Viewport, widthFraction = 0.82, heightFraction = 0.5): Rect {
  const width = Math.round(viewport.width * widthFraction);
  const height = Math.round(viewport.bounds.usableHeight * heightFraction);
  return {
    x: Math.round((viewport.width - width) / 2),
    y: Math.round(viewport.bounds.safeTop + (viewport.bounds.usableHeight - height) / 2),
    width,
    height,
  };
}

export function insetRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x + padding,
    y: rect.y + padding,
    width: Math.max(0, rect.width - padding * 2),
    height: Math.max(0, rect.height - padding * 2),
  };
}

/** Evenly distribute `count` rows inside a rect (list rendering without manual maths). */
export function rowRects(rect: Rect, count: number, gap: number): Rect[] {
  if (count <= 0) return [];
  const totalGap = gap * (count - 1);
  const rowHeight = (rect.height - totalGap) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: rect.x,
    y: rect.y + index * (rowHeight + gap),
    width: rect.width,
    height: rowHeight,
  }));
}

export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}
