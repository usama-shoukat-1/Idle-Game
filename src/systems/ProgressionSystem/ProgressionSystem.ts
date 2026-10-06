import { logger } from '@/core/Logger';
import type { ContentRegistry } from '@/core/content/ContentRegistry';
import type { EventBus } from '@/core/events/EventBus';
import type { DistrictDefinition, StageDefinition } from '@/core/types/content';
import type { StageId } from '@/core/types/primitives';
import type { GameState, StageProgressState } from '@/core/types/state';
import type { EconomySystem } from '@/systems/EconomySystem/EconomySystem';
import type { BuildingSystem } from '@/systems/BuildingSystem/BuildingSystem';
import {
  evaluateRequirements,
  type RequirementContext,
  type RequirementStatus,
} from './RequirementEvaluator';

/**
 * PROGRESSION SYSTEM
 * ==================
 * Owns the WORLD -> DISTRICT -> STAGE ladder:
 * - which stage is current, which are unlocked/completed;
 * - mastery per stage and district synergy aggregation;
 * - data-driven stage gating (requirements come from content, never from a switch).
 *
 * Redevelopment/prestige is represented in state (`redevelopment`) but intentionally has
 * no economy here: Phase 0 does not implement prestige.
 */

export interface DistrictProgress {
  readonly district: DistrictDefinition;
  readonly stages: ReadonlyArray<{ stage: StageDefinition; progress: StageProgressState }>;
  readonly unlockedStages: number;
  readonly totalStages: number;
  /** Average synergy across the district's stages, 0..100. */
  readonly synergy: number;
}

export class ProgressionSystem {
  constructor(
    private readonly state: GameState,
    private readonly content: ContentRegistry,
    private readonly economy: EconomySystem,
    private readonly buildings: BuildingSystem,
    private readonly events: EventBus,
  ) {}

  // --- Stage access --------------------------------------------------------

  getCurrentStageId(): StageId {
    return this.state.progression.currentStageId;
  }

  getCurrentStage(): StageDefinition | null {
    return this.content.tryGetStage(this.getCurrentStageId()) ?? null;
  }

  /** Switching the *viewed* stage never unlocks anything by itself. */
  setCurrentStage(stageId: StageId): boolean {
    const stage = this.content.tryGetStage(stageId);
    if (!stage) return false;
    if (!this.isStageUnlocked(stageId)) return false;
    this.state.progression.currentStageId = stageId;
    return true;
  }

  isStageUnlocked(stageId: StageId): boolean {
    return this.state.progression.stages[stageId]?.unlocked ?? false;
  }

  isStageCompleted(stageId: StageId): boolean {
    return this.state.progression.stages[stageId]?.completed ?? false;
  }

  getStageProgress(stageId: StageId): StageProgressState | null {
    return this.state.progression.stages[stageId] ?? null;
  }

  /** Stages the player may currently enter, in content order. */
  getAvailableStages(): readonly StageDefinition[] {
    return this.content.getAllStages().filter((stage) => this.isStageUnlocked(stage.id));
  }

  getUnlockStatus(stageId: StageId): RequirementStatus {
    const stage = this.content.tryGetStage(stageId);
    if (!stage) return { satisfied: false, blocking: null, description: 'Unknown stage' };
    return evaluateRequirements(stage.unlockRequirements, this.createRequirementContext());
  }

  /** Unlocks the stage if (and only if) its content requirements are met. */
  unlockStage(stageId: StageId, reason = 'requirements-met'): boolean {
    const stage = this.content.tryGetStage(stageId);
    if (!stage) return false;
    if (this.isStageUnlocked(stageId)) return false;

    const progress = this.ensureStageProgress(stageId);
    progress.unlocked = true;
    if (!this.state.progression.unlockedStageIds.includes(stageId)) {
      this.state.progression.unlockedStageIds.push(stageId);
    }
    this.events.emit('stage:unlocked', { stageId });
    logger.info('progression', `stage unlocked: ${stageId}`, { reason });
    return true;
  }

  /** Evaluates every stage + building unlock source once (call after progression changes). */
  refreshUnlocks(reason = 'progression.refresh'): { stages: StageId[]; buildings: string[] } {
    const stages: StageId[] = [];
    for (const stage of this.content.getAllStages()) {
      if (this.isStageUnlocked(stage.id)) continue;
      if (stage.unlockRequirements.length === 0) continue;
      if (!this.getUnlockStatus(stage.id).satisfied) continue;
      this.unlockStage(stage.id, reason);
      stages.push(stage.id);
    }

    const buildings = [...this.buildings.refreshUnlocks(reason)];
    return { stages, buildings };
  }

  // --- Mastery / synergy ---------------------------------------------------

  getMastery(stageId: StageId): number {
    return this.state.progression.stages[stageId]?.mastery ?? 0;
  }

  addMastery(stageId: StageId, amount: number, reason = 'mastery.gain'): number {
    const stage = this.content.tryGetStage(stageId);
    if (!stage) return 0;
    const progress = this.ensureStageProgress(stageId);
    const max = stage.synergy.masteryMax;
    const next = Math.min(max, Math.max(0, progress.mastery + Math.floor(amount)));
    const applied = next - progress.mastery;
    if (applied === 0) return 0;

    progress.mastery = next;
    this.events.emit('mastery:changed', { stageId, mastery: next });
    logger.debug('progression', `mastery +${applied} in ${stageId}`, { reason });

    if (next >= max && !progress.completed) {
      progress.completed = true;
    }
    this.refreshUnlocks(reason);
    return applied;
  }

  getSynergy(stageId: StageId): number {
    return this.state.progression.stages[stageId]?.synergy ?? 0;
  }

  /** District synergy is derived from its stages' progress; it is not stored twice. */
  getDistrictProgress(districtId: string): DistrictProgress | null {
    const district = this.content.getAllDistricts().find((entry) => entry.id === districtId);
    if (!district) return null;
    return this.buildDistrictProgress(district);
  }

  getAllDistrictProgress(): readonly DistrictProgress[] {
    return this.content.getAllDistricts().map((district) => this.buildDistrictProgress(district));
  }

  /** Marks a stage complete (called by content-driven objectives in later phases). */
  markStageCompleted(stageId: StageId): boolean {
    const progress = this.state.progression.stages[stageId];
    if (!progress || progress.completed) return false;
    progress.completed = true;
    this.refreshUnlocks('stage.completed');
    return true;
  }

  // --- Redevelopment (structure only) --------------------------------------

  getRedevelopment(): { level: number; points: number } {
    return { ...this.state.redevelopment };
  }

  private ensureStageProgress(stageId: StageId): StageProgressState {
    const existing = this.state.progression.stages[stageId];
    if (existing) return existing;
    const created: StageProgressState = { unlocked: false, completed: false, mastery: 0, synergy: 0 };
    this.state.progression.stages[stageId] = created;
    return created;
  }

  private buildDistrictProgress(district: DistrictDefinition): DistrictProgress {
    const stages = district.stageIds
      .map((id) => {
        const stage = this.content.tryGetStage(id);
        if (!stage) return null;
        return { stage, progress: this.state.progression.stages[id] ?? { unlocked: false, completed: false, mastery: 0, synergy: 0 } };
      })
      .filter((entry): entry is { stage: StageDefinition; progress: StageProgressState } => entry !== null);

    const synergy =
      stages.length === 0 ? 0 : stages.reduce((total, entry) => total + entry.progress.synergy, 0) / stages.length;

    return {
      district,
      stages,
      unlockedStages: stages.filter((entry) => entry.progress.unlocked).length,
      totalStages: stages.length,
      synergy,
    };
  }

  private createRequirementContext(): RequirementContext {
    return {
      state: this.state,
      content: this.content,
      isBuildingUnlocked: (id) => this.buildings.isUnlocked(id),
      isUpgradeCompleted: (id) => this.state.upgrades.completed.includes(id),
      getCurrency: (currency) => this.economy.getBalance(currency),
      getStageProgress: (id) => {
        const progress = this.state.progression.stages[id];
        return progress ? { mastery: progress.mastery, unlocked: progress.unlocked } : null;
      },
    };
  }
}
