/**
 * Scene helpers.
 *
 * Scenes receive the shared `GameContext` through Phaser's registry (set by
 * `startRestoreIt`) and build their own `Viewport`. No scene constructs systems or
 * keeps game state of its own.
 */

import Phaser from 'phaser';
import type { GameContext } from '@/core/GameContext';
import { Viewport } from '@/ui/layout/Viewport';
import { createLogger } from '@/core/utils/logger';

export const CONTEXT_REGISTRY_KEY = 'context';
export const OFFLINE_REPORT_REGISTRY_KEY = 'pendingOfflineReport';

export function getGameContext(scene: Phaser.Scene): GameContext {
  const context = scene.game.registry.get(CONTEXT_REGISTRY_KEY) as GameContext | undefined;
  if (!context) {
    throw new Error('GameContext is missing from the Phaser registry - scenes must boot through startRestoreIt()');
  }
  return context;
}

/**
 * Create a viewport and keep it in sync with Phaser's resize event.
 * Returns a disposer to call from `shutdown`.
 */
export function attachViewport(scene: Phaser.Scene): { viewport: Viewport; dispose: () => void } {
  const viewport = new Viewport(scene);
  const onResize = (): void => viewport.refresh();
  scene.scale.on(Phaser.Scale.Events.RESIZE, onResize);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.scale.off(Phaser.Scale.Events.RESIZE, onResize);
  });
  return { viewport, dispose: () => scene.scale.off(Phaser.Scale.Events.RESIZE, onResize) };
}

/** Log a scene transition once (useful while verifying the scene flow). */
export function logSceneTransition(from: string | null, to: string, context: GameContext): void {
  createLogger('scene').debug(`${from ?? 'start'} -> ${to}`);
  context.events.emit('scene:changed', { from, to });
}
