import { describe, expect, it } from 'vitest';

import { createPhase1Environment, enterGame, restoreUpTo, cafeUpgrade, type TestEnvironment } from './helpers/TestEnvironment';

/**
 * PHASE 1 - ONBOARDING
 * ====================
 * The tutorial is content, so it is tested as content: the step order, the fact that each
 * step advances on the player *doing* the thing (domain events, never scene code), that
 * nothing about it can block the game, and that skipping is remembered.
 */

function stepId(env: TestEnvironment): string | null {
  return env.systems.tutorial.currentStep?.id ?? null;
}

describe('Phase 1 - Old Café tutorial', () => {
  it('ships seven ordered steps covering the core loop', () => {
    const env = createPhase1Environment();
    const steps = env.systems.content.getTutorialSteps();

    expect(steps).toHaveLength(7);
    expect(steps.map((step) => step.id)).toEqual([
      'tutorial.old_cafe.intro',
      'tutorial.old_cafe.first_restore',
      'tutorial.old_cafe.second_restore',
      'tutorial.old_cafe.income_started',
      'tutorial.old_cafe.next_upgrade',
      'tutorial.old_cafe.timers',
      'tutorial.old_cafe.speedup',
    ]);
    // Every step is text; none of them are gameplay.
    for (const step of steps) {
      expect(step.message.length).toBeGreaterThan(0);
      expect(step.detail && step.detail.length).toBeGreaterThan(0);
    }
    env.dispose();
  });

  it('starts on the first step and advances when the player restores', () => {
    const env = createPhase1Environment();
    enterGame(env);
    expect(stepId(env)).toBe('tutorial.old_cafe.intro');

    // The intro is explanatory: it needs an explicit "GOT IT", not an event.
    env.systems.tutorial.acknowledge();
    expect(stepId(env)).toBe('tutorial.old_cafe.first_restore');

    // Restoring to tier 1 advances the first_restore step by itself.
    restoreUpTo(env, 1);
    expect(stepId(env)).toBe('tutorial.old_cafe.second_restore');

    // Tier 2 starts the income and moves the tutorial on.
    restoreUpTo(env, 2);
    expect(stepId(env)).toBe('tutorial.old_cafe.income_started');
    env.systems.tutorial.acknowledge();
    expect(stepId(env)).toBe('tutorial.old_cafe.next_upgrade');

    // Starting any upgrade advances the "next restoration" step.
    env.systems.upgrades.start(cafeUpgrade(3));
    expect(stepId(env)).toBe('tutorial.old_cafe.timers');

    // The last two steps are explanatory and complete the tutorial.
    env.systems.tutorial.acknowledge();
    expect(stepId(env)).toBe('tutorial.old_cafe.speedup');
    env.systems.tutorial.acknowledge();
    expect(stepId(env)).toBeNull();
    expect(env.systems.tutorial.isCompleted).toBe(true);

    env.dispose();
  });

  it('never blocks play: the player can skip at any point', () => {
    const env = createPhase1Environment();
    enterGame(env);

    env.systems.tutorial.skip();
    expect(env.systems.tutorial.isCompleted).toBe(true);
    expect(env.systems.tutorial.currentStep).toBeNull();

    // Gameplay continues normally with the tutorial off.
    expect(env.systems.upgrades.start(cafeUpgrade(1)).ok).toBe(true);
    expect(env.systems.buildings.getTier(env.systems.content.getBuilding('building_old_cafe' as never).id)).toBe(1);

    env.dispose();
  });

  it('remembers a skipped tutorial across a reload', () => {
    const env = createPhase1Environment();
    enterGame(env);
    env.systems.tutorial.skip();
    env.systems.save.save('test.tutorial-skip');
    env.dispose();

    const reopened = createPhase1Environment({ storage: env.storage, now: env.clock.now() + 1_000 });
    expect(reopened.systems.tutorial.isCompleted).toBe(true);
    expect(reopened.state.tutorial.skips).toBe(1);
    reopened.dispose();
  });

  it('does not advance on unrelated events', () => {
    const env = createPhase1Environment();
    enterGame(env);
    env.systems.tutorial.acknowledge(); // -> first_restore

    // An economy event or an income tick is not the trigger for this step.
    env.systems.economy.addCoins(10, 'test.noise');
    env.clock.advance(60_000);
    env.systems.buildings.accrueIncome('building_old_cafe' as never, { reason: 'test' });

    expect(stepId(env)).toBe('tutorial.old_cafe.first_restore');
    env.dispose();
  });
});
