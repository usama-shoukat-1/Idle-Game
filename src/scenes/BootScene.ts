/**
 * BootScene.
 *
 * Minimal engine-level setup: placeholder textures (Phase 0 ships no binaries),
 * a viewport sanity pass, then straight to Preload. No game logic here.
 */

import Phaser from 'phaser';
import { GAME_VERSION, SCENE_KEYS } from '@/core/constants';
import { generatePlaceholderTextures } from '@/assets/placeholders';
import { getGameContext, logSceneTransition } from './sceneContext';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.boot });
  }

  create(): void {
    const context = getGameContext(this);
    logSceneTransition(null, SCENE_KEYS.boot, context);

    // Placeholder art is generated, not loaded: no network round trip, no assets to
    // ship. Real art will be loaded in PreloadScene from the asset manifest.
    generatePlaceholderTextures(this);

    this.input.mouse?.disableContextMenu();

    context.events.emit('engine:ready', { at: context.clock.now(), version: GAME_VERSION });

    this.scene.start(SCENE_KEYS.preload);
  }
}
