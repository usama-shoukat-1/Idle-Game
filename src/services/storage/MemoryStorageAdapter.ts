/**
 * In-memory storage adapter.
 *
 * Used by unit tests, by the SaveSystem fallback when localStorage is blocked
 * (embedded webviews, strict privacy modes) and by the debug tooling.
 */

import type { StorageAdapter } from '@/core/types/save';

export class MemoryStorageAdapter implements StorageAdapter {
  readonly name = 'memory';
  private readonly data = new Map<string, string>();

  isAvailable(): boolean {
    return true;
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  keys(): string[] {
    return [...this.data.keys()];
  }
}
