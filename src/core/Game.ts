import Phaser from 'phaser';

import { logger, LogLevel } from '@/core/Logger';
import { installGameContext, type GameContext } from '@/core/GameContext';
import { ServiceContainer } from '@/core/ServiceContainer';
import { createGameConfig } from '@/core/GameConfig';
import { REGISTRY_KEYS } from '@/core/constants/GameConstants';
import { FEATURE_FLAGS } from '@/config/content';
import { DebugTools } from '@/debug/DebugTools';
import { LayoutService } from '@/ui/layout/LayoutService';
import { BootScene } from '@/scenes/BootScene';
import { PreloadScene } from '@/scenes/PreloadScene';
import { LoadingScene } from '@/scenes/LoadingScene';
import { MainMenuScene } from '@/scenes/MainMenuScene';
import { GameScene } from '@/scenes/GameScene';

/**
 * GAME BOOTSTRAP
 * ==============
 * Assembles the game and hands control to Phaser. Boot order, and why:
 *
 *  1. Systems + save are created and loaded **before** Phaser starts. The canvas therefore
 *     never shows a state-less frame, and any storage problem is handled (and logged) while
 *     there is still nothing on screen to interrupt.
 *  2. The Phaser game is created with the scene list; BootScene runs first.
 *  3. The `GameContext` (systems + layout + debug + load result) is installed into the game
 *     registry, so scenes obtain it without importing singletons.
 *
 * The same function is what a future native/electron shell or an automated smoke test calls;
 * `main.ts` only performs the DOM-ready dance.
 */

export interface BootstrapResult {
  readonly game: Phaser.Game;
  readonly context: GameContext;
  destroy(): void;
}

export function bootstrap(parent?: HTMLElement): BootstrapResult {
  const resolvedParent = parent ?? document.getElementById('game-root') ?? document.body;

  logger.setLevel(FEATURE_FLAGS.debugTools ? LogLevel.Debug : LogLevel.Info);

  const systems = new ServiceContainer({ gameVersion: BUILD_VERSION });
  const loadResult = systems.load();

  const scenes: Phaser.Types.Scenes.SceneType[] = [
    BootScene,
    PreloadScene,
    LoadingScene,
    MainMenuScene,
    GameScene,
  ];

  const game = new Phaser.Game(
    createGameConfig({
      parent: resolvedParent,
      scenes,
    }),
  );

  // Layout reads the DOM size directly; Phaser's scale manager is kept in sync from here.
  const layout = new LayoutService(game.scale, () => ({
    width: resolvedParent.clientWidth || window.innerWidth,
    height: resolvedParent.clientHeight || window.innerHeight,
  }));

  const debug = FEATURE_FLAGS.debugTools ? new DebugTools({ systems }) : null;

  const context: GameContext = { systems, layout, loadResult, debug };
  installGameContext(game, context);
  game.registry.set(REGISTRY_KEYS.gameReady, false);

  // Re-measure once Phaser has sized the canvas for the first time.
  game.events.once(Phaser.Core.Events.READY, () => {
    layout.refresh();
    logger.info('core', 'phaser ready', { renderer: game.renderer.type });
  });

  // Last-chance save when the page is going away for good.
  const onBeforeUnload = (): void => {
    systems.requestSave('beforeunload');
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  return {
    game,
    context,
    destroy(): void {
      window.removeEventListener('beforeunload', onBeforeUnload);
      systems.dispose();
      layout.dispose();
      game.destroy(true);
    },
  };
}

/** Boots the game once the DOM is ready, and surfaces fatal boot errors on the splash. */
export function autoStart(): void {
  const start = (): void => {
    try {
      const result = bootstrap();
      // Exposed for manual QA in DevTools, e.g.
      //   window.__RESTORE_IT__.context.debug?.stateSummary()
      (window as unknown as { __RESTORE_IT__?: BootstrapResult }).__RESTORE_IT__ = result;
    } catch (error) {
      logger.error('core', 'fatal boot error', error);
      const splash = document.getElementById('boot-splash');
      if (splash) {
        splash.innerHTML =
          '<div class="boot-splash__mark">RESTORE IT!</div>' +
          '<div class="boot-splash__hint">Failed to start. Check the console for details.</div>';
      }
    }
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
}

/** Build version stamped into saves so a bug report can be tied to a build. */
export const BUILD_VERSION = '0.1.0-phase0';
