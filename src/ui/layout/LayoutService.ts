import { DisposableBag } from '@/core/Disposable';
import { logger } from '@/core/Logger';
import {
  anchorX,
  anchorY,
  computeLayoutMetrics,
  contentBoxUnits,
  isCompactHeight,
  pxToUnits,
  unitsToPx,
  type Insets,
  type LayoutMetrics,
  type Rect,
} from './LayoutMetrics';

/**
 * Owns everything resolution-related.
 *
 * - Reads the real viewport size and CSS safe-area insets (notches, home indicator).
 * - Recomputes the design-unit metrics on resize/rotation (debounced to one per frame
 *   burst via `requestAnimationFrame`).
 * - Emits a single `onChange` callback; UI screens rebuild from metrics rather than
 *   hard-coding coordinates, so gameplay logic is fully resolution independent.
 *
 * The heavy math lives in `LayoutMetrics.ts` (pure + unit tested); this class is only
 * the DOM/Phaser glue.
 */
export interface LayoutHandle {
  readonly metrics: LayoutMetrics;
  /** Design units -> pixels. */
  px(units: number): number;
  /** Pixels -> design units. */
  units(pixels: number): number;
  /** X coordinate in pixels for an anchor inside the play frame. */
  x(anchor: 'left' | 'center' | 'right', offsetUnits?: number): number;
  /** Y coordinate in pixels for an anchor inside the play frame. */
  y(anchor: 'top' | 'middle' | 'bottom', offsetUnits?: number): number;
  /** Content box (frame minus safe areas) in design units. */
  contentBox(): Rect;
  /** Convenience rect in pixels, useful for masks and scroll areas. */
  rectPx(): Rect;
  isCompactHeight(): boolean;
}

/** Minimal structural contract: satisfied by Phaser's ScaleManager and by test doubles. */
export interface ResizableSize {
  width: number;
  height: number;
  resize(width: number, height: number): unknown;
}

export class LayoutService {
  private readonly bag = new DisposableBag();
  private readonly listeners = new Set<(handle: LayoutHandle) => void>();
  private current: LayoutMetrics;
  private readonly probe: HTMLDivElement | null;
  private frameHandle: number | null = null;

  constructor(
    private readonly target: ResizableSize,
    private readonly viewportProvider: () => { width: number; height: number } = defaultViewportProvider,
    private readonly windowRef: Window | null = typeof window === 'undefined' ? null : window,
  ) {
    this.probe = this.createSafeAreaProbe();
    this.current = computeLayoutMetrics(this.viewportProvider(), this.readSafeAreaInsets());

    if (this.windowRef) {
      const onChange = (): void => this.scheduleUpdate();
      this.windowRef.addEventListener('resize', onChange, { passive: true });
      this.windowRef.addEventListener('orientationchange', onChange, { passive: true });
      this.bag.add(() => {
        this.windowRef?.removeEventListener('resize', onChange);
        this.windowRef?.removeEventListener('orientationchange', onChange);
      });
    }

    this.bag.add(() => {
      if (this.frameHandle !== null && this.windowRef) {
        this.windowRef.cancelAnimationFrame(this.frameHandle);
      }
      this.probe?.remove();
    });
  }

  get metrics(): LayoutMetrics {
    return this.current;
  }

  get handle(): LayoutHandle {
    return this.buildHandle();
  }

  /** Subscribe to layout changes (resize, rotation, safe-area change). */
  onChange(listener: (handle: LayoutHandle) => void): () => void {
    this.listeners.add(listener);
    listener(this.buildHandle());
    return this.bag.add(() => this.listeners.delete(listener));
  }

  /** Force a recomputation (used after the parent element is resized). */
  refresh(): void {
    this.scheduleUpdate();
  }

  /** Bypass scheduling - useful in tests. */
  updateNow(): void {
    // Always recompute: safe-area insets can change without a size change (iOS
    // browser chrome, keyboard, rotation between two equal-area orientations).
    const viewport = this.viewportProvider();
    const next = computeLayoutMetrics(viewport, this.readSafeAreaInsets());

    const changed =
      next.viewport.width !== this.current.viewport.width ||
      next.viewport.height !== this.current.viewport.height ||
      next.scale !== this.current.scale;

    this.current = next;

    // Keep Phaser's own size in sync with the DOM. Under Scale.RESIZE Phaser also listens
    // to its parent, but doing it explicitly keeps camera + input hit areas correct after
    // orientation changes on iOS. The 1px tolerance prevents a resize feedback loop when
    // the parent has fractional CSS pixels and Phaser rounds them.
    const widthDrift = Math.abs(this.target.width - next.viewport.width);
    const heightDrift = Math.abs(this.target.height - next.viewport.height);
    if (widthDrift >= 1 || heightDrift >= 1) {
      this.target.resize(next.viewport.width, next.viewport.height);
    }

    if (changed) {
      const handle = this.buildHandle();
      logger.debug('ui', 'layout updated', {
        viewport: `${next.viewport.width}x${next.viewport.height}`,
        units: `${next.viewportUnits.width.toFixed(0)}x${next.viewportUnits.height.toFixed(0)}`,
        letterboxed: next.letterboxed,
      });
      for (const listener of this.listeners) {
        try {
          listener(handle);
        } catch (error) {
          logger.error('ui', 'layout listener failed', error);
        }
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
    this.bag.dispose();
  }

  private scheduleUpdate(): void {
    if (this.frameHandle !== null) return;
    if (!this.windowRef) {
      this.updateNow();
      return;
    }
    this.frameHandle = this.windowRef.requestAnimationFrame(() => {
      this.frameHandle = null;
      this.updateNow();
    });
  }

  private buildHandle(): LayoutHandle {
    const metrics = this.current;
    return {
      metrics,
      px: (units: number) => unitsToPx(metrics, units),
      units: (pixels: number) => pxToUnits(metrics, pixels),
      x: (anchor, offsetUnits = 0) => anchorX(metrics, anchor, offsetUnits),
      y: (anchor, offsetUnits = 0) => anchorY(metrics, anchor, offsetUnits),
      contentBox: () => contentBoxUnits(metrics),
      rectPx: () => metrics.frame,
      isCompactHeight: () => isCompactHeight(metrics),
    };
  }

  /**
   * Safe-area insets via a throwaway element: `env()` values only resolve on real
   * elements, and this keeps index.html free of layout-hack divs.
   */
  private createSafeAreaProbe(): HTMLDivElement | null {
    if (typeof document === 'undefined') return null;
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:0',
      'height:0',
      'visibility:hidden',
      'pointer-events:none',
      'padding-top:env(safe-area-inset-top, 0px)',
      'padding-right:env(safe-area-inset-right, 0px)',
      'padding-bottom:env(safe-area-inset-bottom, 0px)',
      'padding-left:env(safe-area-inset-left, 0px)',
    ].join(';');
    document.body.appendChild(probe);
    return probe;
  }

  private readSafeAreaInsets(): Insets {
    if (!this.probe || typeof window === 'undefined') {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
    const style = window.getComputedStyle(this.probe);
    const parse = (value: string): number => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return {
      top: parse(style.paddingTop),
      right: parse(style.paddingRight),
      bottom: parse(style.paddingBottom),
      left: parse(style.paddingLeft),
    };
  }
}

function defaultViewportProvider(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 720, height: 1280 };
  const root = document.getElementById('game-root');
  if (root && root.clientWidth > 0 && root.clientHeight > 0) {
    return { width: root.clientWidth, height: root.clientHeight };
  }
  // VisualViewport is more accurate while mobile browser chrome collapses.
  const vv = window.visualViewport;
  if (vv) return { width: Math.round(vv.width), height: Math.round(vv.height) };
  return { width: window.innerWidth, height: window.innerHeight };
}
