/**
 * Progression system.
 *
 * Decides what is unlocked: stages, districts, buildings and upgrade prerequisites.
 * Requirements are expressed in content data (`UnlockRequirementDefinition`,
 * `UpgradePrerequisiteDefinition`) and interpreted here, so new gating rules never
 * require edits inside scenes or the economy engine.
 */

import type { Clock } from '@/core/Clock';
import type { UpgradeDefinition, UnlockRequirementDefinition } from '@/core/types/content';
import type { BuildingId, DistrictId, MasteryTrackId, StageId } from '@/core/types/ids';
import type { GameStateStore } from '@/core/state/GameStateStore';
import { createLogger } from '@/core/utils/logger';
import { roundCurrency } from '@/core/utils/numbers';
import type { GameEventBus } from '@/systems/EventSystem';
import type { BuildingSystem } from '@/systems/BuildingSystem/BuildingSystem';
import type { ContentRegistry } from '@/systems/ContentSystem/ContentRegistry';
import type { EconomySystem } from '@/systems/EconomySystem/EconomySystem';

export interface RequirementCheck {
  ok: boolean;
  /** Machine-readable reasons, useful for UI tooltips and tests. */
  reasons: string[];
}

export interface ProgressionSystemDeps {
  store: GameStateStore;
  events: GameEventBus;
  clock: Clock;
  content: ContentRegistry;
  buildings: BuildingSystem;
  economy: EconomySystem;
}

export class ProgressionSystem {
  private readonly log = createLogger('progression');

  constructor(private readonly deps: ProgressionSystemDeps) {}

  /* -------------------------------------------------------------- stages */

  getCurrentStageId(): StageId {
    return this.deps.store.state.progression.currentStageId;
  }

  isStageUnlocked(stageId: StageId): boolean {
    return this.deps.store.state.progression.unlockedStageIds.includes(stageId);
  }

  /** Unlock every stage whose requirements are currently satisfied. */
  refreshUnlocks(at = this.deps.clock.now()): StageId[] {
    const unlocked: StageId[] = [];
    for (const stage of this.deps.content.listStages()) {
      if (this.isStageUnlocked(stage.id)) continue;
      const check = this.checkRequirements(stage.unlockRequirements);
      if (!check.ok) continue;

      this.deps.store.update((state) => {
        state.progression.unlockedStageIds.push(stage.id);
        const current = this.deps.content.getStage(state.progression.currentStageId);
        if (!current || stage.order >= current.order) state.progression.currentStageId = stage.id;
        for (const districtId of stage.districtIds) {
          if (!state.progression.unlockedDistrictIds.includes(districtId)) {
            state.progression.unlockedDistrictIds.push(districtId);
          }
          const district = state.districts[districtId];
          if (district) district.unlocked = true;
        }
      }, at);

      this.log.info(`stage unlocked: ${stage.id}`);
      this.deps.events.emit('progression:stage-unlocked', { stageId: stage.id, at });
      unlocked.push(stage.id);
    }
    return unlocked;
  }

  /**
   * Debug/QA only: unlock a stage regardless of requirements. Kept in the system
   * (not in the debug tools) so the state mutation stays behind one owner.
   */
  forceUnlockStage(stageId: StageId, at = this.deps.clock.now()): boolean {
    const stage = this.deps.content.getStage(stageId);
    if (!stage || this.isStageUnlocked(stageId)) return false;

    this.deps.store.update((state) => {
      state.progression.unlockedStageIds.push(stageId);
      state.progression.currentStageId = stageId;
      for (const districtId of stage.districtIds) {
        if (!state.progression.unlockedDistrictIds.includes(districtId)) {
          state.progression.unlockedDistrictIds.push(districtId);
        }
        const district = state.districts[districtId];
        if (district) district.unlocked = true;
      }
    }, at);

    this.deps.events.emit('progression:stage-unlocked', { stageId, at });
    return true;
  }

  isDistrictUnlocked(districtId: DistrictId): boolean {
    return this.deps.store.state.districts[districtId]?.unlocked ?? false;
  }

  unlockDistrict(districtId: DistrictId, at = this.deps.clock.now()): boolean {
    const district = this.deps.store.state.districts[districtId];
    if (!district || district.unlocked) return false;
    this.deps.store.update((state) => {
      state.districts[districtId].unlocked = true;
      if (!state.progression.unlockedDistrictIds.includes(districtId)) {
        state.progression.unlockedDistrictIds.push(districtId);
      }
    }, at);
    return true;
  }

  getDistrictProgress(districtId: DistrictId): number {
    return this.deps.store.state.districts[districtId]?.progress ?? 0;
  }

  /** Stage completion 0..1 = restored buildings / total buildings. */
  getStageProgress(stageId: StageId): number {
    const buildings = this.deps.content.getBuildingsForStage(stageId);
    if (buildings.length === 0) return 0;
    const restored = buildings.filter((building) => this.deps.buildings.isRestored(building.id)).length;
    return roundCurrency(restored / buildings.length);
  }

  /* ------------------------------------------------------------ buildings */

  /**
   * Can this building be unlocked right now? Requirements plus affordability.
   * The unlock cost is *not* charged here - `BuildingSystem.unlock` is called by
   * whoever owns the interaction, after an economy spend.
   */
  checkBuildingUnlock(buildingId: BuildingId): RequirementCheck {
    const definition = this.deps.content.getBuilding(buildingId);
    if (!definition) return { ok: false, reasons: ['unknown-building'] };
    const state = this.deps.store.state.buildings[buildingId];
    if (state?.unlocked) return { ok: false, reasons: ['already-unlocked'] };

    const check = this.checkRequirements(definition.unlockRequirements);
    const reasons = [...check.reasons];
    const cost = definition.unlockRequirements?.cost;
    if (cost && !this.deps.economy.canAfford(cost)) reasons.push('not-affordable');
    return { ok: reasons.length === 0, reasons };
  }

  /* ------------------------------------------------------------- upgrades */

  /** Evaluate an upgrade definition's prerequisites (cost is checked separately). */
  checkUpgradePrerequisites(definition: UpgradeDefinition): RequirementCheck {
    const reasons: string[] = [];
    const state = this.deps.store.state;

    for (const prerequisite of definition.prerequisites ?? []) {
      if (prerequisite.upgradeId && !state.upgrades.completed.includes(prerequisite.upgradeId)) {
        reasons.push(`requires-upgrade:${prerequisite.upgradeId}`);
      }
      if (prerequisite.buildingId) {
        const building = state.buildings[prerequisite.buildingId];
        if (!building?.unlocked) reasons.push(`requires-building:${prerequisite.buildingId}`);
        if (prerequisite.minTier !== undefined && (building?.tier ?? 0) < prerequisite.minTier) {
          reasons.push(`requires-tier:${prerequisite.buildingId}:${prerequisite.minTier}`);
        }
      }
      if (prerequisite.stageId && !state.progression.unlockedStageIds.includes(prerequisite.stageId)) {
        reasons.push(`requires-stage:${prerequisite.stageId}`);
      }
      if (prerequisite.masteryLevel !== undefined) {
        const level = this.getHighestMasteryLevel();
        if (level < prerequisite.masteryLevel) reasons.push(`requires-mastery:${prerequisite.masteryLevel}`);
      }
    }

    return { ok: reasons.length === 0, reasons };
  }

  /**
   * Generic requirement interpreter. `cost` is *not* checked here because
   * affordability is the economy service's business.
   */
  checkRequirements(requirements: UnlockRequirementDefinition | undefined): RequirementCheck {
    if (!requirements) return { ok: true, reasons: [] };
    const reasons: string[] = [];
    const state = this.deps.store.state;

    if (requirements.stageId && !state.progression.unlockedStageIds.includes(requirements.stageId)) {
      reasons.push(`requires-stage:${requirements.stageId}`);
    }
    if (requirements.buildingId) {
      const building = state.buildings[requirements.buildingId];
      if (!building?.unlocked) reasons.push(`requires-building:${requirements.buildingId}`);
      if (requirements.minTier !== undefined && (building?.tier ?? 0) < requirements.minTier) {
        reasons.push(`requires-tier:${requirements.buildingId}:${requirements.minTier}`);
      }
    }
    if (requirements.districtProgress !== undefined) {
      const districts = Object.values(state.districts);
      const best = districts.reduce((max, district) => Math.max(max, district.progress), 0);
      if (best < requirements.districtProgress) reasons.push(`requires-district-progress:${requirements.districtProgress}`);
    }
    if (requirements.masteryLevel !== undefined && this.getHighestMasteryLevel() < requirements.masteryLevel) {
      reasons.push(`requires-mastery:${requirements.masteryLevel}`);
    }
    if (requirements.cost && !this.deps.economy.canAfford(requirements.cost)) {
      reasons.push('not-affordable');
    }

    return { ok: reasons.length === 0, reasons };
  }

  /* -------------------------------------------------------------- mastery */

  getMastery(trackId: MasteryTrackId) {
    return this.deps.store.state.mastery[trackId] ?? null;
  }

  getHighestMasteryLevel(): number {
    return Object.values(this.deps.store.state.mastery).reduce((max, entry) => Math.max(max, entry.level), 0);
  }

  addMasteryXp(trackId: MasteryTrackId, xp: number, at = this.deps.clock.now()): void {
    const track = this.deps.content.getMasteryTrack(trackId);
    const entry = this.deps.store.state.mastery[trackId];
    if (!track || !entry || xp <= 0) return;

    let level = entry.level;
    let remaining = entry.xp + xp;
    const curve = track.levelCurve.length > 0 ? track.levelCurve : [100];

    while (level < curve.length && remaining >= curve[Math.min(level, curve.length - 1)]) {
      remaining -= curve[Math.min(level, curve.length - 1)];
      level += 1;
    }

    this.deps.store.update((state) => {
      state.mastery[trackId] = { trackId, level, xp: roundCurrency(remaining, 2) };
    }, at);

    this.deps.events.emit('progression:mastery-gained', { trackId, level, xp: roundCurrency(remaining, 2) });
  }

  /* ---------------------------------------------------------- event hooks */

  /** Called by the building system after a tier change. */
  onBuildingRestored(buildingId: BuildingId, at = this.deps.clock.now()): void {
    const definition = this.deps.content.getBuilding(buildingId);
    if (definition) {
      this.deps.buildings.recomputeDistrictProgress(definition.districtId, at);
      const trackId = this.deps.content.getDistrict(definition.districtId)?.masteryTrackId;
      if (trackId) this.addMasteryXp(trackId, 1, at);
    }
    this.refreshUnlocks(at);
  }

  /** Called by the upgrade system when an upgrade finishes. */
  onUpgradeCompleted(buildingId: BuildingId | null, at = this.deps.clock.now()): void {
    if (buildingId) {
      const definition = this.deps.content.getBuilding(buildingId);
      if (definition) {
        this.deps.buildings.recomputeDistrictProgress(definition.districtId, at);
        const trackId = this.deps.content.getDistrict(definition.districtId)?.masteryTrackId;
        if (trackId) this.addMasteryXp(trackId, 2, at);
      }
    }
    this.refreshUnlocks(at);
  }

  /** Refresh the cached stage progress values (cheap, called on demand). */
  refreshStageProgress(at = this.deps.clock.now()): void {
    const stages = this.deps.content.listStages();
    if (stages.length === 0) return;
    this.deps.store.update((state) => {
      for (const stage of stages) {
        state.progression.stageProgress[stage.id] = this.getStageProgress(stage.id);
      }
    }, at);
  }

  /** Debug/QA summary. */
  summary(): { stage: StageId; unlockedStages: number; unlockedDistricts: number; mastery: number } {
    const state = this.deps.store.state;
    return {
      stage: state.progression.currentStageId,
      unlockedStages: state.progression.unlockedStageIds.length,
      unlockedDistricts: state.progression.unlockedDistrictIds.length,
      mastery: this.getHighestMasteryLevel(),
    };
  }

  /** Reserved: redevelopment/prestige lives in a later phase. */
  get redevelopmentEnabled(): boolean {
    return false;
  }
}
