/**
 * Engine bootstrap.
 *
 * Creates the composition root (all systems), builds the Phaser configuration and
 * starts the scene flow: Boot -> Preload -> Loading -> Main Menu -> Game.
 *
 * Responsive strategy: `Scale.RESIZE` (the canvas is exactly the window) plus a
 * `Viewport` object recomputed on resize. Gameplay never assumes a resolution; UI
 * lays itself out as fractions of the viewport and respects safe-area insets.
 */

import Phaser from 'phaser';
import { GAME_TITLE } from '@/core/constants';
import type { GameContext } from '@/core/GameContext';
import { createGameContext, type GameContextOptions } from '@/core/GameContext';
import { BootScene } from '@/scenes/BootScene';
import { PreloadScene } from '@/scenes/PreloadScene';
import { LoadingScene } from '@/scenes/LoadingScene';
import { MainMenuScene } from '@/scenes/MainMenuScene';
import { GameScene } from '@/scenes/GameScene';
import { createLogger } from '@/core/utils/logger';
import type { SaveReason } from '@/core/types/save';

export interface RestoreItGame {
  game: Phaser.Game;
  context: GameContext;
  /** Save now (used by visibility/pagehide handlers). */
  persist(reason: SaveReason): void;
  destroy(): void;
}

export function createPhaserConfig(context: GameContext): Phaser.Types.Core.GameConfig {
  const isMobile = context.config.platform.isMobile;

  return {
    type: Phaser.AUTO,
    parent: 'game-root',
    backgroundColor: '#0b0e14',
    title: GAME_TITLE,
    // Mobile-first: touch + one active pointer is the common case. Phaser defaults
    // to 2 fine, but we keep it explicit so desktop dev input stays predictable.
    input: {
      activePointers: 2,
      touch: { capture: true },
      mouse: { preventDefaultWheel: true },
      keyboard: true,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: '100%',
      height: '100%',
    },
    render: {
      // `AUTO` picks WebGL where available and falls back to Canvas 2D.
      antialias: true,
      // Rounded/soft shapes look better without pixel snapping; explicit for clarity.
      roundPixels: false,
      powerPreference: 'low-power',
      batchSize: isMobile ? 2048 : 4096,
    },
    fps: {
      target: isMobile ? 60 : 120,
      // Mobile battery: keep the sim cheap but do not starve input.
      min: 20,
      forceSetTimeOut: false,
    },
    disableContextMenu: true,
    audio: {
      // Audio only starts after a gesture (browser policy); the manager handles it.
      disableWebAudio: false,
      noAudio: false,
    },
    // No physics engine in Phase 0: the game is UI/2D driven, and skipping the
    // engine keeps the mobile bundle and per-frame cost small.
    scene: [BootScene, PreloadScene, LoadingScene, MainMenuScene, GameScene],
    callbacks: {
      postBoot: (game) => {
        context.debug.attachGame?.(game);
      },
    },
  };
}

export function startRestoreIt(options: GameContextOptions = {}): RestoreItGame {
  const log = createLogger('game');
  const context = createGameContext(options);
  const game = new Phaser.Game(createPhaserConfig(context));

  // Expose the context to scenes through Phaser's registry: nothing else needs a
  // global, and scenes get it in a lifecycle-safe way.
  game.registry.set('context', context);

  const persist = (reason: SaveReason): void => {
    // Anchor the offline timestamp before writing, so a reload computes a correct
    // elapsed window.
    context.offline.anchor(context.clock.now());
    context.save.save(context.state.snapshot(), reason);
    context.state.markClean();
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') persist('visibility-hidden');
  };
  const onPageHide = (): void => persist('shutdown');

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);

  log.info(`RESTORE IT! booted (${context.config.platform.isMobile ? 'mobile' : 'desktop'} profile)`);

  return {
    game,
    context,
    persist,
    destroy: () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      persist('shutdown');
      context.dispose();
      game.destroy(true);
    },
  };
}
