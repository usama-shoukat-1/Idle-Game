import { logger } from '@/core/Logger';
import type {
  BuildingDefinition,
  DistrictDefinition,
  EconomyBalanceConfig,
  RewardedRewardDefinition,
  StageDefinition,
  TutorialStepDefinition,
  UpgradeDefinition,
  WorkerDefinition,
} from '@/core/types/content';
import { asDurationMs, type BuildingId, type StageId, type UpgradeId, type WorkerId } from '@/core/types/primitives';
import { ValidationResult } from '@/core/utils/Validation';

/**
 * THE content registry.
 *
 * Systems never import content modules directly: they receive the registry and ask it
 * for definitions. That is what makes "add a new building without touching the economy
 * engine" true rather than aspirational - the economy only ever sees generic fields
 * (`baseIncome`, `restorationTiers[i].incomeMultiplier`, ...).
 *
 * Registration validates aggressively at boot: bad content must fail loudly and early
 * rather than producing a silently broken economy weeks later.
 */

export interface ContentBundle {
  readonly districts: readonly DistrictDefinition[];
  readonly stages: readonly StageDefinition[];
  readonly buildings: readonly BuildingDefinition[];
  readonly upgrades: readonly UpgradeDefinition[];
  readonly workers: readonly WorkerDefinition[];
  readonly economy: EconomyBalanceConfig;
  /**
   * Optional onboarding steps, in order. Content, not code: the tutorial system walks the
   * list and needs no knowledge of the building being explained.
   */
  readonly tutorialSteps?: readonly TutorialStepDefinition[];
}

export const EMPTY_ECONOMY_BALANCE: EconomyBalanceConfig = {
  startingCoins: 0,
  startingGems: 0,
  maxCoins: Number.MAX_SAFE_INTEGER,
  maxGems: 1_000_000,
  offline: {
    maxDurationMs: asDurationMs(14 * 24 * 60 * 60 * 1000),
    efficiency: 0,
    minimumDurationMs: asDurationMs(60_000),
  },
  acceleration: {
    gemsPerMinute: 0,
    minimumGems: 0,
  },
  rewardedRewards: [],
};

export class ContentRegistry {
  private readonly buildings = new Map<BuildingId, BuildingDefinition>();
  private readonly upgrades = new Map<UpgradeId, UpgradeDefinition>();
  private readonly stages = new Map<StageId, StageDefinition>();
  private readonly districts = new Map<string, DistrictDefinition>();
  private readonly workers = new Map<WorkerId, WorkerDefinition>();
  private tutorialSteps: readonly TutorialStepDefinition[] = [];
  private economy: EconomyBalanceConfig = EMPTY_ECONOMY_BALANCE;
  private loaded = false;

  get isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Loads a content bundle.
   * @param options.throwOnInvalid fail fast on invalid content (default: development builds
   *        only, because a broken registration must never reach a player).
   */
  load(bundle: ContentBundle, options: { throwOnInvalid?: boolean } = {}): void {
    this.reset();

    for (const district of bundle.districts) this.registerDistrict(district);
    for (const stage of bundle.stages) this.registerStage(stage);
    for (const building of bundle.buildings) this.registerBuilding(building);
    for (const upgrade of bundle.upgrades) this.registerUpgrade(upgrade);
    for (const worker of bundle.workers) this.registerWorker(worker);

    this.economy = bundle.economy;
    this.tutorialSteps = bundle.tutorialSteps ?? [];
    this.loaded = true;

    const report = this.validate();
    if (!report.isValid) {
      // Content errors are developer errors: fail fast instead of shipping a broken economy.
      logger.error('content', `content validation failed: ${report.toString()}`);
      const throwOnInvalid = options.throwOnInvalid ?? (import.meta.env?.DEV ?? false);
      if (throwOnInvalid) {
        throw new Error(`Content validation failed: ${report.toString()}`);
      }
    } else {
      logger.info(
        'content',
        `loaded ${this.districts.size} districts, ${this.stages.size} stages, ${this.buildings.size} buildings, ${this.upgrades.size} upgrades`,
      );
    }
  }

  registerDistrict(district: DistrictDefinition): void {
    if (this.districts.has(district.id)) {
      throw new Error(`Duplicate district id "${district.id}"`);
    }
    this.districts.set(district.id, district);
  }

  registerStage(stage: StageDefinition): void {
    if (this.stages.has(stage.id)) {
      throw new Error(`Duplicate stage id "${stage.id}"`);
    }
    this.stages.set(stage.id, stage);
  }

  registerBuilding(building: BuildingDefinition): void {
    if (this.buildings.has(building.id)) {
      throw new Error(`Duplicate building id "${building.id}"`);
    }
    this.buildings.set(building.id, building);
  }

  registerUpgrade(upgrade: UpgradeDefinition): void {
    if (this.upgrades.has(upgrade.id)) {
      throw new Error(`Duplicate upgrade id "${upgrade.id}"`);
    }
    this.upgrades.set(upgrade.id, upgrade);
  }

  registerWorker(worker: WorkerDefinition): void {
    if (this.workers.has(worker.id)) {
      throw new Error(`Duplicate worker id "${worker.id}"`);
    }
    this.workers.set(worker.id, worker);
  }

  // --- Queries -------------------------------------------------------------

  /** Throws when the id is unknown: call sites should have validated content first. */
  getBuilding(id: BuildingId): BuildingDefinition {
    const found = this.buildings.get(id);
    if (!found) throw new Error(`Unknown building id "${id}"`);
    return found;
  }

  tryGetBuilding(id: BuildingId): BuildingDefinition | undefined {
    return this.buildings.get(id);
  }

  getUpgrade(id: UpgradeId): UpgradeDefinition {
    const found = this.upgrades.get(id);
    if (!found) throw new Error(`Unknown upgrade id "${id}"`);
    return found;
  }

  tryGetUpgrade(id: UpgradeId): UpgradeDefinition | undefined {
    return this.upgrades.get(id);
  }

  getStage(id: StageId): StageDefinition {
    const found = this.stages.get(id);
    if (!found) throw new Error(`Unknown stage id "${id}"`);
    return found;
  }

  tryGetStage(id: StageId): StageDefinition | undefined {
    return this.stages.get(id);
  }

  getDistrict(id: string): DistrictDefinition {
    const found = this.districts.get(id);
    if (!found) throw new Error(`Unknown district id "${id}"`);
    return found;
  }

  getWorkers(): readonly WorkerDefinition[] {
    return [...this.workers.values()];
  }

  getEconomyBalance(): EconomyBalanceConfig {
    return this.economy;
  }

  /** Ordered onboarding steps (empty when the build ships no tutorial). */
  getTutorialSteps(): readonly TutorialStepDefinition[] {
    return this.tutorialSteps;
  }

  getTutorialStep(id: string): TutorialStepDefinition | undefined {
    return this.tutorialSteps.find((step) => step.id === id);
  }

  /**
   * Shallow-merges balance overrides on top of the loaded balance config.
   * Used by development tuning and by tests that need a deterministic economy.
   */
  overrideEconomyBalance(overrides: Partial<EconomyBalanceConfig>): void {
    this.economy = {
      ...this.economy,
      ...overrides,
      offline: { ...this.economy.offline, ...(overrides.offline ?? {}) },
      acceleration: { ...this.economy.acceleration, ...(overrides.acceleration ?? {}) },
      rewardedRewards: overrides.rewardedRewards ?? this.economy.rewardedRewards,
    };
  }

  getRewardedRewards(): readonly RewardedRewardDefinition[] {
    return this.economy.rewardedRewards;
  }

  getRewardedReward(id: string): RewardedRewardDefinition | undefined {
    return this.economy.rewardedRewards.find((reward) => reward.id === id);
  }

  /** Buildings of a stage in presentation order. */
  getStageBuildings(stageId: StageId): readonly BuildingDefinition[] {
    return [...this.buildings.values()]
      .filter((building) => building.stageId === stageId)
      .sort((a, b) => a.order - b.order);
  }

  /** Upgrades that target a building, ordered by tier. */
  getBuildingUpgrades(buildingId: BuildingId): readonly UpgradeDefinition[] {
    return [...this.upgrades.values()]
      .filter((upgrade) => upgrade.targetBuildingId === buildingId)
      .sort((a, b) => a.tier - b.tier);
  }

  getAllStages(): readonly StageDefinition[] {
    return [...this.stages.values()].sort((a, b) => a.order - b.order);
  }

  getAllDistricts(): readonly DistrictDefinition[] {
    return [...this.districts.values()].sort((a, b) => a.order - b.order);
  }

  getAllBuildings(): readonly BuildingDefinition[] {
    return [...this.buildings.values()];
  }

  getAllUpgrades(): readonly UpgradeDefinition[] {
    return [...this.upgrades.values()];
  }

  /** Find the restoration tier definition for a building, or undefined past the cap. */
  getTier(buildingId: BuildingId, tier: number) {
    return this.buildings.get(buildingId)?.restorationTiers.find((entry) => entry.tier === tier);
  }

  /** Highest tier index available for a building (0 when it has no tiers yet). */
  getMaxTier(buildingId: BuildingId): number {
    const tiers = this.buildings.get(buildingId)?.restorationTiers ?? [];
    return tiers.reduce((max, tier) => Math.max(max, tier.tier), 0);
  }

  // --- Validation ----------------------------------------------------------

  /**
   * Structural validation of the loaded bundle. Content design mistakes (a tier that
   * points at a missing visual state, an upgrade whose target does not exist) are
   * caught here instead of exploding mid-session.
   */
  validate(): ValidationResult {
    const result = new ValidationResult();

    for (const stage of this.stages.values()) {
      result
        .expect(stage.buildingIds.length >= 0, `stage.${stage.id}`, 'buildingIds must be an array')
        .expect(stage.synergy.masteryMax > 0, `stage.${stage.id}.synergy`, 'masteryMax must be > 0');

      for (const buildingId of stage.buildingIds) {
        result.expect(
          this.buildings.has(buildingId),
          `stage.${stage.id}`,
          `references unknown building "${buildingId}"`,
        );
      }
    }

    for (const district of this.districts.values()) {
      for (const stageId of district.stageIds) {
        result.expect(
          this.stages.has(stageId),
          `district.${district.id}`,
          `references unknown stage "${stageId}"`,
        );
      }
    }

    for (const building of this.buildings.values()) {
      const path = `building.${building.id}`;
      result
        .expect(this.stages.has(building.stageId), path, `references unknown stage "${building.stageId}"`)
        .expect(building.baseIncome !== undefined, path, 'baseIncome is required');

      const visualStates = new Set(building.visualStates.map((state) => state.key));
      result.expect(visualStates.size > 0, `${path}.visualStates`, 'at least one visual state is required');

      const tiers = [...building.restorationTiers].sort((a, b) => a.tier - b.tier);
      tiers.forEach((tier, index) => {
        const tierPath = `${path}.restorationTiers[${index}]`;
        result
          .expect(tier.tier === index, tierPath, `tier must equal its index (expected ${index}, got ${tier.tier})`)
          .expect(tier.cost.amount >= 0, `${tierPath}.cost`, 'cost must be >= 0')
          .expect(tier.durationMs >= 0, `${tierPath}.duration`, 'duration must be >= 0')
          // >= 0: the first restoration step of a building may legitimately earn nothing.
          .expect(tier.incomeMultiplier >= 0, `${tierPath}.incomeMultiplier`, 'must be >= 0')
          .expect(visualStates.has(tier.visualState), `${tierPath}.visualState`, `unknown visual state "${tier.visualState}"`);
        for (const prerequisite of tier.prerequisites) {
          result.expect(
            this.upgrades.has(prerequisite),
            `${tierPath}.prerequisites`,
            `unknown upgrade "${prerequisite}"`,
          );
        }
      });

      for (const rule of building.synergyRules) {
        for (const requirement of rule.requires) {
          result.expect(
            this.buildings.has(requirement.buildingId),
            `${path}.synergyRules.${rule.id}`,
            `unknown building "${requirement.buildingId}"`,
          );
        }
        for (const target of rule.appliesTo) {
          result.expect(
            this.buildings.has(target),
            `${path}.synergyRules.${rule.id}`,
            `unknown target building "${target}"`,
          );
        }
      }
    }

    for (const upgrade of this.upgrades.values()) {
      const path = `upgrade.${upgrade.id}`;
      result
        .expect(this.buildings.has(upgrade.targetBuildingId), path, `targets unknown building "${upgrade.targetBuildingId}"`)
        .expect(upgrade.cost.amount >= 0, `${path}.cost`, 'cost must be >= 0')
        .expect(upgrade.durationMs >= 0, `${path}.durationMs`, 'durationMs must be >= 0')
        // >= 0: a restoration step may legitimately produce no income yet (tier 1).
        .expect(upgrade.incomeMultiplier >= 0, `${path}.incomeMultiplier`, 'must be >= 0');

      const target = this.buildings.get(upgrade.targetBuildingId);
      if (target) {
        const visualStates = new Set(target.visualStates.map((state) => state.key));
        result.expect(
          visualStates.has(upgrade.visualState),
          `${path}.visualState`,
          `"${upgrade.visualState}" is not a visual state of building "${target.id}"`,
        );
      }

      for (const prerequisite of upgrade.prerequisites) {
        result.expect(this.upgrades.has(prerequisite), `${path}.prerequisites`, `unknown upgrade "${prerequisite}"`);
      }
    }

    const economy = this.economy;
    result
      .expect(economy.startingCoins >= 0, 'economy.startingCoins', 'must be >= 0')
      .expect(economy.startingGems >= 0, 'economy.startingGems', 'must be >= 0')
      .expect(economy.maxCoins > 0, 'economy.maxCoins', 'must be > 0')
      .expect(economy.maxGems > 0, 'economy.maxGems', 'must be > 0')
      .expect(
        economy.offline.efficiency >= 0 && economy.offline.efficiency <= 1,
        'economy.offline.efficiency',
        'must be within 0..1',
      )
      .expect(economy.offline.maxDurationMs >= 0, 'economy.offline.maxDurationMs', 'must be >= 0')
      .expect(
        economy.offline.minimumDurationMs >= 0,
        'economy.offline.minimumDurationMs',
        'must be >= 0',
      );

    const rewardIds = new Set<string>();
    for (const reward of economy.rewardedRewards) {
      result
        .expect(reward.amount >= 0, `economy.rewardedRewards.${reward.id}`, 'amount must be >= 0')
        .expect(reward.cooldownMs >= 0, `economy.rewardedRewards.${reward.id}`, 'cooldownMs must be >= 0')
        .expect(!rewardIds.has(reward.id), `economy.rewardedRewards.${reward.id}`, 'duplicate reward id');
      rewardIds.add(reward.id);
    }

    for (const worker of this.workers.values()) {
      result.expect(worker.hireCost.amount >= 0, `worker.${worker.id}`, 'hireCost must be >= 0');
    }

    const tutorialIds = new Set<string>();
    for (const step of this.tutorialSteps) {
      result
        .expect(step.id.length > 0, 'tutorial.step', 'id must not be empty')
        .expect(step.message.length > 0, `tutorial.${step.id}`, 'message must not be empty')
        .expect(!tutorialIds.has(step.id), `tutorial.${step.id}`, 'duplicate step id');
      tutorialIds.add(step.id);
    }

    return result;
  }

  private reset(): void {
    this.buildings.clear();
    this.upgrades.clear();
    this.stages.clear();
    this.districts.clear();
    this.workers.clear();
    this.tutorialSteps = [];
    this.economy = EMPTY_ECONOMY_BALANCE;
    this.loaded = false;
  }
}

/** Shared registry instance wired into ServiceContainer by main.ts. */
export const contentRegistry = new ContentRegistry();
