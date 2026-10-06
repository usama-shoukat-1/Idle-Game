/**
 * Debug tool contract.
 *
 * The production build gets `NullDebugTools`, so gameplay code can call these
 * unconditionally without leaking cheats into release behaviour.
 */

import type Phaser from 'phaser';
import type { StageId } from '@/core/types/ids';
import type { InputManager } from '@/systems/InputSystem';

export interface DebugApi {
  readonly enabled: boolean;
  /** Optional engine hooks (absent in the null implementation). */
  attachGame?(game: Phaser.Game): void;
  registerShortcuts?(input: InputManager): void;
  dispose?(): void;
  readonly isOverlayVisible?: boolean;
  /** Human-readable snapshot of the current game state (overlay + console). */
  stateSummary(): string;
  /** Current frames per second, or null before the renderer exists. */
  fps(): number | null;

  addCoins(amount?: number): void;
  addGems(amount?: number): void;
  unlockAllBuildings(): void;
  unlockStage(stageId?: StageId): void;
  finishTimers(): void;
  addTaps(count?: number): void;
  resetSave(): void;
  toggleOverlay(): void;
}

export const DEBUG_ACTIONS = {
  addCoins: 'debug:add-coins',
  addGems: 'debug:add-gems',
  unlockAll: 'debug:unlock-all',
  unlockStage: 'debug:unlock-stage',
  finishTimers: 'debug:finish-timers',
  resetSave: 'debug:reset-save',
  toggleOverlay: 'debug:toggle-overlay',
  summary: 'debug:state-summary',
} as const;
