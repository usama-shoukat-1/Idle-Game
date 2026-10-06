import { DisposableBag } from '@/core/Disposable';
import { logger } from '@/core/Logger';
import type { ContentRegistry } from '@/core/content/ContentRegistry';
import type { EventBus, GameEventName } from '@/core/events/EventBus';
import type { TutorialStepDefinition } from '@/core/types/content';
import type { GameState } from '@/core/types/state';

/**
 * LIGHTWEIGHT TUTORIAL SYSTEM
 * ===========================
 * Onboarding is *content*: an ordered list of steps, each with a short message and an
 * optional condition that advances it. Two advance styles are supported because that is
 * all a hint-style tutorial ever needs:
 *
 *   - event-driven: the step completes when the player actually performs the action
 *     (`upgrade:completed` for "restore the furniture");
 *   - acknowledged: the player taps "GOT IT" on an explanatory step.
 *
 * Design rules (from the Phase 1 brief):
 * - It never blocks: no modal trap, no forced input, the player can ignore or dismiss it.
 * - Progress is persisted (`state.tutorial`), so a reload resumes the same hint.
 * - It contains no building-specific logic: the step list comes from the content registry.
 */
export class TutorialSystem {
  private readonly bag = new DisposableBag();
  private readonly steps: readonly TutorialStepDefinition[];

  constructor(
    private readonly state: GameState,
    content: ContentRegistry,
    private readonly events: EventBus,
  ) {
    this.steps = content.getTutorialSteps();

    // Event-driven progression. We subscribe to every event the step list mentions so a
    // step can never be "listening" to the wrong channel (the content declares it).
    const watched = new Set(this.steps.map((step) => step.advanceOn).filter((name): name is string => Boolean(name)));
    for (const name of watched) {
      this.bag.add(
        this.events.on(name as GameEventName, (payload: unknown) => {
          this.handleEvent(name, payload);
        }),
      );
    }

    if (this.state.tutorial.completed) return;
    if (!this.currentStep) this.startSession();
  }

  get total(): number {
    return this.steps.length;
  }

  get isCompleted(): boolean {
    return this.state.tutorial.completed;
  }

  get currentStep(): TutorialStepDefinition | null {
    if (this.state.tutorial.completed) return null;
    const id = this.state.tutorial.currentStepId ?? this.steps[0]?.id ?? null;
    if (!id) return null;
    return this.steps.find((step) => step.id === id) ?? null;
  }

  get currentIndex(): number {
    const step = this.currentStep;
    if (!step) return this.steps.length;
    return this.steps.findIndex((entry) => entry.id === step.id);
  }

  /** Marks the tutorial as started (first step active). */
  startSession(): void {
    if (this.steps.length === 0) return;
    if (this.state.tutorial.completed) return;
    this.state.tutorial.currentStepId = this.steps[0]!.id;
    this.announce();
  }

  /** Advances to the next step; called by the UI's "GOT IT" affordance. */
  acknowledge(reason = 'acknowledged'): void {
    this.advance('', reason);
  }

  /** Ends the tutorial immediately (player chose "skip"), remembered in the save. */
  skip(): void {
    if (this.state.tutorial.completed) return;
    this.state.tutorial.completed = true;
    this.state.tutorial.currentStepId = null;
    this.state.tutorial.skips += 1;
    this.events.emit('tutorial:completed', { skipped: true });
    logger.info('tutorial', 'skipped by the player');
  }

  private handleEvent(name: string, payload: unknown): void {
    const step = this.currentStep;
    if (!step || step.advanceOn !== name) return;
    if (step.advanceWhen && !matchesFilter(step.advanceWhen, payload)) return;
    this.advance(name, 'event');
  }

  private advance(trigger: string, reason: string): void {
    const step = this.currentStep;
    if (!step) return;

    if (!this.state.tutorial.completedStepIds.includes(step.id)) {
      this.state.tutorial.completedStepIds.push(step.id);
    }

    const index = this.steps.findIndex((entry) => entry.id === step.id);
    const next = this.steps[index + 1] ?? null;

    if (!next) {
      this.state.tutorial.currentStepId = null;
      this.state.tutorial.completed = true;
      this.events.emit('tutorial:completed', { skipped: false });
      logger.info('tutorial', 'completed');
      return;
    }

    this.state.tutorial.currentStepId = next.id;
    this.announce();
    logger.debug('tutorial', `step "${step.id}" -> "${next.id}"`, { trigger, reason });
  }

  private announce(): void {
    const step = this.currentStep;
    if (!step) return;
    this.events.emit('tutorial:step', {
      stepId: step.id,
      index: this.currentIndex,
      total: this.steps.length,
    });
  }
}

function matchesFilter(
  filter: Readonly<Record<string, string | number>>,
  payload: unknown,
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  return Object.entries(filter).every(([key, expected]) => record[key] === expected);
}
