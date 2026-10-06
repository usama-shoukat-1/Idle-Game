/**
 * Worker entity (foundation only).
 *
 * The game design calls for staff that automate buildings, but Phase 0 deliberately
 * ships no worker content. What exists here is the reusable state/invariant layer:
 * hiring, assignment, leveling and the production bonus shape a future worker system
 * will read. Nothing spawns workers yet.
 */

import type { BuildingId, WorkerId } from '@/core/types/ids';
import type { WorkerState } from '@/core/types/gameState';
import { clamp } from '@/core/utils/numbers';

/** Content shape a future `src/data/workers` pack will provide. */
export interface WorkerDefinition {
  id: string;
  displayName: string;
  /** Coins per hour (data-driven; no values ship in Phase 0). */
  baseCostCoins: number;
  upgradeCostGrowth: number;
  /** Income multiplier this worker grants its assigned building per level. */
  incomeMultiplierPerLevel: number;
  maxLevel: number;
  /** Which building types may employ it; empty = any. */
  allowedBuildingTypes?: string[];
}

export class WorkerEntity {
  constructor(
    readonly state: WorkerState,
    readonly definition: WorkerDefinition | null,
  ) {}

  get id(): WorkerId {
    return this.state.id;
  }

  get isAssigned(): boolean {
    return this.state.assignedBuildingId !== null;
  }

  get isActive(): boolean {
    // A worker only produces while assigned to a building it is allowed to work in.
    return this.isAssigned;
  }

  get maxLevel(): number {
    return this.definition?.maxLevel ?? 1;
  }

  get canLevelUp(): boolean {
    return this.state.level < this.maxLevel;
  }

  /** Data-driven income contribution; 1 (neutral) when the worker is idle. */
  get incomeMultiplier(): number {
    if (!this.isActive || !this.definition) return 1;
    return 1 + this.definition.incomeMultiplierPerLevel * this.state.level;
  }

  canWorkIn(buildingType: string): boolean {
    const allowed = this.definition?.allowedBuildingTypes;
    if (!allowed || allowed.length === 0) return true;
    return allowed.includes(buildingType);
  }

  /** Mutates this worker's state record (callers own persistence via the store). */
  assignTo(buildingId: BuildingId | null): void {
    this.state.assignedBuildingId = buildingId;
  }

  levelUp(): boolean {
    if (!this.canLevelUp) return false;
    this.state.level = clamp(this.state.level + 1, 1, this.maxLevel);
    return true;
  }
}
