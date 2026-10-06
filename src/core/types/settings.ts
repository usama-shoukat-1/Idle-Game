import type { CurrencyId } from './primitives';

/** Player-facing settings. Persisted, so changes require a save migration. */
export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

export interface DisplaySettings {
  /** Requested quality tier - the renderer clamps this against device capability. */
  quality: 'auto' | 'low' | 'medium' | 'high';
  /** Preferred UI language tag (content localisation comes later). */
  locale: string;
  /** Shake/hop animations and other motion flourishes. */
  reducedMotion: boolean;
}

export interface GameplaySettings {
  /** Show floating "+coins" numbers over buildings. */
  showIncomePopups: boolean;
  /** Haptics where the platform supports it. */
  haptics: boolean;
}

export interface SettingsState {
  audio: AudioSettings;
  display: DisplaySettings;
  gameplay: GameplaySettings;
  /** Player opted in to (optional) notifications reminders - never enabled by default. */
  notificationsOptIn: boolean;
}

/** Tutorial/onboarding progress. Kept generic: step ids come from content, not code. */
export interface TutorialState {
  completed: boolean;
  /** Id of the current step, or null when idle/finished. */
  currentStepId: string | null;
  /** Ids of steps already finished, in order. */
  completedStepIds: string[];
  /** Times the player skipped a hint (used later for pacing, not for gating). */
  skips: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
  muted: false,
};

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  quality: 'auto',
  locale: 'en',
  reducedMotion: false,
};

export const DEFAULT_GAMEPLAY_SETTINGS: GameplaySettings = {
  showIncomePopups: true,
  haptics: true,
};

export const DEFAULT_SETTINGS: SettingsState = {
  audio: { ...DEFAULT_AUDIO_SETTINGS },
  display: { ...DEFAULT_DISPLAY_SETTINGS },
  gameplay: { ...DEFAULT_GAMEPLAY_SETTINGS },
  notificationsOptIn: false,
};

export const DEFAULT_TUTORIAL: TutorialState = {
  completed: false,
  currentStepId: null,
  completedStepIds: [],
  skips: 0,
};

/** Cost of a transaction in a specific currency. Used by upgrades, purchases, unlocks. */
export interface Cost {
  readonly currency: CurrencyId;
  readonly amount: number;
}
