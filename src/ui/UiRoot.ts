import Phaser from 'phaser';

import { DisposableBag } from '@/core/Disposable';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import type { PopupHost, UiServices } from '@/ui/UiServices';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import { applyTextResolution } from '@/ui/components/Widget';

/**
 * THE UI ROOT
 * ===========
 * A single container per scene that:
 *  1. sits at the play frame and scales design units -> device pixels,
 *  2. hosts every screen/panel/popup of that scene,
 *  3. re-runs layout (including text resolution) once per viewport change.
 *
 * Scenes therefore do nothing layout related beyond:
 *
 *   const ui = new UiRoot(this, services);
 *   ui.mount(new HudScreen(services));
 *
 * Screens are plain objects that can be mounted/unmounted at will (a pause screen on top
 * of a live HUD, a popup above both), because the root is also a z-ordered container.
 */
export interface UiScreen {
  readonly container: Phaser.GameObjects.Container;
  applyLayout(handle: LayoutHandle): void;
  /** Optional per-frame hook; only screens that must animate implement it. */
  update?(time: number, delta: number): void;
  destroy(): void;
}

/**
 * Popup host that resolves its UiRoot lazily. Scenes need the host *before* the root
 * exists (services are built first), and this keeps that ordering from leaking try/catch
 * or null checks into every screen.
 */
export class LazyPopupHost implements PopupHost {
  constructor(private readonly resolve: () => UiRoot) {}

  open(popup: UiScreen): void {
    this.resolve().open(popup);
  }

  close(popup: UiScreen): void {
    this.resolve().close(popup);
  }

  isOpen(): boolean {
    return this.resolve().isOpen();
  }
}

export class UiRoot implements PopupHost {
  readonly container: Phaser.GameObjects.Container;
  private readonly bag = new DisposableBag();
  private readonly screens = new Set<UiScreen>();
  private readonly popups = new Set<UiScreen>();

  constructor(scene: Phaser.Scene, services: UiServices) {
    this.container = scene.add.container(0, 0).setDepth(UI_DEPTH.panels);

    // `onChange` fires immediately, which performs the first layout pass.
    this.bag.add(
      services.layout.onChange((handle) => {
        this.applyLayout(handle);
      }),
    );

    // Screens opt into updates; the root skips idle ones so the loop stays cheap.
    const onUpdate = (time: number, delta: number): void => {
      for (const screen of this.screens) {
        screen.update?.(time, delta);
      }
    };
    scene.events.on('update', onUpdate);
    this.bag.add(() => scene.events.off('update', onUpdate));
  }

  get screenCount(): number {
    return this.screens.size;
  }

  isOpen(): boolean {
    return this.popups.size > 0;
  }

  /** Mounts a modal screen above the rest of the UI (see PopupHost). */
  open(popup: UiScreen): void {
    this.popups.add(popup);
    this.mount(popup, UI_DEPTH.popups + this.popups.size);
  }

  close(popup: UiScreen): void {
    this.popups.delete(popup);
    this.unmount(popup, true);
  }

  mount(screen: UiScreen, depth?: number): UiScreen {
    this.screens.add(screen);
    this.container.add(screen.container);
    if (depth !== undefined) screen.container.setDepth(depth);
    if (!this.currentHandle) {
      throw new Error('UiRoot.mount() called before the first layout pass');
    }
    screen.applyLayout(this.currentHandle);
    return screen;
  }

  unmount(screen: UiScreen, destroy = true): void {
    this.screens.delete(screen);
    if (destroy) screen.destroy();
    else this.container.remove(screen.container);
  }

  /** Brings a screen to the front (used when a popup opens over the HUD). */
  bringToFront(screen: UiScreen): void {
    this.container.bringToTop(screen.container);
  }

  refreshLayout(): void {
    if (!this.currentHandle) return;
    this.applyLayout(this.currentHandle);
  }

  dispose(): void {
    this.popups.clear();
    for (const screen of [...this.screens]) {
      this.screens.delete(screen);
      screen.destroy();
    }
    this.container.removeAll(true);
    this.container.destroy();
    this.bag.dispose();
  }

  private currentHandle: LayoutHandle | null = null;

  private applyLayout(handle: LayoutHandle): void {
    this.currentHandle = handle;
    const { frame, scale } = handle.metrics;
    // The only design-unit -> pixel conversion in the entire UI.
    this.container.setPosition(frame.x, frame.y);
    this.container.setScale(scale);

    for (const screen of this.screens) {
      screen.applyLayout(handle);
    }
    applyTextResolution(this.container, scale);
  }
}
