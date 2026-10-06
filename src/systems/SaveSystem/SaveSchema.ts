/**
 * Envelope parsing helpers.
 *
 * The payload is always `{ schemaVersion, savedAt, appVersion, data }`. Bare
 * payloads (no envelope) are treated as schema version 0 so the migration chain
 * gets a chance to upgrade them.
 */

import type { SaveEnvelope, SaveInfo } from '@/core/types/save';
import { SAVE_SCHEMA_VERSION } from '@/core/types/save';
import { isRecord, safeStringify } from '@/core/utils/validation';
import { isValidTimestamp } from '@/core/utils/time';

export interface ParsedEnvelope {
  schemaVersion: number;
  savedAt: number;
  appVersion: string;
  data: unknown;
}

export function createSaveEnvelope<TData>(
  data: TData,
  savedAt: number,
  appVersion: string,
  schemaVersion = SAVE_SCHEMA_VERSION,
): SaveEnvelope<TData> {
  return { schemaVersion, savedAt, appVersion, data };
}

/**
 * Parse a serialized save. Returns `null` when the text is not JSON at all, and
 * wraps bare payloads as schema version 0.
 */
export function parseSaveEnvelope(text: string): ParsedEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return normalizeEnvelope(parsed);
}

export function normalizeEnvelope(parsed: unknown): ParsedEnvelope | null {
  if (!isRecord(parsed)) return null;

  const hasEnvelope = 'schemaVersion' in parsed && 'data' in parsed;
  const schemaVersion = hasEnvelope ? toVersion(parsed.schemaVersion) : 0;

  return {
    schemaVersion,
    savedAt: isValidTimestamp(parsed.savedAt) ? parsed.savedAt : 0,
    appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : 'unknown',
    data: hasEnvelope ? parsed.data : parsed,
  };
}

function toVersion(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.trunc(value);
  return 0;
}

export function toSaveInfo(envelope: ParsedEnvelope): SaveInfo {
  return {
    schemaVersion: envelope.schemaVersion,
    savedAt: envelope.savedAt,
    appVersion: envelope.appVersion,
  };
}

export function stringifyEnvelope(envelope: SaveEnvelope<unknown>): string {
  try {
    return JSON.stringify(envelope);
  } catch (error) {
    throw new Error(`save payload is not serializable: ${safeStringify(error)}`);
  }
}
