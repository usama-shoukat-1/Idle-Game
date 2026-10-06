import { describe, expect, it } from 'vitest';

import { ContentRegistry } from '@/core/content/ContentRegistry';
import { DEFAULT_CONTENT } from '@/data';
import { asDurationMs, buildingId, seconds, stageId, upgradeId } from '@/core/types/primitives';
import type { BuildingDefinition, StageDefinition } from '@/core/types/content';
import { createTestContent } from './helpers/TestEnvironment';

/**
 * Content registry guarantees: content is validated at load, and adding a building is a
 * data-only operation (the registry, not the systems, is where content knowledge lives).
 */
describe('ContentRegistry', () => {
  it('loads the shipped Phase 0 content without errors', () => {
    const registry = new ContentRegistry();
    expect(() => registry.load(DEFAULT_CONTENT)).not.toThrow();

    const report = registry.validate();
    expect(report.isValid).toBe(true);
    expect(registry.isLoaded).toBe(true);
    expect(registry.getAllStages().length).toBeGreaterThan(0);
    expect(registry.getAllDistricts().length).toBeGreaterThan(0);
    // Phase 0 intentionally ships no buildings or upgrades.
    expect(registry.getAllBuildings()).toHaveLength(0);
    expect(registry.getAllUpgrades()).toHaveLength(0);
  });

  it('rejects duplicate ids', () => {
    const registry = createTestContent() && new ContentRegistry();
    const stage: StageDefinition = {
      id: stageId('stage.dupe'),
      displayName: 'Dupe',
      description: '',
      order: 0,
      buildingIds: [],
      unlockRequirements: [],
      synergy: { masteryMax: 1, synergyScalePercent: 0 },
    };

    registry.registerStage(stage);
    expect(() => registry.registerStage(stage)).toThrowError(/Duplicate stage id/);
  });

  it('reports a tier whose index does not match its position', () => {
    const registry = new ContentRegistry();
    const broken: BuildingDefinition = {
      id: buildingId('building.broken'),
      displayName: 'Broken',
      description: '',
      stageId: stageId('stage.x'),
      type: 'cafe',
      order: 0,
      baseIncome: { kind: 'perSecond', coinsPerSecond: 1 },
      restorationTiers: [
        { tier: 5, displayName: 'Wrong index', cost: { currency: 'coins', amount: 1 }, durationMs: asDurationMs(0), incomeMultiplier: 1, visualState: 'a', prerequisites: [], unlocks: [] },
      ],
      visualStates: [{ key: 'a', layers: {} }],
      unlockRequirements: [],
      synergyRules: [],
    };

    registry.load(
      {
        districts: [],
        stages: [],
        buildings: [broken],
        upgrades: [],
        workers: [],
        economy: { ...DEFAULT_CONTENT.economy },
      },
      { throwOnInvalid: false },
    );

    const report = registry.validate();
    expect(report.isValid).toBe(false);
    expect(report.toString()).toContain('tier must equal its index');
  });

  it('reports a tier referencing an unknown visual state and stage', () => {
    const registry = new ContentRegistry();
    registry.load(
      {
        districts: [],
        stages: [],
        buildings: [
          {
            id: buildingId('building.ghost'),
          displayName: 'Ghost',
          description: '',
          stageId: stageId('stage.missing'),
          type: 'retail',
          order: 0,
          baseIncome: { kind: 'perSecond', coinsPerSecond: 1 },
          restorationTiers: [
            { tier: 0, displayName: 'x', cost: { currency: 'coins', amount: 0 }, durationMs: asDurationMs(0), incomeMultiplier: 1, visualState: 'nope', prerequisites: [], unlocks: [] },
          ],
          visualStates: [{ key: 'ok', layers: {} }],
            unlockRequirements: [],
            synergyRules: [],
          },
        ],
        upgrades: [],
        workers: [],
        economy: { ...DEFAULT_CONTENT.economy },
      },
      { throwOnInvalid: false },
    );

    const report = registry.validate().toString();
    expect(report).toContain('unknown stage');
    expect(report).toContain('unknown visual state');
  });

  it('reports an upgrade targeting a missing building', () => {
    const registry = new ContentRegistry();
    registry.load(
      {
        districts: [],
        stages: [],
        buildings: [],
        upgrades: [
          {
            id: upgradeId('upgrade.orphan'),
            displayName: 'Orphan',
            description: '',
            targetBuildingId: buildingId('building.nope'),
            tier: 1,
            cost: { currency: 'coins', amount: 1 },
            durationMs: seconds(1),
            incomeMultiplier: 1,
            unlocks: [],
            visualState: 'x',
            prerequisites: [],
          },
        ],
        workers: [],
        economy: { ...DEFAULT_CONTENT.economy },
      },
      { throwOnInvalid: false },
    );

    expect(registry.validate().toString()).toContain('targets unknown building');
  });

  it('exposes ordered stage/building queries used by the systems', () => {
    const registry = createTestContent();

    expect(registry.getStageBuildings(stageId('stage.test.street')).map((b) => b.id)).toEqual([
      'building.test.cafe',
    ]);
    expect(registry.getBuildingUpgrades(buildingId('building.test.cafe')).map((u) => u.tier)).toEqual([1, 2]);
    expect(registry.getMaxTier(buildingId('building.test.cafe'))).toBe(2);
    expect(registry.getTier(buildingId('building.test.cafe'), 1)?.visualState).toBe('tier1');
  });

  it('supports balance overrides with nested merging (used for tuning and tests)', () => {
    const registry = createTestContent();
    registry.overrideEconomyBalance({ startingCoins: 999, offline: { ...registry.getEconomyBalance().offline, efficiency: 0.25 } });

    const balance = registry.getEconomyBalance();
    expect(balance.startingCoins).toBe(999);
    expect(balance.offline.efficiency).toBe(0.25);
    expect(balance.offline.minimumDurationMs).toBe(60_000);
  });

  it('throws a clear error for unknown ids (fail fast, no silent fallbacks)', () => {
    const registry = createTestContent();
    expect(() => registry.getBuilding(buildingId('building.nope'))).toThrowError(/Unknown building id/);
    expect(registry.tryGetBuilding(buildingId('building.nope'))).toBeUndefined();
  });
});
