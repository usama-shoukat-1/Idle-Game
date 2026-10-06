/**
 * Engine-wide constants. Content values (income, costs, durations) do NOT belong
 * here - those live in `src/config/**` and `src/data/**`.
 */

export const GAME_TITLE = 'RESTORE IT!';
export const GAME_VERSION = '0.1.0-phase0';

/** Scene keys - single source of truth so scenes never guess strings. */
export const SCENE_KEYS = {
  boot: 'BootScene',
  preload: 'PreloadScene',
  loading: 'LoadingScene',
  mainMenu: 'MainMenuScene',
  game: 'GameScene',
} as const;

export type SceneKey = (typeof SCENE_KEYS)[keyof typeof SCENE_KEYS];

/** Used until content registers a real first stage. */
export const DEFAULT_STAGE_ID = 'stage:unassigned';

export const STORAGE_KEYS = {
  save: 'restore-it:save:v1',
  settingsCache: 'restore-it:settings-cache',
  debug: 'restore-it:debug',
} as const;

/**
 * Design reference for a portrait phone. Layout code works in fractions of the
 * real viewport and uses this only to derive a readable UI scale - never as an
 * assumption about the actual screen size.
 */
export const DESIGN = {
  referenceWidth: 720,
  referenceHeight: 1560,
  referenceShortEdge: 720,
  minUiScale: 0.62,
  maxUiScale: 1.9,
  touchTargetMin: 48,
  padding: 16,
  radius: 14,
  /** Notch / home-indicator insets are read from CSS env() when available. */
  safeAreaFallback: { top: 0, right: 0, bottom: 0, left: 0 },
} as const;

export const UI_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** UI text depth bands, relative to the viewport short edge. */
export const FONT_SCALE = {
  xs: 0.021,
  sm: 0.025,
  md: 0.031,
  lg: 0.045,
  xl: 0.062,
  title: 0.105,
} as const;

export const AUTOSAVE_INTERVAL_MS = 20_000;
/** Throttle for timestamp-driven timer progress events (UI repaint budget). */
export const TIMER_PROGRESS_INTERVAL_MS = 250;
/** Player-facing countdown refresh. */
export const COUNTDOWN_REFRESH_MS = 500;

export const DEFAULT_APP_VERSION = GAME_VERSION;

/** Placement of the debug global attached in development builds. */
export const DEBUG_GLOBAL_KEY = '__RESTORE_IT__';
