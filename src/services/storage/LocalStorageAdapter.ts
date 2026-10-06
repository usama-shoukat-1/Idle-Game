/**
 * localStorage adapter.
 *
 * The SaveSystem only ever sees `StorageAdapter`, so swapping in IndexedDB or a
 * native bridge later is a one-file change.
 */

import type { StorageAdapter } from '@/core/types/save';
import { createLogger } from '@/core/utils/logger';

export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'localStorage';
  private readonly log = createLogger('storage:local');
  private available: boolean | null = null;

  constructor(private readonly namespace = 'restore-it') {}

  isAvailable(): boolean {
    if (this.available !== null) return this.available;
    try {
      const probeKey = `${this.namespace}:__probe__`;
      window.localStorage.setItem(probeKey, '1');
      window.localStorage.removeItem(probeKey);
      this.available = true;
    } catch (error) {
      this.log.warn('localStorage unavailable, callers should fall back to memory', error);
      this.available = false;
    }
    return this.available;
  }

  getItem(key: string): string | null {
    if (!this.isAvailable()) return null;
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      this.log.error(`read failed for "${key}"`, error);
      return null;
    }
  }

  setItem(key: string, value: string): void {
    if (!this.isAvailable()) return;
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Quota errors must not crash gameplay; the state stays dirty so the next
      // autosave retries.
      this.log.error(`write failed for "${key}"`, error);
      throw error;
    }
  }

  removeItem(key: string): void {
    if (!this.isAvailable()) return;
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      this.log.error(`delete failed for "${key}"`, error);
    }
  }

  keys(): string[] {
    if (!this.isAvailable()) return [];
    const result: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(this.namespace)) result.push(key);
    }
    return result;
  }
}
