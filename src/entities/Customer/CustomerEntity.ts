/**
 * Customer entity (foundation only).
 *
 * Future business operations need visitors that walk to a building, spend time
 * (patience), pay and leave. Phase 0 ships the generic lifecycle *state machine* with
 * timestamps so it survives suspension, but no spawning, no art and no content.
 */

import type { BuildingId, CustomerId } from '@/core/types/ids';

export type CustomerPhase = 'idle' | 'arriving' | 'waiting' | 'being-served' | 'leaving' | 'done';

export interface CustomerTimeline {
  /** Wall-clock ms for each phase; `null` when the phase has not started. */
  spawnedAt: number | null;
  arrivedAt: number | null;
  servedAt: number | null;
  paidAt: number | null;
  leftAt: number | null;
}

export class CustomerEntity {
  phase: CustomerPhase = 'idle';
  readonly timeline: CustomerTimeline = {
    spawnedAt: null,
    arrivedAt: null,
    servedAt: null,
    paidAt: null,
    leftAt: null,
  };

  constructor(
    readonly id: CustomerId,
    readonly targetBuildingId: BuildingId,
    /** How long the customer will wait before giving up (tunable content value). */
    readonly patienceMs: number,
  ) {}

  /** Begin the visit; returns false when the customer is not idle. */
  spawn(at: number): boolean {
    if (this.phase !== 'idle') return false;
    this.timeline.spawnedAt = at;
    this.phase = 'arriving';
    return true;
  }

  arrive(at: number): boolean {
    if (this.phase !== 'arriving') return false;
    this.timeline.arrivedAt = at;
    this.phase = 'waiting';
    return true;
  }

  /** Serve the customer. Fails (and gives up) when patience has run out. */
  serve(at: number): boolean {
    if (this.phase !== 'waiting') return false;
    if (this.hasGivenUp(at)) {
      this.giveUp(at);
      return false;
    }
    this.timeline.servedAt = at;
    this.phase = 'being-served';
    return true;
  }

  /** Collect payment and send the customer on their way. */
  pay(at: number): boolean {
    if (this.phase !== 'being-served') return false;
    this.timeline.paidAt = at;
    this.timeline.leftAt = at;
    this.phase = 'leaving';
    return true;
  }

  complete(): void {
    if (this.phase === 'leaving') this.phase = 'done';
  }

  hasGivenUp(at: number): boolean {
    if (this.timeline.arrivedAt === null) return false;
    return at - this.timeline.arrivedAt > this.patienceMs;
  }

  giveUp(at: number): void {
    this.timeline.leftAt = at;
    this.phase = 'leaving';
  }

  get isFinished(): boolean {
    return this.phase === 'done';
  }

  /** Total visit duration, or null while the visit is still running. */
  get visitDurationMs(): number | null {
    if (this.timeline.spawnedAt === null || this.timeline.leftAt === null) return null;
    return Math.max(0, this.timeline.leftAt - this.timeline.spawnedAt);
  }
}
