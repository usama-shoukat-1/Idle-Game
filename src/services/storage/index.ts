import type { GameConfig } from '@/core/GameConfig';
import type { StorageAdapter } from '@/core/types/save';
import { createLogger } from '@/core/utils/logger';
import { LocalStorageAdapter } from './LocalStorageAdapter';
import { MemoryStorageAdapter } from './MemoryStorageAdapter';

export { LocalStorageAdapter } from './LocalStorageAdapter';
export { MemoryStorageAdapter } from './MemoryStorageAdapter';

/**
 * Pick a storage backend. Falls back to memory when the requested backend is
 * unusable so the game always boots (progress just will not persist).
 */
export function createStorageAdapter(config: GameConfig): StorageAdapter {
  if (config.storage.adapter === 'memory') return new MemoryStorageAdapter();

  const adapter = new LocalStorageAdapter('restore-it');
  if (adapter.isAvailable()) return adapter;

  createLogger('storage').warn('falling back to in-memory saves for this session');
  return new MemoryStorageAdapter();
}
