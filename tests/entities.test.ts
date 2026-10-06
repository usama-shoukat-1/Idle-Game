import { describe, expect, it } from 'vitest';
import { BuildingEntity } from '@/entities/Building/BuildingEntity';
import { WorkerEntity, type WorkerDefinition } from '@/entities/Worker/WorkerEntity';
import { CustomerEntity } from '@/entities/Customer/CustomerEntity';
import { createTestHarness, TEST_BUILDING, TEST_CLEAN_UPGRADE, unlockTestBuilding } from './helpers/fixtures';
import type { WorkerState } from '@/core/types/gameState';

describe('BuildingEntity', () => {
  it('reflects live state through the injected services', () => {
    const { context } = createTestHarness();
    const entity = context.buildings.getEntity(TEST_BUILDING.id);

    expect(entity).not.toBeNull();
    expect(entity!.displayName).toBe('Test Shop');
    expect(entity!.isUnlocked).toBe(false);
    expect(entity!.tier).toBe(0);
    expect(entity!.restorationProgress).toBe(0);
    expect(entity!.incomePerSecond).toBe(0);
  });

  it('tracks restoration progress and the next available upgrade', () => {
    const { context } = createTestHarness();
    unlockTestBuilding(context);

    const before = context.buildings.getEntity(TEST_BUILDING.id)!;
    expect(before.isUnlocked).toBe(true);
    expect(before.nextUpgrade?.upgradeId).toBe(TEST_CLEAN_UPGRADE.id);

    context.upgrades.start(TEST_CLEAN_UPGRADE.id);
    const after = context.buildings.getEntity(TEST_BUILDING.id)!;
    expect(after.tier).toBe(1);
    expect(after.restorationProgress).toBeCloseTo(0.5, 5);
    expect(after.incomePerSecond).toBeGreaterThan(0);
    expect(after.describe()).toContain('tier 1/2');
  });

  it('degrades gracefully without a rendered/known definition', () => {
    expect(new BuildingEntity(TEST_BUILDING, {
      getState: () => null,
      getIncomeBreakdown: () => null,
      getVisualState: () => 'unknown',
      listUpgrades: () => [],
    }).isUnlocked).toBe(false);
  });
});

describe('WorkerEntity (foundation)', () => {
  const definition: WorkerDefinition = {
    id: 'worker.test',
    displayName: 'Test Worker',
    baseCostCoins: 100,
    upgradeCostGrowth: 1.5,
    incomeMultiplierPerLevel: 0.1,
    maxLevel: 3,
  };

  const createState = (): WorkerState => ({
    id: 'worker-1',
    definitionId: definition.id,
    assignedBuildingId: null,
    hiredAt: 0,
    level: 1,
  });

  it('is neutral while unassigned and productive once assigned', () => {
    const worker = new WorkerEntity(createState(), definition);
    expect(worker.isActive).toBe(false);
    expect(worker.incomeMultiplier).toBe(1);

    worker.assignTo('building.test-shop');
    expect(worker.isActive).toBe(true);
    expect(worker.incomeMultiplier).toBeCloseTo(1.1, 5);
  });

  it('levels up to the definition cap only', () => {
    const worker = new WorkerEntity(createState(), definition);
    expect(worker.levelUp()).toBe(true);
    expect(worker.levelUp()).toBe(true);
    expect(worker.levelUp()).toBe(false);
    expect(worker.state.level).toBe(3);
  });

  it('respects allowed building types', () => {
    const worker = new WorkerEntity(createState(), { ...definition, allowedBuildingTypes: ['cafe'] });
    expect(worker.canWorkIn('shop')).toBe(false);
    expect(worker.canWorkIn('cafe')).toBe(true);
  });
});

describe('CustomerEntity (foundation)', () => {
  it('walks through the visit lifecycle with timestamps', () => {
    const customer = new CustomerEntity('customer-1', TEST_BUILDING.id, 5_000);

    expect(customer.spawn(1_000)).toBe(true);
    expect(customer.phase).toBe('arriving');
    expect(customer.spawn(1_100)).toBe(false); // cannot spawn twice

    expect(customer.arrive(2_000)).toBe(true);
    expect(customer.serve(3_000)).toBe(true);
    expect(customer.pay(3_500)).toBe(true);
    customer.complete();

    expect(customer.isFinished).toBe(true);
    expect(customer.visitDurationMs).toBe(2_500);
    expect(customer.pay(4_000)).toBe(false); // no double payment
  });

  it('gives up when patience runs out', () => {
    const customer = new CustomerEntity('customer-2', TEST_BUILDING.id, 1_000);
    customer.spawn(0);
    customer.arrive(100);

    expect(customer.hasGivenUp(2_000)).toBe(true);
    expect(customer.serve(2_000)).toBe(false);
    expect(customer.phase).toBe('leaving');
    expect(customer.visitDurationMs).toBe(2_000);
  });
});
