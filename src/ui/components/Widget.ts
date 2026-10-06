import Phaser from 'phaser';

import { UI_DEPTH } from '@/core/constants/GameConstants';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import { resolveAnchorPosition, type AnchorX, type AnchorY } from '@/ui/layout/LayoutMetrics';

/**
 * Base class for every UI component.
 *
 * THE UI COORDINATE MODEL
 * =======================
 * There is exactly ONE scaled object in the whole UI: the `UiRoot` container, which is
 * positioned at the play frame and scaled from design units to device pixels. Everything
 * else - screens, panels, buttons, chips - lives inside that root and is authored purely
 * in **design units**.
 *
 * Consequences (all of them intentional):
 * - components never multiply anything by a device scale,
 * - anchors resolve against the frame expressed in design units
 *   (`frameUnits`, typically 720 x N), so 16:9 -> 19.5:9 needs no special cases,
 * - nesting is trivial: a child component just positions itself in its parent's space,
 * - crisp text is one recursive resolution pass on the root, not per-component bookkeeping.
 *
 * `applyLayout` is called by the owning screen on mount and on every resize/rotation.
 */
export interface WidgetOptions {
  readonly anchorX?: AnchorX;
  readonly anchorY?: AnchorY;
  /** Offset from the anchor, in design units. */
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly depth?: number;
  /** Also inset by the device safe area (notch / home indicator). */
  readonly respectSafeArea?: boolean;
  /** Hide until the first layout pass (avoids a visible jump on mount). */
  readonly startHidden?: boolean;
  /**
   * Known size in design units. When supplied, an anchored widget is placed by its *near
   * edge* (so a panel anchored to the bottom sits fully above the screen edge) instead of by
   * its centre - the single most common cause of off-screen UI.
   */
  readonly size?: { readonly width: number; readonly height: number };
}

export abstract class Widget {
  readonly container: Phaser.GameObjects.Container;
  protected readonly scene: Phaser.Scene;
  protected layoutHandle: LayoutHandle | null = null;
  private readonly options: Required<Omit<WidgetOptions, 'depth' | 'size'>> & {
    depth: number;
    size?: { readonly width: number; readonly height: number };
  };

  constructor(scene: Phaser.Scene, options: WidgetOptions = {}) {
    this.scene = scene;
    this.options = {
      anchorX: options.anchorX ?? 'center',
      anchorY: options.anchorY ?? 'middle',
      offsetX: options.offsetX ?? 0,
      offsetY: options.offsetY ?? 0,
      depth: options.depth ?? UI_DEPTH.panels,
      respectSafeArea: options.respectSafeArea ?? false,
      startHidden: options.startHidden ?? false,
      size: options.size,
    };

    this.container = scene.add.container(0, 0).setDepth(this.options.depth);
    if (this.options.startHidden) this.container.setVisible(false);
  }

  get visible(): boolean {
    return this.container.visible;
  }

  get x(): number {
    return this.container.x;
  }

  get y(): number {
    return this.container.y;
  }

  setVisible(visible: boolean): this {
    this.container.setVisible(visible);
    return this;
  }

  setDepth(depth: number): this {
    this.container.setDepth(depth);
    return this;
  }

  setAnchorPosition(x: number, y: number): this {
    this.container.setPosition(x, y);
    return this;
  }

  /** Reparents into another widget's container (design-unit space is preserved). */
  addTo(parent: Phaser.GameObjects.Container | Widget): this {
    const target = parent instanceof Phaser.GameObjects.Container ? parent : parent.container;
    target.add(this.container);
    return this;
  }

  /** Resolves anchors + offsets in design units and then runs the component's own layout. */
  applyLayout(handle: LayoutHandle): this {
    this.layoutHandle = handle;
    if (!this.options.startHidden) this.container.setVisible(true);
    this.container.setPosition(...this.resolveAnchoredPosition(handle));
    this.layout(handle);
    return this;
  }

  protected layout(_handle: LayoutHandle): void {
    /* optional override */
  }

  /**
   * Runs this widget's internal layout *without* repositioning it, for widgets that are
   * nested inside another widget and positioned by their parent.
   */
  applyChildLayout(handle: LayoutHandle): this {
    this.layoutHandle = handle;
    this.layout(handle);
    return this;
  }

  /**
   * Absolute design-unit position for an anchor/offset pair. Screens use this to place
   * things in *frame* space; children inside a widget normally position themselves
   * relative to the widget's own origin instead.
   */
  resolveAnchoredPosition(handle: LayoutHandle): [number, number] {
    return resolveAnchorPosition(handle.metrics, {
      anchorX: this.options.anchorX,
      anchorY: this.options.anchorY,
      offsetX: this.options.offsetX,
      offsetY: this.options.offsetY,
      size: this.options.size,
      respectSafeArea: this.options.respectSafeArea,
    });
  }

  destroy(): void {
    this.container.removeAll(true);
    this.container.destroy();
  }

  protected addToWidget<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.container.add(object);
    return object;
  }
}

/**
 * Recursively raises the render resolution of every Text under `root`.
 * Called once per layout pass by UiRoot (not per component), so a 2x/3x screen gets
 * crisp text without every component knowing about device scale.
 */
export function applyTextResolution(root: Phaser.GameObjects.Container, scale: number): void {
  const resolution = Math.min(3, Math.max(1, scale));
  const stack: Phaser.GameObjects.GameObject[] = [...root.list];
  while (stack.length > 0) {
    const child = stack.pop();
    if (!child) continue;
    if (child instanceof Phaser.GameObjects.Text) {
      if (child.style.resolution !== resolution) child.setResolution(resolution);
      continue;
    }
    if (child instanceof Phaser.GameObjects.Container) {
      stack.push(...child.list);
    }
  }
}

