import type { ContentRegistry } from '@/core/content/ContentRegistry';
import type { UnlockRequirement } from '@/core/types/content';
import type { BuildingId, StageId, UpgradeId } from '@/core/types/primitives';
import type { GameState } from '@/core/types/state';

/**
 * ONE implementation of "is this unlocked yet?".
 *
 * Stage gating, building gating and upgrade gating all use the same data shape
 * (`UnlockRequirement[]`), so content authors add requirements without any new code
 * and there is exactly one place where gating logic can be wrong.
 */

export interface RequirementContext {
  readonly state: GameState;
  readonly content: ContentRegistry;
  readonly isBuildingUnlocked: (id: BuildingId) => boolean;
  readonly isUpgradeCompleted: (id: UpgradeId) => boolean;
  readonly getCurrency: (currency: 'coins' | 'gems') => number;
  readonly getStageProgress: (id: StageId) => { mastery: number; unlocked: boolean } | null;
}

export interface RequirementStatus {
  readonly satisfied: boolean;
  /** First unmet requirement, player-facing enough to show in a tooltip. */
  readonly blocking: UnlockRequirement | null;
  readonly description: string;
}

export function evaluateRequirements(
  requirements: readonly UnlockRequirement[],
  context: RequirementContext,
): RequirementStatus {
  for (const requirement of requirements) {
    if (isRequirementSatisfied(requirement, context)) continue;
    return {
      satisfied: false,
      blocking: requirement,
      description: describeRequirement(requirement, context),
    };
  }
  return { satisfied: true, blocking: null, description: '' };
}

export function isRequirementSatisfied(
  requirement: UnlockRequirement,
  context: RequirementContext,
): boolean {
  const { state, content } = context;

  switch (requirement.kind) {
    case 'stage': {
      if (!requirement.id) return true;
      const stageId = requirement.id as StageId;
      const progress = context.getStageProgress(stageId);
      if (!progress) return false;
      if (!progress.unlocked) return false;
      const required = requirement.value ?? 0;
      return progress.mastery >= required;
    }
    case 'building': {
      if (!requirement.id) return true;
      return context.isBuildingUnlocked(requirement.id as BuildingId);
    }
    case 'upgrade': {
      if (!requirement.id) return true;
      return context.isUpgradeCompleted(requirement.id as UpgradeId);
    }
    case 'mastery': {
      const stageId = (requirement.id ?? state.progression.currentStageId) as StageId;
      const progress = context.getStageProgress(stageId);
      return (progress?.mastery ?? 0) >= (requirement.value ?? 0);
    }
    case 'currency': {
      const currency = (requirement.id === 'gems' ? 'gems' : 'coins') as 'coins' | 'gems';
      const balance = context.getCurrency(currency);
      return balance >= (requirement.value ?? 0);
    }
    default: {
      // Unknown requirement kinds are treated as satisfied so a newer content pack can
      // add kinds without breaking an older runtime (forward compatibility).
      void content;
      return true;
    }
  }
}

/** Short human-readable text for a requirement, used by tooltips and debug output. */
export function describeRequirement(requirement: UnlockRequirement, context: RequirementContext): string {
  switch (requirement.kind) {
    case 'stage':
      return `Reach ${requirement.value ?? 0} mastery in ${requirement.id ?? 'the current stage'}`;
    case 'building': {
      const building = requirement.id ? context.content.tryGetBuilding(requirement.id as BuildingId) : undefined;
      return `Restore ${building?.displayName ?? requirement.id ?? 'a building'}`;
    }
    case 'upgrade': {
      const upgrade = requirement.id ? context.content.tryGetUpgrade(requirement.id as UpgradeId) : undefined;
      return `Complete ${upgrade?.displayName ?? requirement.id ?? 'an upgrade'}`;
    }
    case 'mastery':
      return `Mastery ${requirement.value ?? 0}`;
    case 'currency':
      return `Needs ${requirement.value ?? 0} ${requirement.id ?? 'coins'}`;
    default:
      return 'Locked';
  }
}
