/**
 * Assertions.
 *
 * `invariant` is for programming errors (contract violations) and always throws -
 * those should never be silently ignored, in dev or in release.
 * `devAssert` only runs development checks and is stripped from hot paths in release.
 */

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantError(message);
}

