/**
 * Central content registry.
 *
 * The registry is the only place that knows how to look up definitions, and it is
 * built entirely from `src/data/**` + `src/config/**`. Adding a new building, upgrade
 * or district is a data change - no engine file needs to be touched:
 *
 *   1. author the definition in `src/data/buildings`
 *   2. export it from the matching index
 *   3. (optionally) reference it from a district/stage definition
 *
 * Validation runs once at boot and reports broken references (unknown building id
 * in a district, upgrade targeting a missing building, duplicated tier numbers…).
 */

import type {
  BuildingDefinition,
  ContentSnapshot,
  DistrictDefinition,
  EconomyBalanceDefinition,
  EventDefinition,
  MasteryTrackDefinition,
  ProductCatalogEntry,
  RewardedAdPlacementDefinition,
  StageDefinition,
  UpgradeDefinition,
  EntitlementDefinition,
} from '@/core/types/content';
import type { AdPlacementId, BalanceId, BuildingId, DistrictId, EventId, ProductId, StageId, UpgradeId } from '@/core/types/ids';
import { createLogger } from '@/core/utils/logger';
import { DEFAULT_STAGE_ID } from '@/core/constants';

export interface ContentRegistryInput {
  buildings?: BuildingDefinition[];
  upgrades?: UpgradeDefinition[];
  districts?: DistrictDefinition[];
  stages?: StageDefinition[];
  masteryTracks?: MasteryTrackDefinition[];
  events?: EventDefinition[];
  balances?: EconomyBalanceDefinition[];
  adPlacements?: RewardedAdPlacementDefinition[];
  products?: ProductCatalogEntry[];
  entitlements?: EntitlementDefinition[];
}

export interface ContentValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export class ContentRegistry {
  private readonly log = createLogger('content');
  private readonly buildings = new Map<BuildingId, BuildingDefinition>();
  private readonly upgrades = new Map<UpgradeId, UpgradeDefinition>();
  private readonly districts = new Map<DistrictId, DistrictDefinition>();
  private readonly stages = new Map<StageId, StageDefinition>();
  private readonly masteryTracks = new Map<string, MasteryTrackDefinition>();
  private readonly events = new Map<EventId, EventDefinition>();
  private readonly balances = new Map<BalanceId, EconomyBalanceDefinition>();
  private readonly adPlacements = new Map<AdPlacementId, RewardedAdPlacementDefinition>();
  private readonly products = new Map<ProductId, ProductCatalogEntry>();
  private readonly entitlements = new Map<string, EntitlementDefinition>();

  /* ------------------------------------------------------------- registration */

  registerBuilding(definition: BuildingDefinition): void {
    assertUnique(this.buildings, definition.id, 'building');
    this.buildings.set(definition.id, definition);
  }

  registerBuildings(definitions: readonly BuildingDefinition[]): void {
    for (const definition of definitions) this.registerBuilding(definition);
  }

  registerUpgrade(definition: UpgradeDefinition): void {
    assertUnique(this.upgrades, definition.id, 'upgrade');
    this.upgrades.set(definition.id, definition);
  }

  registerUpgrades(definitions: readonly UpgradeDefinition[]): void {
    for (const definition of definitions) this.registerUpgrade(definition);
  }

  registerDistrict(definition: DistrictDefinition): void {
    assertUnique(this.districts, definition.id, 'district');
    this.districts.set(definition.id, definition);
  }

  registerStage(definition: StageDefinition): void {
    assertUnique(this.stages, definition.id, 'stage');
    this.stages.set(definition.id, definition);
  }

  registerMasteryTrack(definition: MasteryTrackDefinition): void {
    assertUnique(this.masteryTracks, definition.id, 'mastery track');
    this.masteryTracks.set(definition.id, definition);
  }

  registerEvent(definition: EventDefinition): void {
    assertUnique(this.events, definition.id, 'event');
    this.events.set(definition.id, definition);
  }

  registerBalance(definition: EconomyBalanceDefinition): void {
    this.balances.set(definition.id, definition);
  }

  registerAdPlacement(definition: RewardedAdPlacementDefinition): void {
    if (definition.requiresOptIn !== true) {
      throw new Error(`ad placement "${definition.id}" must be opt-in (requiresOptIn: true)`);
    }
    this.adPlacements.set(definition.id, definition);
  }

  registerProduct(definition: ProductCatalogEntry): void {
    this.products.set(definition.id, definition);
  }

  registerEntitlement(definition: EntitlementDefinition): void {
    this.entitlements.set(definition.id, definition);
  }

  /** Bulk load from the content packs. */
  load(input: ContentRegistryInput): void {
    this.registerBuildings(input.buildings ?? []);
    this.registerUpgrades(input.upgrades ?? []);
    input.districts?.forEach((definition) => this.registerDistrict(definition));
    input.stages?.forEach((definition) => this.registerStage(definition));
    input.masteryTracks?.forEach((definition) => this.registerMasteryTrack(definition));
    input.events?.forEach((definition) => this.registerEvent(definition));
    input.balances?.forEach((definition) => this.registerBalance(definition));
    input.adPlacements?.forEach((definition) => this.registerAdPlacement(definition));
    input.products?.forEach((definition) => this.registerProduct(definition));
    input.entitlements?.forEach((definition) => this.registerEntitlement(definition));
  }

  /* ------------------------------------------------------------------ lookups */

  getBuilding(id: BuildingId): BuildingDefinition | null {
    return this.buildings.get(id) ?? null;
  }

  requireBuilding(id: BuildingId): BuildingDefinition {
    const definition = this.buildings.get(id);
    if (!definition) throw new Error(`unknown building id "${id}"`);
    return definition;
  }

  getUpgrade(id: UpgradeId): UpgradeDefinition | null {
    return this.upgrades.get(id) ?? null;
  }

  getDistrict(id: DistrictId): DistrictDefinition | null {
    return this.districts.get(id) ?? null;
  }

  getStage(id: StageId): StageDefinition | null {
    return this.stages.get(id) ?? null;
  }

  getMasteryTrack(id: string): MasteryTrackDefinition | null {
    return this.masteryTracks.get(id) ?? null;
  }

  getEvent(id: EventId): EventDefinition | null {
    return this.events.get(id) ?? null;
  }

  getAdPlacement(id: AdPlacementId): RewardedAdPlacementDefinition | null {
    return this.adPlacements.get(id) ?? null;
  }

  getProduct(id: ProductId): ProductCatalogEntry | null {
    return this.products.get(id) ?? null;
  }

  getEntitlement(id: string): EntitlementDefinition | null {
    return this.entitlements.get(id) ?? null;
  }

  /** Balance lookup with a crash-proof fallback to the first registered balance. */
  getBalance(id: BalanceId): EconomyBalanceDefinition | null {
    const direct = this.balances.get(id);
    if (direct) return direct;
    const first = [...this.balances.values()][0];
    if (first && id !== first.id) {
      this.log.warn(`balance "${id}" not registered - falling back to "${first.id}"`);
    }
    return first ?? null;
  }

  /* ------------------------------------------------------------------ listings */

  listBuildings(): BuildingDefinition[] {
    return [...this.buildings.values()].sort((a, b) => a.order - b.order);
  }

  listStages(): StageDefinition[] {
    return [...this.stages.values()].sort((a, b) => a.order - b.order);
  }

  listDistricts(): DistrictDefinition[] {
    return [...this.districts.values()].sort((a, b) => a.order - b.order);
  }

  listUpgrades(): UpgradeDefinition[] {
    return [...this.upgrades.values()];
  }

  listMasteryTracks(): MasteryTrackDefinition[] {
    return [...this.masteryTracks.values()];
  }

  listAdPlacements(): RewardedAdPlacementDefinition[] {
    return [...this.adPlacements.values()];
  }

  listProducts(): ProductCatalogEntry[] {
    return [...this.products.values()];
  }

  listEntitlements(): EntitlementDefinition[] {
    return [...this.entitlements.values()];
  }

  /** Buildings belonging to a district, in authoring order. */
  getDistrictBuildings(districtId: DistrictId): BuildingDefinition[] {
    const district = this.districts.get(districtId);
    if (!district) return [];
    return district.buildingIds
      .map((id) => this.buildings.get(id))
      .filter((definition): definition is BuildingDefinition => Boolean(definition));
  }

  getBuildingsForStage(stageId: StageId): BuildingDefinition[] {
    return this.listBuildings().filter((definition) => definition.stageId === stageId);
  }

  /** Immutable-ish snapshot handed to core state helpers. */
  snapshot(): ContentSnapshot {
    return {
      buildings: this.listBuildings(),
      upgrades: this.listUpgrades(),
      districts: this.listDistricts(),
      stages: this.listStages(),
      masteryTracks: this.listMasteryTracks(),
    };
  }

  get isEmpty(): boolean {
    return this.buildings.size === 0 && this.stages.size === 0 && this.districts.size === 0;
  }

  get counts(): Record<string, number> {
    return {
      buildings: this.buildings.size,
      upgrades: this.upgrades.size,
      districts: this.districts.size,
      stages: this.stages.size,
      masteryTracks: this.masteryTracks.size,
      events: this.events.size,
      balances: this.balances.size,
      adPlacements: this.adPlacements.size,
      products: this.products.size,
      entitlements: this.entitlements.size,
    };
  }

  /* --------------------------------------------------------------- validation */

  /**
   * Cross-reference validation. Called once after loading so a typo in content
   * surfaces at boot instead of at the moment a player unlocks something.
   */
  validate(): ContentValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];

    const stageIds = new Set(this.stages.keys());
    const districtIds = new Set(this.districts.keys());

    for (const district of this.districts.values()) {
      if (stageIds.size > 0 && !stageIds.has(district.stageId)) {
        errors.push(`district "${district.id}" references unknown stage "${district.stageId}"`);
      }
      for (const buildingId of district.buildingIds) {
        const building = this.buildings.get(buildingId);
        if (!building) {
          errors.push(`district "${district.id}" lists unknown building "${buildingId}"`);
          continue;
        }
        if (building.districtId !== district.id) {
          warnings.push(
            `building "${buildingId}".districtId (${building.districtId}) does not match district "${district.id}"`,
          );
        }
      }
    }

    for (const stage of this.stages.values()) {
      for (const districtId of stage.districtIds) {
        if (!districtIds.has(districtId)) {
          errors.push(`stage "${stage.id}" lists unknown district "${districtId}"`);
        }
      }
    }

    for (const building of this.buildings.values()) {
      if (stageIds.size > 0 && !stageIds.has(building.stageId)) {
        errors.push(`building "${building.id}" references unknown stage "${building.stageId}"`);
      }
      if (districtIds.size > 0 && !districtIds.has(building.districtId)) {
        errors.push(`building "${building.id}" references unknown district "${building.districtId}"`);
      }
      if (building.incomeIntervalMs <= 0) {
        errors.push(`building "${building.id}" has a non-positive incomeIntervalMs`);
      }
      const tiers = building.restorationTiers.map((tier) => tier.tier);
      if (new Set(tiers).size !== tiers.length) {
        errors.push(`building "${building.id}" has duplicated restoration tier numbers`);
      }
      const visualStates = new Set(building.visualStates.map((state) => state.id));
      for (const tier of building.restorationTiers) {
        if (visualStates.size > 0 && !visualStates.has(tier.visualStateId)) {
          errors.push(
            `building "${building.id}" tier ${tier.tier} references unknown visual state "${tier.visualStateId}"`,
          );
        }
      }
      for (const upgradeId of building.upgradeIds) {
        if (!this.upgrades.has(upgradeId)) {
          errors.push(`building "${building.id}" lists unknown upgrade "${upgradeId}"`);
        }
      }
      if (building.maxTier > 0 && building.restorationTiers.length === 0) {
        warnings.push(`building "${building.id}" has maxTier ${building.maxTier} but no restoration tiers`);
      }
    }

    for (const upgrade of this.upgrades.values()) {
      if (upgrade.target.kind === 'building' && !this.buildings.has(upgrade.target.buildingId)) {
        errors.push(`upgrade "${upgrade.id}" targets unknown building "${upgrade.target.buildingId}"`);
      }
      if (upgrade.target.kind === 'district' && !districtIds.has(upgrade.target.districtId)) {
        errors.push(`upgrade "${upgrade.id}" targets unknown district "${upgrade.target.districtId}"`);
      }
      if (upgrade.durationMs < 0) {
        errors.push(`upgrade "${upgrade.id}" has a negative durationMs`);
      }
      for (const effect of upgrade.effects) {
        if (effect.type === 'unlock-building' && effect.targetId && !this.buildings.has(effect.targetId)) {
          errors.push(`upgrade "${upgrade.id}" unlocks unknown building "${effect.targetId}"`);
        }
        if (effect.type === 'unlock-district' && effect.targetId && !districtIds.has(effect.targetId)) {
          errors.push(`upgrade "${upgrade.id}" unlocks unknown district "${effect.targetId}"`);
        }
      }
    }

    for (const placement of this.adPlacements.values()) {
      if (placement.requiresOptIn !== true) {
        errors.push(`ad placement "${placement.id}" must be opt-in`);
      }
      if (!placement.grants || placement.grants.length === 0) {
        warnings.push(`ad placement "${placement.id}" grants nothing`);
      }
    }

    if (this.buildings.size === 0) {
      warnings.push(
        `no building definitions registered yet - the first playable building arrives in Phase 1 (current stage placeholder: "${DEFAULT_STAGE_ID}")`,
      );
    }

    const report: ContentValidationReport = { ok: errors.length === 0, errors, warnings };
    if (errors.length > 0) this.log.error(`content validation found ${errors.length} error(s)`, errors);
    if (warnings.length > 0) this.log.warn(`content validation notes: ${warnings.join(' | ')}`);
    return report;
  }
}

function assertUnique<T>(map: Map<string, T>, id: string, kind: string): void {
  if (map.has(id)) throw new Error(`duplicate ${kind} id "${id}"`);
}
