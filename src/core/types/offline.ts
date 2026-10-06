/**
 * Offline-progression contracts.
 *
 * Phase 0 defines the shape and the maths plumbing only - the numbers in
 * `config/balance` are placeholders and are explicitly not tuned.
 */

import type { TimerId } from './ids';
import type { OfflineElapsed } from './timers';

export interface OfflineBuildingIncome {
  buildingId: string;
  /** Income rate used for the estimate (coins per second). */
  incomePerSecond: number;
  /** Share of the elapsed window actually credited for this building. */
  creditedMs: number;
  grossCoins: number;
  creditedCoins: number;
}

export interface OfflineReport {
  elapsed: OfflineElapsed;
  /** Total coins owed at 100% efficiency. */
  grossCoins: number;
  /** Total coins actually credited at the current efficiency. */
  creditedCoins: number;
  /** 0..1 efficiency used for `creditedCoins`. */
  efficiency: number;
  perBuilding: OfflineBuildingIncome[];
  /** Timers that finished while the player was away. */
  completedTimerIds: TimerId[];
  /** Timers that were still running and were advanced. */
  advancedTimerIds: TimerId[];
  computedAt: number;
  /** True once the report has been presented/credited to the player. */
  claimed: boolean;
}
