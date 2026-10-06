/**
 * Building entity.
 *
 * A read-only facade that pairs a `BuildingDefinition` (content) with its live
 * `BuildingState` (save) and answers the questions UI/gameplay actually ask:
 * "is it open?", "what does it earn?", "what can I upgrade next?".
 *
 * It owns no state and imports no rendering library, so the same object can be used
 * by a UI panel, a debug readout or a future AI/economy tool without duplication.
 * Types are imported from the systems layer (type-only), so there is no runtime cycle.
 */

import type { BuildingDefinition } from '@/core/types/content';
import type { UpgradeAvailability } from '@/systems/UpgradeSystem/UpgradeSystem';
import type { IncomeBreakdown } from '@/systems/BuildingSystem/BuildingSystem';

/** Systems the entity queries; injected so the entity stays testable in isolation. */
export interface BuildingEntityServices {
  getState: () => { tier: number; unlocked: boolean; incomeMultiplier: number } | null;
  getIncomeBreakdown: () => IncomeBreakdown | null;
  getVisualState: () => string;
  listUpgrades: () => UpgradeAvailability[];
}

export class BuildingEntity {
  constructor(
    readonly definition: BuildingDefinition,
    private readonly services: BuildingEntityServices,
  ) {}

  get id(): string {
    return this.definition.id;
  }

  get displayName(): string {
    return this.definition.displayName;
  }

  get districtId(): string {
    return this.definition.districtId;
  }

  get stageId(): string {
    return this.definition.stageId;
  }

  get isUnlocked(): boolean {
    return this.services.getState()?.unlocked ?? false;
  }

  get tier(): number {
    return this.services.getState()?.tier ?? 0;
  }

  get maxTier(): number {
    return this.definition.maxTier;
  }

  get isFullyRestored(): boolean {
    return this.maxTier > 0 && this.tier >= this.maxTier;
  }

  /** 0..1 restoration progress for progress bars. */
  get restorationProgress(): number {
    if (this.maxTier <= 0) return 0;
    return Math.min(1, this.tier / this.maxTier);
  }

  get visualStateId(): string {
    return this.services.getVisualState();
  }

  get incomePerSecond(): number {
    return this.services.getIncomeBreakdown()?.incomePerSecond ?? 0;
  }

  get incomeBreakdown(): IncomeBreakdown | null {
    return this.services.getIncomeBreakdown();
  }

  /** Upgrades currently offered for this building, with live availability. */
  get upgrades(): UpgradeAvailability[] {
    return this.services.listUpgrades();
  }

  /** The next upgrade the player could start right now, if any. */
  get nextUpgrade(): UpgradeAvailability | null {
    return this.upgrades.find((entry) => entry.ok) ?? null;
  }

  get activeUpgrade(): UpgradeAvailability | null {
    return this.upgrades.find((entry) => entry.code === 'already-active') ?? null;
  }

  get isUpgrading(): boolean {
    return this.activeUpgrade !== null;
  }

  /** Compact label used by panels/debug readouts. */
  describe(): string {
    const status = this.isUnlocked ? (this.isFullyRestored ? 'restored' : 'open') : 'locked';
    return `${this.displayName} • tier ${this.tier}/${this.maxTier} • ${status} • ${this.incomePerSecond}/s`;
  }
}
