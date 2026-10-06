/**
 * Viewport + safe-area metrics.
 *
 * UI code never hard-codes pixel coordinates. It reads a `Viewport` (recomputed on
 * every resize / orientation change) and lays out relative to it, so the same
 * layout works on 16:9, 18:9, 19.5:9 and desktop browsers.
 */

import type Phaser from 'phaser';
import { DESIGN, FONT_SCALE } from '@/core/constants';
import { clamp } from '@/core/utils/numbers';

export interface SafeAreaInsets {
  /** Notch / status bar inset in canvas pixels. */
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewportBounds {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  /** Safe-area insets, already scaled into canvas pixels. */
  safeTop: number;
  safeRight: number;
  safeBottom: number;
  safeLeft: number;
  /** Usable height after safe areas - the area gameplay/HUD may occupy. */
  usableHeight: number;
}

export type Orientation = 'portrait' | 'landscape';
export type FontSize = keyof typeof FONT_SCALE;

export class Viewport {
  private widthValue: number = DESIGN.referenceWidth;
  private heightValue: number = DESIGN.referenceHeight;
  private insets: SafeAreaInsets = { ...DESIGN.safeAreaFallback };
  private scaleValue = 1;
  private orientationValue: Orientation = 'portrait';
  private listeners: Array<(viewport: Viewport) => void> = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.refresh();
  }

  /** Recompute metrics; call on Phaser resize events. */
  refresh(): void {
    const width = Math.max(1, Math.round(this.scene.scale.width || 1));
    const height = Math.max(1, Math.round(this.scene.scale.height || 1));
    this.widthValue = width;
    this.heightValue = height;
    this.orientationValue = height >= width ? 'portrait' : 'landscape';
    this.scaleValue = clamp(
      Math.min(width, height) / DESIGN.referenceShortEdge,
      DESIGN.minUiScale,
      DESIGN.maxUiScale,
    );
    this.insets = readSafeAreaInsets(height);
    for (const listener of this.listeners) listener(this);
  }

  onResize(listener: (viewport: Viewport) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  get width(): number {
    return this.widthValue;
  }

  get height(): number {
    return this.heightValue;
  }

  /** UI scale factor derived from the short edge: keeps text readable everywhere. */
  get scale(): number {
    return this.scaleValue;
  }

  get orientation(): Orientation {
    return this.orientationValue;
  }

  get isPortrait(): boolean {
    return this.orientationValue === 'portrait';
  }

  get aspect(): number {
    return this.widthValue / this.heightValue;
  }

  get bounds(): ViewportBounds {
    return {
      width: this.widthValue,
      height: this.heightValue,
      centerX: this.widthValue / 2,
      centerY: this.heightValue / 2,
      safeTop: this.insets.top,
      safeRight: this.insets.right,
      safeBottom: this.insets.bottom,
      safeLeft: this.insets.left,
      usableHeight: this.heightValue - this.insets.top - this.insets.bottom,
    };
  }

  /** Touch target size that respects a minimum physical size on any device. */
  get touchTarget(): number {
    return Math.max(DESIGN.touchTargetMin * this.scaleValue, DESIGN.touchTargetMin * DESIGN.minUiScale);
  }

  /** Font size for a UI text band, floored so it never becomes unreadable. */
  font(size: FontSize): number {
    return Math.max(10, Math.round(Math.min(this.widthValue, this.heightValue) * FONT_SCALE[size]));
  }
}

/**
 * Read CSS `env(safe-area-inset-*)` (notch, home indicator) through the hidden
 * `#safe-area-probe` element. Falls back to zeros on desktop/headless where the
 * values are absent.
 */
export function readSafeAreaInsets(viewportHeight: number): SafeAreaInsets {
  const fallback: SafeAreaInsets = { ...DESIGN.safeAreaFallback };
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;

  const probe = document.getElementById('safe-area-probe');
  if (!probe) return fallback;

  const style = getComputedStyle(probe);
  const read = (property: string): number => {
    const value = Number.parseFloat(style.getPropertyValue(property));
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  };

  const windowHeight = typeof window === 'undefined' ? viewportHeight : window.innerHeight || viewportHeight;
  const scaleFactor = viewportHeight / Math.max(1, windowHeight);

  return {
    top: Math.round(read('padding-top') * scaleFactor),
    right: Math.round(read('padding-right') * scaleFactor),
    bottom: Math.round(read('padding-bottom') * scaleFactor),
    left: Math.round(read('padding-left') * scaleFactor),
  };
}
