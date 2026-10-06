/**
 * Engine-wide constants. Values here are structural (keys, versions, budgets), never
 * game balance - balance lives in `src/config/balance`.
 */

/**
 * Current save schema version. Bump on any breaking change to the persisted shape.
 * 1 -> 2 (Phase 1): added `boosts.active` and the pending offline reward (`offline`).
 */
export const SAVE_SCHEMA_VERSION = 2;

/** localStorage namespace. All keys written by the game start with this prefix. */
export const STORAGE_NAMESPACE = 'restore-it';

/** Persisted keys (relative to the namespace). */
export const STORAGE_KEYS = {
  /** Storage slot name. Stable across schema versions: the version lives in the blob. */
  save: 'save.v1',
  settings: 'settings.v1',
  /** Written before risky operations so a corrupt primary save can be recovered. */
  backup: 'save.backup',
  debugFlags: 'debug.flags',
} as const;

/** How often the game persists while running (ms). Offline accuracy depends on this. */
export const AUTOSAVE_INTERVAL_MS = 20_000;

/** Save whenever the tab is hidden / the app is backgrounded, regardless of the timer. */
export const SAVE_ON_HIDDEN = true;

/** Target frame rate. 60 is standard; mobile devices may throttle to 30 automatically. */
export const TARGET_FPS = 60;

/** Hard limit on the transaction journal kept in memory + save. */
export const MAX_TRANSACTION_LOG = 200;

/** Max events processed per frame by the queued event dispatcher, to bound frame cost. */
export const MAX_QUEUED_EVENTS_PER_FRAME = 32;

/** Scene keys, so no scene ever references another by a magic string. */
export const SCENE_KEYS = {
  boot: 'BootScene',
  preload: 'PreloadScene',
  loading: 'LoadingScene',
  mainMenu: 'MainMenuScene',
  game: 'GameScene',
} as const;

export type SceneKey = (typeof SCENE_KEYS)[keyof typeof SCENE_KEYS];

/** Registry keys used to pass data between scenes (never for gameplay state). */
export const REGISTRY_KEYS = {
  gameReady: 'game.ready',
  offlineSummary: 'game.offlineSummary',
} as const;

/** UI depth bands. Keeps z-ordering declarative instead of scattered constants. */
export const UI_DEPTH = {
  world: 0,
  worldOverlay: 100,
  panels: 1_000,
  popups: 2_000,
  toasts: 3_000,
  debug: 4_000,
} as const;
