/**
 * Runtime configuration: platform detection, storage target and debug switches.
 *
 * This is deliberately separate from *content* configuration (balance, buildings)
 * which lives in `src/config/**` and `src/data/**`.
 */

import { AUTOSAVE_INTERVAL_MS, DEFAULT_APP_VERSION, STORAGE_KEYS, TIMER_PROGRESS_INTERVAL_MS } from './constants';
import type { LogLevel } from './utils/logger';

export interface PlatformConfig {
  isMobile: boolean;
  isTouch: boolean;
  isProduction: boolean;
  userAgent: string;
  /** `window.devicePixelRatio`, clamped for mobile fill-rate sanity. */
  devicePixelRatio: number;
}

export interface StorageConfig {
  key: string;
  adapter: 'local' | 'memory';
  /** Development convenience: wipe the save on boot. */
  clearOnBoot: boolean;
}

export interface DebugConfig {
  enabled: boolean;
  cheatsEnabled: boolean;
  showOverlay: boolean;
  logLevel: LogLevel;
}

export interface GameConfig {
  appVersion: string;
  platform: PlatformConfig;
  storage: StorageConfig;
  debug: DebugConfig;
  autosaveIntervalMs: number;
  timerProgressIntervalMs: number;
  /** Which economy balance definition to apply at boot. */
  balanceId: string;
}

export interface GameConfigOverrides {
  appVersion?: string;
  storage?: Partial<StorageConfig>;
  debug?: Partial<DebugConfig>;
  autosaveIntervalMs?: number;
  timerProgressIntervalMs?: number;
  balanceId?: string;
  platform?: Partial<PlatformConfig>;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini/i;

export function detectPlatform(): PlatformConfig {
  const isProduction = Boolean(import.meta.env?.PROD);

  // Headless (unit tests, tooling, SSR-ish shells): assume desktop, no touch.
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isMobile: false,
      isTouch: false,
      isProduction,
      userAgent: 'headless',
      devicePixelRatio: 1,
    };
  }

  const userAgent = navigator.userAgent ?? '';
  const coarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

  return {
    isMobile: MOBILE_UA.test(userAgent) || coarsePointer,
    isTouch: coarsePointer || 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0,
    isProduction,
    userAgent,
    // Clamp DPR: a 3x canvas on a phone is a fill-rate trap for a 2D game.
    devicePixelRatio: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
  };
}

/** `?debug=1` (or `?debug=0`) overrides the default debug switch. */
export function readDebugFlag(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('debug');
    if (value === null) return null;
    return value !== '0' && value !== 'false';
  } catch {
    return null;
  }
}

export function createGameConfig(overrides: GameConfigOverrides = {}): GameConfig {
  const platform = { ...detectPlatform(), ...overrides.platform };
  const debugFlag = readDebugFlag();
  const debugEnabled = debugFlag ?? Boolean(import.meta.env?.DEV);

  return {
    appVersion: overrides.appVersion ?? DEFAULT_APP_VERSION,
    platform,
    storage: {
      key: STORAGE_KEYS.save,
      // localStorage is unavailable in some embedded/incognito contexts; the
      // SaveSystem falls back to memory when the adapter reports unavailable.
      adapter: 'local',
      clearOnBoot: false,
      ...overrides.storage,
    },
    debug: {
      enabled: debugEnabled,
      cheatsEnabled: debugEnabled,
      showOverlay: debugEnabled,
      logLevel: debugEnabled ? 'debug' : platform.isProduction ? 'warn' : 'info',
      ...overrides.debug,
    },
    autosaveIntervalMs: overrides.autosaveIntervalMs ?? AUTOSAVE_INTERVAL_MS,
    timerProgressIntervalMs: overrides.timerProgressIntervalMs ?? TIMER_PROGRESS_INTERVAL_MS,
    balanceId: overrides.balanceId ?? 'default',
  };
}
