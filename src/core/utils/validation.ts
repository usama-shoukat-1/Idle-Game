/**
 * Small validation primitives.
 *
 * Validators never throw: they collect issues so a corrupted save can be
 * repaired into a playable state instead of hard-failing the boot.
 */

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'warning' | 'error';
  /** Value that was found (already stringified for logging). */
  found?: string;
}

export interface ValidationResult<T> {
  value: T;
  issues: ValidationIssue[];
  ok: boolean;
}

export function issue(
  path: string,
  message: string,
  severity: ValidationIssue['severity'] = 'warning',
  found?: unknown,
): ValidationIssue {
  return {
    path,
    message,
    severity,
    found: found === undefined ? undefined : safeStringify(found),
  };
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Pick a valid member of a string union, otherwise the fallback. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export function asRecord<T>(value: unknown): Record<string, T> | null {
  return isRecord(value) ? (value as Record<string, T>) : null;
}

export function collectIssueMessages(issues: readonly ValidationIssue[]): string[] {
  return issues.map((entry) => `${entry.path}: ${entry.message}`);
}
