/**
 * Small deterministic PRNG (mulberry32).
 *
 * Determinism matters for idle games: reproducible content rolls, seeded debug
 * scenarios and stable tests. Never use `Math.random()` in gameplay systems - use
 * a seeded `Rng`, expose the seed, and persist the seed/step count in the save file
 * when a system's rolls affect player state.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Normalise to uint32 so any numeric seed is valid.
    this.state = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Deterministic pick from a non-empty list. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Rng.pick called with an empty list');
    }
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Current internal state, so a caller can snapshot/resume the stream. */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}

/** Convenience factory so call sites read clearly: `createRng(Date.now())`. */
export function createRng(seed: number): Rng {
  return new Rng(seed);
}
