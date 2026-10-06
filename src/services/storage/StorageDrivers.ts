import { STORAGE_NAMESPACE } from '@/core/constants/GameConstants';
import type { StorageDriver } from '@/core/types/services';

/**
 * Storage backends.
 *
 * `SaveSystem` only ever talks to a `StorageDriver`, so swapping localStorage for
 * IndexedDB, a native bridge or a cloud save later is a one-line change in main.ts -
 * no gameplay or save-format code moves.
 */

/** Browser localStorage. Falls back gracefully when unavailable (private mode, Node). */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'localStorage';

  constructor(private readonly storage: Storage | null = safeLocalStorage()) {}

  isAvailable(): boolean {
    if (!this.storage) return false;
    try {
      const probe = `${STORAGE_NAMESPACE}.probe`;
      this.storage.setItem(probe, '1');
      this.storage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  read(key: string): string | null {
    if (!this.storage) return null;
    try {
      return this.storage.getItem(this.namespaced(key));
    } catch {
      return null;
    }
  }

  write(key: string, value: string): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.namespaced(key), value);
      return true;
    } catch {
      // QuotaExceededError or storage disabled mid-session: reported, never thrown.
      return false;
    }
  }

  remove(key: string): void {
    try {
      this.storage?.removeItem(this.namespaced(key));
    } catch {
      /* ignore */
    }
  }

  keys(): string[] {
    if (!this.storage) return [];
    const result: string[] = [];
    for (let i = 0; i < this.storage.length; i += 1) {
      const key = this.storage.key(i);
      if (key && key.startsWith(`${STORAGE_NAMESPACE}.`)) {
        result.push(key.slice(STORAGE_NAMESPACE.length + 1));
      }
    }
    return result;
  }

  private namespaced(key: string): string {
    return `${STORAGE_NAMESPACE}.${key}`;
  }
}

/** In-memory driver: tests, SSR and "storage blocked" fallback. */
export class MemoryStorageDriver implements StorageDriver {
  readonly name = 'memory';
  private readonly map = new Map<string, string>();

  isAvailable(): boolean {
    return true;
  }

  read(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  write(key: string, value: string): boolean {
    this.map.set(key, value);
    return true;
  }

  remove(key: string): void {
    this.map.delete(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

/**
 * Chooses the best available driver. Callers never branch on environment themselves.
 */
export function createDefaultStorageDriver(): StorageDriver {
  const local = new LocalStorageDriver();
  return local.isAvailable() ? local : new MemoryStorageDriver();
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    // Accessing localStorage throws in some sandboxed/blocked-cookie contexts.
    return null;
  }
}
