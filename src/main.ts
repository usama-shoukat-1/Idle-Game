/**
 * Entry point.
 *
 * Creates the engine + systems and boots the scene flow. Deliberately thin: no game
 * logic lives here, it only wires the browser environment to `startRestoreIt`.
 */

import '@/styles/global.css';
import Phaser from 'phaser';
import { startRestoreIt } from '@/core/Game';
import { createLogger } from '@/core/utils/logger';

const log = createLogger('main');

function hideBootSplash(): void {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  splash.classList.add('is-hidden');
  window.setTimeout(() => splash.remove(), 400);
}

function bootstrap(): void {
  const runtime = startRestoreIt();

  // Optional dev convenience: start from a clean save when asked.
  if (runtime.context.config.storage.clearOnBoot) {
    log.warn('storage.clearOnBoot is enabled - wiping local save');
    runtime.context.state.replace(runtime.context.save.reset(), 'clear-on-boot');
  }

  runtime.game.events.once(Phaser.Core.Events.READY, () => {
    log.info('engine ready');
    hideBootSplash();
  });

  // If Phaser fails before READY, surface it instead of a silent black screen.
  runtime.game.events.once(Phaser.Core.Events.DESTROY, () => log.info('engine destroyed'));

  window.addEventListener('error', (event) => {
    log.error('unhandled error', event.message);
    runtime.context.events.emit('ui:toast', { message: 'An unexpected error occurred', tone: 'error' });
  });

  window.addEventListener('unhandledrejection', (event) => {
    log.error('unhandled promise rejection', event.reason);
  });

  // Development convenience: expose the runtime on the window for console work.
  if (runtime.context.debug.enabled) {
    (window as unknown as Record<string, unknown>).__RESTORE_IT_RUNTIME__ = runtime;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
