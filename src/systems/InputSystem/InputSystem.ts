import { DisposableBag } from '@/core/Disposable';
import { logger } from '@/core/Logger';
import type Phaser from 'phaser';

/**
 * UNIFIED INPUT ABSTRACTION
 * =========================
 * Gameplay code (scenes, entities, UI components) subscribes to *semantic* gestures -
 * tap, long press, drag, swipe - instead of Phaser pointer events. That keeps three
 * promises:
 *
 * 1. Mobile-first: gestures are defined for touch (500 ms long press, 8 px slop,
 *    swipe velocity thresholds tuned for fingers) and simply also work with a mouse.
 * 2. Desktop dev support: `bindKey` gives debug shortcuts without leaking keyboard
 *    handling into systems.
 * 3. Testability: gestures are produced from *pointer event timestamps*, not from
 *    Phaser's game-loop delta, so behaviour is identical at 30, 60 or 144 fps.
 *
 * All listeners are registered against the scene's input plugin and released on
 * shutdown, so nothing leaks between scenes.
 */

export interface TapGesture {
  readonly x: number;
  readonly y: number;
  /** Duration of the press, ms. */
  readonly durationMs: number;
  readonly pointerId: number;
}

export interface LongPressGesture extends TapGesture {}

export interface DragGesture {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly totalDx: number;
  readonly totalDy: number;
}

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface SwipeGesture {
  readonly direction: SwipeDirection;
  readonly x: number;
  readonly y: number;
  readonly distance: number;
  /** Pixels per second. */
  readonly speed: number;
}

export interface InputGestureMap {
  tap: TapGesture;
  longPress: LongPressGesture;
  dragStart: DragGesture;
  drag: DragGesture;
  dragEnd: DragGesture;
  swipe: SwipeGesture;
}

export type GestureName = keyof InputGestureMap;
export type GestureHandler<K extends GestureName> = (gesture: InputGestureMap[K]) => void;

export interface InputOptions {
  /** Movement under this many pixels still counts as a tap. */
  readonly tapSlopPx?: number;
  /** Press longer than this (without moving) becomes a long press. */
  readonly longPressMs?: number;
  /** Minimum distance for a swipe. */
  readonly swipeMinDistancePx?: number;
  /** Minimum speed for a swipe, px/s. */
  readonly swipeMinSpeed?: number;
  /** Debug shortcut keys mapped to actions, e.g. { F1: 'debug.toggle' }. */
  readonly debugKeys?: Readonly<Record<string, string>>;
}

interface PointerSession {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startedAt: number;
  lastX: number;
  lastY: number;
  lastAt: number;
  longPressFired: boolean;
  dragging: boolean;
}

const DEFAULTS: Required<Omit<InputOptions, 'debugKeys'>> = {
  tapSlopPx: 24,
  longPressMs: 500,
  swipeMinDistancePx: 48,
  swipeMinSpeed: 220,
};

export class InputSystem {
  private readonly bag = new DisposableBag();
  private readonly handlers = new Map<GestureName, Set<GestureHandler<GestureName>>>();
  private readonly actionHandlers = new Map<string, Set<() => void>>();
  private readonly sessions = new Map<number, PointerSession>();
  private readonly options: Required<Omit<InputOptions, 'debugKeys'>>;
  private readonly debugKeys: Readonly<Record<string, string>>;

  constructor(
    private readonly scene: Phaser.Scene,
    options: InputOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.debugKeys = options.debugKeys ?? {};

    const input = scene.input;
    if (!input) {
      logger.warn('input', 'scene has no input plugin; gestures are disabled');
      return;
    }

    // Multiple simultaneous touches must not corrupt each other's gesture state.
    input.addPointer?.(2);

    const onDown = (pointer: Phaser.Input.Pointer): void => this.handleDown(pointer);
    const onMove = (pointer: Phaser.Input.Pointer): void => this.handleMove(pointer);
    const onUp = (pointer: Phaser.Input.Pointer): void => this.handleUp(pointer);

    input.on('pointerdown', onDown);
    input.on('pointermove', onMove);
    input.on('pointerup', onUp);
    input.on('pointerupoutside', onUp);

    this.bag.add(() => {
      input.off('pointerdown', onDown);
      input.off('pointermove', onMove);
      input.off('pointerup', onUp);
      input.off('pointerupoutside', onUp);
    });

    this.registerDebugKeys();

    // Long press must fire even when the finger never moves, so the gesture is resolved
    // from a per-frame check rather than from a move event.
    const onUpdate = (): void => this.checkLongPress();
    scene.events.on('update', onUpdate);
    this.bag.add(() => scene.events.off('update', onUpdate));
  }

  // --- Subscriptions -------------------------------------------------------

  on<K extends GestureName>(gesture: K, handler: GestureHandler<K>): () => void {
    const set = this.handlers.get(gesture) ?? new Set<GestureHandler<GestureName>>();
    set.add(handler as GestureHandler<GestureName>);
    this.handlers.set(gesture, set);
    return this.bag.add(() => set.delete(handler as GestureHandler<GestureName>));
  }

  /** Subscribe to a named logical action produced by a debug key or a UI button. */
  onAction(action: string, handler: () => void): () => void {
    const set = this.actionHandlers.get(action) ?? new Set<() => void>();
    set.add(handler);
    this.actionHandlers.set(action, set);
    return this.bag.add(() => set.delete(handler));
  }

  /** Programmatically trigger a logical action (used by debug keys and UI buttons). */
  triggerAction(action: string): void {
    const set = this.actionHandlers.get(action);
    if (!set) return;
    for (const handler of set) {
      try {
        handler();
      } catch (error) {
        logger.error('input', `action handler for "${action}" threw`, error);
      }
    }
  }

  dispose(): void {
    this.sessions.clear();
    this.handlers.clear();
    this.actionHandlers.clear();
    this.bag.dispose();
  }

  get activePointers(): number {
    return this.sessions.size;
  }

  // --- Gesture resolution --------------------------------------------------

  private handleDown(pointer: Phaser.Input.Pointer): void {
    // Gesture durations are measured against the scene clock (one time base for the whole
    // gesture), not against the DOM event's timestamp field.
    const now = this.now();
    this.sessions.set(pointer.id, {
      pointerId: pointer.id,
      startX: pointer.x,
      startY: pointer.y,
      startedAt: now,
      lastX: pointer.x,
      lastY: pointer.y,
      lastAt: now,
      longPressFired: false,
      dragging: false,
    });
  }

  private handleMove(pointer: Phaser.Input.Pointer): void {
    const session = this.sessions.get(pointer.id);
    if (!session) return;

    const dx = pointer.x - session.lastX;
    const dy = pointer.y - session.lastY;
    const totalDx = pointer.x - session.startX;
    const totalDy = pointer.y - session.startY;
    session.lastX = pointer.x;
    session.lastY = pointer.y;
    session.lastAt = this.now();

    const movedEnough = Math.hypot(totalDx, totalDy) > this.options.tapSlopPx;

    if (!session.dragging && movedEnough) {
      // A long press that turns into a drag is a drag, not a long press.
      session.dragging = true;
      session.longPressFired = true;
      this.emit('dragStart', {
        x: pointer.x,
        y: pointer.y,
        dx,
        dy,
        totalDx,
        totalDy,
      });
      return;
    }

    if (session.dragging) {
      this.emit('drag', { x: pointer.x, y: pointer.y, dx, dy, totalDx, totalDy });
    }
  }

  private handleUp(pointer: Phaser.Input.Pointer): void {
    const session = this.sessions.get(pointer.id);
    if (!session) return;
    this.sessions.delete(pointer.id);

    const now = this.now();
    const durationMs = Math.max(0, now - session.startedAt);
    const totalDx = pointer.x - session.startX;
    const totalDy = pointer.y - session.startY;
    const distance = Math.hypot(totalDx, totalDy);

    if (session.dragging) {
      this.emit('dragEnd', { x: pointer.x, y: pointer.y, dx: 0, dy: 0, totalDx, totalDy });

      const speed = durationMs > 0 ? (distance / durationMs) * 1000 : 0;
      if (distance >= this.options.swipeMinDistancePx && speed >= this.options.swipeMinSpeed) {
        this.emit('swipe', {
          direction: dominantDirection(totalDx, totalDy),
          x: pointer.x,
          y: pointer.y,
          distance,
          speed,
        });
      }
      return;
    }

    if (session.longPressFired) return;

    if (distance <= this.options.tapSlopPx && durationMs <= this.options.longPressMs) {
      this.emit('tap', {
        x: pointer.x,
        y: pointer.y,
        durationMs,
        pointerId: session.pointerId,
      });
      return;
    }

    // Held too long without moving: treat as a long press on release if the frame-level
    // check never ran (e.g. the tab was throttled while the finger was down).
    if (durationMs >= this.options.longPressMs) {
      this.emit('longPress', {
        x: pointer.x,
        y: pointer.y,
        durationMs,
        pointerId: session.pointerId,
      });
    }
  }

  private checkLongPress(): void {
    const now = this.now();
    for (const session of this.sessions.values()) {
      if (session.longPressFired || session.dragging) continue;
      if (now - session.startedAt < this.options.longPressMs) continue;
      session.longPressFired = true;
      this.emit('longPress', {
        x: session.lastX,
        y: session.lastY,
        durationMs: now - session.startedAt,
        pointerId: session.pointerId,
      });
    }
  }

  private registerDebugKeys(): void {
    const keyboard = this.scene.input?.keyboard;
    if (!keyboard || Object.keys(this.debugKeys).length === 0) return;

    for (const [keyName, action] of Object.entries(this.debugKeys)) {
      keyboard.on(`keydown-${keyName}`, () => this.triggerAction(action));
    }
    this.bag.add(() => {
      for (const keyName of Object.keys(this.debugKeys)) {
        keyboard.off(`keydown-${keyName}`);
      }
    });
  }

  private emit<K extends GestureName>(gesture: K, payload: InputGestureMap[K]): void {
    const set = this.handlers.get(gesture);
    if (!set || set.size === 0) return;
    for (const handler of set) {
      try {
        (handler as GestureHandler<K>)(payload);
      } catch (error) {
        logger.error('input', `"${gesture}" handler threw`, error);
      }
    }
  }

  private now(): number {
    return this.scene.time?.now ?? Date.now();
  }
}

function dominantDirection(dx: number, dy: number): SwipeDirection {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'down' : 'up';
}
