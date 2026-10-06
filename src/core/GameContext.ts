import type Phaser from 'phaser';

import type { DebugTools } from '@/debug/DebugTools';
import type { LayoutService } from '@/ui/layout/LayoutService';
import type { ServiceContainer } from '@/core/ServiceContainer';
import type { LoadResult } from '@/systems/SaveSystem/SaveSystem';

/**
 * Everything a scene needs, installed once at boot.
 *
 * Scenes must NOT construct systems or read storage. They ask for the context and use
 * system APIs (see docs/DEVELOPMENT_RULES.md). This also makes scenes testable: a stub
 * context can be installed without a browser.
 */
export interface GameContext {
  readonly systems: ServiceContainer;
  readonly layout: LayoutService;
  readonly loadResult: LoadResult;
  /** Present only when debug tools are enabled for this build. */
  readonly debug: DebugTools | null;
}

const REGISTRY_KEY = 'restore-it.context';

export function installGameContext(game: Phaser.Game, context: GameContext): void {
  game.registry.set(REGISTRY_KEY, context);
}

export function getGameContext(scene: Phaser.Scene): GameContext {
  const context = scene.registry.get(REGISTRY_KEY) as GameContext | undefined;
  if (!context) {
    throw new Error('GameContext missing: installGameContext() must run before scenes start');
  }
  return context;
}
