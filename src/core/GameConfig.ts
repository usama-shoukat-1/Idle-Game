import Phaser from 'phaser';

import { TARGET_FPS } from './constants/GameConstants';
import { PALETTE } from './constants/Layout';

/**
 * Phaser bootstrap configuration + device profile.
 *
 * Key decisions (see docs/MOBILE_DESIGN.md):
 * - `Scale.RESIZE`: the canvas always fills its parent 1:1. The game is resolution
 *   independent because all layout maths happens in design units via LayoutService,
 *   never in raw device pixels.
 * - No physics engine is enabled. An idle/tycoon game does not need arcade or matter
 *   physics; skipping them removes a large per-frame cost and an entire class of bugs.
 * - WebGL with Canvas fallback, `powerPreference: high-performance` for mobile GPUs.
 */

export interface DeviceProfile {
  readonly isTouchDevice: boolean;
  readonly isMobileLike: boolean;
  readonly isDesktop: boolean;
  /** Device pixel ratio, capped for performance decisions (not used for layout). */
  readonly pixelRatio: number;
  readonly deviceType: 'mobile' | 'tablet' | 'desktop';
}

/** Detects the broad device class once at boot. Layout never branches on this. */
export function detectDeviceProfile(): DeviceProfile {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return {
      isTouchDevice: false,
      isMobileLike: false,
      isDesktop: true,
      pixelRatio: 1,
      deviceType: 'desktop',
    };
  }

  const ua = navigator.userAgent;
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isTablet = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua);
  const isPhone = /iPhone|iPod|Android.*Mobile|Windows Phone|webOS|BlackBerry/i.test(ua);
  const isMobileLike = isPhone || isTablet || (isTouchDevice && Math.min(window.innerWidth, window.innerHeight) < 820);

  return {
    isTouchDevice,
    isMobileLike,
    isDesktop: !isMobileLike,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 3),
    deviceType: isPhone ? 'mobile' : isTablet ? 'tablet' : isMobileLike ? 'mobile' : 'desktop',
  };
}

/**
 * RENDER SCALE (device pixel ratio policy)
 * ========================================
 * `1` means the canvas backing store matches its CSS size. That is the mobile-friendly
 * default: on a 3x phone it costs ~1/9th of the fill rate of a DPR-3 canvas.
 *
 * Text stays crisp because the UI root raises each `Text` object's render resolution to the
 * device scale (`applyTextResolution`), which is where sharpness actually matters. If a
 * future device test shows the whole scene looking soft, the switch is a single line:
 * pass `Phaser.Scale.MAX_ZOOM` as `zoom` in the scale config below and verify input
 * hit areas on a real device.
 */
export const RENDER_SCALE_POLICY_NOTE = 'canvas backing store = CSS pixels; text resolution adapts';

export interface GameConfigOptions {
  /** Parent element that owns the canvas. */
  readonly parent: HTMLElement;
  /** Scene classes in registration order. */
  readonly scenes: Phaser.Types.Scenes.SceneType[];
  /** Optional override for automated/manual testing. */
  readonly renderer?: number;
}

export function createGameConfig(options: GameConfigOptions): Phaser.Types.Core.GameConfig {
  return {
    type: options.renderer ?? Phaser.AUTO,
    parent: options.parent,
    backgroundColor: PALETTE.background,
    // No physics: nothing in an idle/tycoon game needs a simulation step.
    banner: false,
    audio: {
      // Audio is unlocked on the first user gesture by AudioSystem, not by us.
      disableWebAudio: false,
      noAudio: false,
    },
    fps: {
      target: TARGET_FPS,
      // Idle games are event driven; never burn battery when nothing is happening.
      forceSetTimeOut: false,
    },
    render: {
      antialias: true,
      antialiasGL: true,
      pixelArt: false,
      roundPixels: false,
      powerPreference: 'high-performance',
      // Keep the canvas transparent-free: an opaque canvas composites faster on mobile.
      transparent: false,
      desynchronized: false,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: options.parent.clientWidth || window.innerWidth,
      height: options.parent.clientHeight || window.innerHeight,
      // Layout is handled by LayoutService in design units, and the canvas always matches
      // the viewport 1:1, so Phaser's own zoom stays neutral (see RENDER_SCALE_POLICY_NOTE).
    },
    scene: options.scenes,
  };
}
