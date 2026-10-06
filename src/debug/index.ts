/**
 * Debug entry point.
 *
 * `createDebugTools` returns the real tooling only when debug mode is enabled;
 * release builds get the inert implementation. Keeping the decision here means no
 * scene ever branches on `import.meta.env.DEV`.
 */

import type { GameContext } from '@/core/GameContext';
import { DEBUG_GLOBAL_KEY } from '@/core/constants';
import { createNullDebugTools } from './NullDebugTools';
import { DebugTools } from './DebugTools';
import type { DebugApi } from './DebugApi';

export type { DebugApi } from './DebugApi';
export { DEBUG_ACTIONS } from './DebugApi';
// NOTE: DebugOverlay is Phaser-bound and deliberately NOT re-exported here, so the
// debug barrel stays importable from headless contexts (tests, tooling). Scenes
// import it from '@/debug/DebugOverlay' directly.

export interface CreateDebugToolsOptions {
  getContext: () => GameContext | null;
  enabled: boolean;
  /** Expose `window.__RESTORE_IT__` for console-driven QA. */
  exposeGlobal?: boolean;
}

export function createDebugTools(options: CreateDebugToolsOptions): DebugApi {
  if (!options.enabled) return createNullDebugTools();

  const tools = new DebugTools({ getContext: options.getContext, enabled: true });

  if (options.exposeGlobal !== false && typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)[DEBUG_GLOBAL_KEY] = {
      tools,
      state: () => options.getContext()?.state.state,
      summary: () => tools.stateSummary(),
      addCoins: (amount?: number) => tools.addCoins(amount),
      addGems: (amount?: number) => tools.addGems(amount),
      unlockAll: () => tools.unlockAllBuildings(),
      finishTimers: () => tools.finishTimers(),
      resetSave: () => tools.resetSave(),
    };
  }

  return tools;
}

export { DebugTools };
