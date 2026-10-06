import Phaser from 'phaser';

import { logger } from '@/core/Logger';
import { SCENE_KEYS } from '@/core/constants/GameConstants';
import { getGameContext } from '@/core/GameContext';

/**
 * BOOT SCENE
 * ==========
 * The smallest possible scene: it does no loading and no UI. Its only jobs are:
 *  1. make the first frame visible (hide the HTML splash so there is no flash of blank),
 *  2. refresh the layout metrics against the real canvas size,
 *  3. unlock audio on the first user gesture (mobile browser policy),
 *  4. hand over to PreloadScene.
 *
 * Everything else - saves, systems, content - was already initialised in main.ts before
 * Phaser started, so a scene transition here can never be blocked by I/O.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE_KEYS.boot);
  }

  create(): void {
    const context = getGameContext(this);
    context.layout.refresh();

    // The splash is a DOM element; removing it after the canvas exists gives an instant
    // "something happened" feeling on slow mobile first paints.
    const splash = document.getElementById('boot-splash');
    if (splash) {
      splash.classList.add('is-hidden');
      window.setTimeout(() => splash.remove(), 320);
    }

    this.installAudioUnlock();

    logger.info('scene', 'boot complete', {
      viewport: `${context.layout.metrics.viewport.width}x${context.layout.metrics.viewport.height}`,
      units: `${Math.round(context.layout.metrics.frameUnits.width)}x${Math.round(context.layout.metrics.frameUnits.height)}`,
      letterboxed: context.layout.metrics.letterboxed,
    });

    this.scene.start(SCENE_KEYS.preload);
  }

  /** One-shot listeners: the first real gesture unlocks the audio context. */
  private installAudioUnlock(): void {
    const context = getGameContext(this);
    const unlock = (): void => {
      context.systems.audio.unlock();
      this.input.off('pointerdown', unlock);
      this.input.keyboard?.off('keydown', unlock);
    };
    this.input.once('pointerdown', unlock);
    this.input.keyboard?.once('keydown', unlock);
  }
}
