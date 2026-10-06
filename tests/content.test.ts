import { describe, expect, it } from 'vitest';
import { ContentRegistry } from '@/systems/ContentSystem/ContentRegistry';
import { buildContentRegistry, CONTENT_PACKS } from '@/data';
import {
  createFixtureContent,
  TEST_BUILDING,
  TEST_CLEAN_UPGRADE,
  TEST_DISTRICT,
  TEST_STAGE,
} from './helpers/fixtures';

describe('ContentRegistry', () => {
  it('looks definitions up by id', () => {
    const registry = createFixtureContent();

    expect(registry.getBuilding(TEST_BUILDING.id)?.displayName).toBe('Test Shop');
    expect(registry.getUpgrade(TEST_CLEAN_UPGRADE.id)?.displayName).toBe('Clean the windows');
    expect(registry.getDistrict(TEST_DISTRICT.id)?.buildingIds).toEqual([TEST_BUILDING.id]);
    expect(registry.getStage(TEST_STAGE.id)?.districtIds).toEqual([TEST_DISTRICT.id]);
    expect(registry.getBalance('default')?.id).toBe('default');
  });

  it('rejects duplicate ids early', () => {
    const registry = createFixtureContent();
    expect(() => registry.registerBuilding(TEST_BUILDING)).toThrow(/duplicate building id/);
  });

  it('validates cross references', () => {
    const registry = new ContentRegistry();
    registry.load({
      buildings: [TEST_BUILDING],
      upgrades: [
        {
          id: 'upgrade.ghost',
          displayName: 'Ghost',
          target: { kind: 'building', buildingId: 'building.does-not-exist' },
          kind: 'instant',
          tier: 1,
          cost: { coins: 1 },
          durationMs: 0,
          effects: [],
        },
      ],
      stages: [{ id: 'stage.test', displayName: 'S', order: 1, districtIds: ['district.missing'] }],
      districts: [{ ...TEST_DISTRICT, buildingIds: ['building.missing'] }],
    });

    const report = registry.validate();
    expect(report.ok).toBe(false);
    expect(report.errors.some((error) => error.includes('building.does-not-exist'))).toBe(true);
    expect(report.errors.some((error) => error.includes('district.missing'))).toBe(true);
    expect(report.errors.some((error) => error.includes('building.missing'))).toBe(true);
  });

  it('warns (but does not fail) while no building content exists', () => {
    const report = buildContentRegistry().validate();
    expect(report.ok).toBe(true);
    expect(report.warnings.some((warning) => warning.includes('no building definitions'))).toBe(true);
  });

  it('ships an empty but working Phase 0 content set', () => {
    const registry = buildContentRegistry();
    expect(CONTENT_PACKS.buildings).toHaveLength(0);
    expect(registry.listBuildings()).toHaveLength(0);
    expect(registry.getBalance('default')).not.toBeNull();
  });

  it('rejects ad placements that are not opt-in', () => {
    const registry = new ContentRegistry();
    expect(() =>
      registry.registerAdPlacement({
        id: 'ad.test',
        displayName: 'Test',
        // Deliberately wrong to prove the policy guard exists.
        requiresOptIn: false as unknown as true,
        grants: [{ kind: 'coins', amount: 10, label: '+10 coins' }],
        cooldownMs: 0,
      }),
    ).toThrow(/opt-in/);
  });

  it('groups district buildings in authoring order', () => {
    const registry = createFixtureContent();
    expect(registry.getDistrictBuildings(TEST_DISTRICT.id).map((entry) => entry.id)).toEqual([TEST_BUILDING.id]);
    expect(registry.getBuildingsForStage(TEST_STAGE.id).map((entry) => entry.id)).toEqual([TEST_BUILDING.id]);
  });
});
