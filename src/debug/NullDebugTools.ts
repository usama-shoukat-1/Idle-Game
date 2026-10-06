/** Production no-op debug tools. Every method is inert. */

import type { DebugApi } from './DebugApi';

export class NullDebugTools implements DebugApi {
  readonly enabled = false;

  stateSummary(): string {
    return '';
  }

  fps(): number | null {
    return null;
  }

  addCoins(): void {}
  addGems(): void {}
  unlockAllBuildings(): void {}
  unlockStage(): void {}
  finishTimers(): void {}
  addTaps(): void {}
  resetSave(): void {}
  toggleOverlay(): void {}
}

export const createNullDebugTools = (): DebugApi => new NullDebugTools();
