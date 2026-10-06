/**
 * Save format contracts.
 *
 * The persisted payload is always a versioned envelope so old saves can be
 * detected and migrated instead of silently discarded.
 */

import type { GameState } from './gameState';

export const SAVE_SCHEMA_VERSION = 1;

export interface SaveEnvelope<TData = unknown> {
  /** Schema version of `data`. */
  schemaVersion: number;
  /** Wall clock ms the envelope was written. */
  savedAt: number;
  /** Game build version, for diagnostics only. */
  appVersion: string;
  data: TData;
}

export interface SaveInfo {
  schemaVersion: number;
  savedAt: number;
  appVersion: string;
}

export type SaveReason =
  | 'autosave'
  | 'manual'
  | 'scene-change'
  | 'visibility-hidden'
  | 'state-change'
  | 'debug'
  | 'shutdown';

export interface SaveResult {
  ok: boolean;
  info: SaveInfo | null;
  error?: string;
}

export interface LoadResult {
  ok: boolean;
  /** Present when a usable state was restored (fresh default or loaded save). */
  state: GameState | null;
  info: SaveInfo | null;
  /** Schema version the payload was migrated from, when a migration ran. */
  migratedFrom: number | null;
  /** Non-fatal problems found while validating (state was repaired). */
  issues: string[];
  error?: string;
}

export type SaveStatus =
  | { kind: 'no-save' }
  | { kind: 'ready'; info: SaveInfo };

/** Storage abstraction so localStorage can be swapped for something else later. */
export interface StorageAdapter {
  readonly name: string;
  isAvailable(): boolean;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}
