/**
 * Small runtime validators.
 *
 * `GameState` is typed at compile time but arrives from localStorage at runtime,
 * where anything is possible (corrupted writes, other apps on the same origin,
 * older/newer schemas, hand-edited dev saves). The save layer validates with these
 * before the state is handed to systems.
 */

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}


export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}


export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class ValidationResult {
  private readonly issues: ValidationIssue[] = [];

  get isValid(): boolean {
    return this.issues.length === 0;
  }

  get all(): readonly ValidationIssue[] {
    return this.issues;
  }

  issue(path: string, message: string): this {
    this.issues.push({ path, message });
    return this;
  }

  /** Records an issue when `condition` is false. */
  expect(condition: boolean, path: string, message: string): this {
    if (!condition) this.issue(path, message);
    return this;
  }

  toString(): string {
    return this.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ') || 'ok';
  }
}
