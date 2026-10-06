/**
 * Unified input abstraction.
 *
 * Gameplay subscribes to semantic events (`tap`, `drag`, `swipe`, `key`) instead
 * of raw Phaser pointer handlers, so the same content works with touch, mouse and
 * debug keyboard controls, and so mobile-specific tuning (tap slop, drag
 * threshold) lives in exactly one place.
 */

import Phaser from 'phaser';
import type { GameEventBus } from '@/systems/EventSystem';
import { TypedEventBus, type Subscription } from '@/systems/EventSystem';
import { createLogger } from '@/core/utils/logger';

export interface TapEvent {
  /** Screen/canvas coordinates. */
  x: number;
  y: number;
  /** World coordinates (camera-adjusted) for gameplay hit-testing. */
  worldX: number;
  worldY: number;
  pointerId: number;
  /** True when the tap hit an interactive game object. */
  onGameObject: boolean;
  durationMs: number;
  source: 'pointer' | 'mouse';
}

export interface DragEvent {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  dx: number;
  dy: number;
  pointerId: number;
}

export interface SwipeEvent {
  direction: 'up' | 'down' | 'left' | 'right';
  distance: number;
  durationMs: number;
  velocity: number;
}

export interface KeyEvent {
  /** Logical action name registered by the debug tooling, e.g. `debug-coins`. */
  action: string;
  keyCode: string;
}

export interface InputEventMap {
  tap: TapEvent;
  drag: DragEvent;
  dragend: Omit<DragEvent, 'dx' | 'dy'>;
  swipe: SwipeEvent;
  key: KeyEvent;
}

export interface InputManagerOptions {
  /** Max movement (px) still counted as a tap. */
  tapSlop?: number;
  /** Max press duration (ms) still counted as a tap. */
  tapDurationMs?: number;
  /** Min speed (px/s) to count as a swipe. */
  swipeVelocity?: number;
}

export class InputManager {
  private readonly log = createLogger('input');
  private readonly bus = new TypedEventBus<InputEventMap>();
  private enabled = true;
  private readonly options: Required<InputManagerOptions>;
  private readonly keyActions = new Map<string, string>();

  private pressStartedAt = 0;
  private pressX = 0;
  private pressY = 0;
  private pressSource: 'pointer' | 'mouse' = 'pointer';
  private dragging = false;
  private lastDragX = 0;
  private lastDragY = 0;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly gameEvents: GameEventBus,
    options: InputManagerOptions = {},
  ) {
    this.options = {
      tapSlop: options.tapSlop ?? 16,
      tapDurationMs: options.tapDurationMs ?? 350,
      swipeVelocity: options.swipeVelocity ?? 550,
    };
    this.attach();
  }

  /* ------------------------------------------------------------ lifecycle */

  private attach(): void {
    const input = this.scene.input;
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    input.on(Phaser.Input.Events.GAME_OUT, this.onGameOut, this);
    this.log.debug('input attached');
  }

  dispose(): void {
    const input = this.scene.input;
    input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    input.off(Phaser.Input.Events.GAME_OUT, this.onGameOut, this);
    this.detachKeyboard();
    this.bus.removeAll();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.resetPress();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /* ---------------------------------------------------------- subscription */

  onTap(handler: (event: TapEvent) => void): Subscription {
    return this.bus.on('tap', handler);
  }

  onDrag(handler: (event: DragEvent) => void): Subscription {
    return this.bus.on('drag', handler);
  }

  onDragEnd(handler: (event: Omit<DragEvent, 'dx' | 'dy'>) => void): Subscription {
    return this.bus.on('dragend', handler);
  }

  onSwipe(handler: (event: SwipeEvent) => void): Subscription {
    return this.bus.on('swipe', handler);
  }

  onKeyAction(handler: (event: KeyEvent) => void): Subscription {
    return this.bus.on('key', handler);
  }

  /* --------------------------------------------------------------- keyboard */

  /**
   * Map a physical key to a logical action. Only the debug tooling uses this;
   * desktop keyboards are a development convenience, not a design target.
   */
  registerKeyAction(keyCode: string, action: string): void {
    this.keyActions.set(keyCode, action);
    if (!this.keyHandler) this.attachKeyboard();
  }

  private attachKeyboard(): void {
    this.keyHandler = (event: KeyboardEvent) => {
      if (!this.enabled) return;
      const action = this.keyActions.get(event.code);
      if (!action) return;
      // Stop the browser from scrolling/activating UI while a game key is used.
      event.preventDefault();
      const payload: KeyEvent = { action, keyCode: event.code };
      this.bus.emit('key', payload);
      this.gameEvents.emit('input:debug-key', { key: action });
    };
    window.addEventListener('keydown', this.keyHandler, { passive: false });
  }

  private detachKeyboard(): void {
    if (!this.keyHandler) return;
    window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
  }

  /* ---------------------------------------------------------------- pointer */

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.enabled) return;
    this.pressStartedAt = this.now();
    this.pressX = pointer.x;
    this.pressY = pointer.y;
    this.lastDragX = pointer.x;
    this.lastDragY = pointer.y;
    this.pressSource = pointer.wasTouch ? 'pointer' : 'mouse';
    this.dragging = false;
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.enabled || !pointer.isDown) return;
    const dx = pointer.x - this.pressX;
    const dy = pointer.y - this.pressY;
    const distance = Math.hypot(dx, dy);
    if (!this.dragging && distance > this.options.tapSlop) this.dragging = true;
    if (!this.dragging) return;

    const stepX = pointer.x - this.lastDragX;
    const stepY = pointer.y - this.lastDragY;
    this.lastDragX = pointer.x;
    this.lastDragY = pointer.y;

    const world = this.toWorld(pointer);
    const event: DragEvent = {
      x: pointer.x,
      y: pointer.y,
      worldX: world.x,
      worldY: world.y,
      dx: stepX,
      dy: stepY,
      pointerId: pointer.id,
    };
    this.bus.emit('drag', event);
    this.gameEvents.emit('input:drag', {
      x: pointer.x,
      y: pointer.y,
      dx: stepX,
      dy: stepY,
      pointerId: pointer.id,
    });
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.enabled) return;
    const durationMs = this.now() - this.pressStartedAt;
    const dx = pointer.x - this.pressX;
    const dy = pointer.y - this.pressY;
    const distance = Math.hypot(dx, dy);
    const world = this.toWorld(pointer);

    if (this.dragging || distance > this.options.tapSlop) {
      const velocity = durationMs > 0 ? (distance / durationMs) * 1000 : 0;
      this.bus.emit('dragend', {
        x: pointer.x,
        y: pointer.y,
        worldX: world.x,
        worldY: world.y,
        pointerId: pointer.id,
      });
      this.gameEvents.emit('input:drag-end', { x: pointer.x, y: pointer.y, pointerId: pointer.id });

      if (velocity >= this.options.swipeVelocity) {
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const direction: SwipeEvent['direction'] = horizontal
          ? dx >= 0
            ? 'right'
            : 'left'
          : dy >= 0
            ? 'down'
            : 'up';
        const swipe: SwipeEvent = { direction, distance, durationMs, velocity };
        this.bus.emit('swipe', swipe);
        this.gameEvents.emit('input:swipe', { direction, velocity });
      }

      this.resetPress();
      return;
    }

    if (durationMs <= this.options.tapDurationMs) {
      const tap: TapEvent = {
        x: pointer.x,
        y: pointer.y,
        worldX: world.x,
        worldY: world.y,
        pointerId: pointer.id,
        onGameObject: this.hitsGameObject(pointer),
        durationMs,
        source: this.pressSource,
      };
      this.bus.emit('tap', tap);
      this.gameEvents.emit('input:tap', {
        x: tap.x,
        y: tap.y,
        worldX: tap.worldX,
        worldY: tap.worldY,
        pointerId: tap.pointerId,
      });
    }

    this.resetPress();
  }

  private onGameOut(): void {
    // Leaving the canvas should not leave a half-finished gesture behind.
    if (this.dragging) {
      this.resetPress();
    }
  }

  private resetPress(): void {
    this.dragging = false;
    this.pressStartedAt = 0;
  }

  /** Cheap hit test: did this press land on an interactive object? */
  private hitsGameObject(pointer: Phaser.Input.Pointer): boolean {
    try {
      return this.scene.input.hitTestPointer(pointer).length > 0;
    } catch {
      return false;
    }
  }

  private toWorld(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const camera = this.scene.cameras?.main;
    if (!camera) return { x: pointer.x, y: pointer.y };
    // Camera transform is cheap and lets gameplay ignore scroll/zoom.
    const point = camera.getWorldPoint(pointer.x, pointer.y);
    return { x: point.x, y: point.y };
  }

  private now(): number {
    return this.scene.game.loop.time || Date.now();
  }
}
