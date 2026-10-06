/**
 * Audio manager.
 *
 * Bus-based volume control (master / music / sfx) with mute, kept in game state
 * settings so it persists. The actual playback is delegated to an `AudioProvider`,
 * which lets the manager run headless in tests and lets Phaser own the WebAudio
 * context in the browser. No audio assets ship in Phase 0 - unknown keys no-op.
 */

import type { SettingsState } from '@/core/types/gameState';
import { createLogger } from '@/core/utils/logger';
import { clamp01 } from '@/core/utils/numbers';
import type { GameEventBus } from '@/systems/EventSystem';

export type AudioBus = 'master' | 'music' | 'sfx';

export interface SoundDefinition {
  key: string;
  bus: Exclude<AudioBus, 'master'>;
  /** No url yet: Phase 0 ships placeholder/no-op audio. */
  url?: string;
  volume?: number;
  loop?: boolean;
}

export interface AudioProvider {
  readonly name: string;
  isReady(): boolean;
  /** Browsers require a user gesture before audio can play. */
  unlock(): Promise<void>;
  play(key: string, definition: SoundDefinition, volume: number): void;
  stop(key: string, fadeMs: number): void;
  setBusVolume(bus: AudioBus, volume: number): void;
  dispose(): void;
}

/** Provider used before Phaser exists and in headless tests. */
export class NullAudioProvider implements AudioProvider {
  readonly name = 'null';
  private readonly log = createLogger('audio:null');

  isReady(): boolean {
    return true;
  }

  async unlock(): Promise<void> {
    /* no-op */
  }

  play(key: string, definition: SoundDefinition): void {
    this.log.debug(`no-op play "${key}" (${definition.bus})`);
  }

  stop(key: string): void {
    this.log.debug(`no-op stop "${key}"`);
  }

  setBusVolume(): void {
    /* no-op */
  }

  dispose(): void {
    /* no-op */
  }
}

export interface AudioManagerDeps {
  events: GameEventBus;
  provider?: AudioProvider;
  /** Sound registry; empty in Phase 0. */
  definitions?: SoundDefinition[];
}

export class AudioManager {
  private readonly log = createLogger('audio');
  private readonly definitions = new Map<string, SoundDefinition>();
  private provider: AudioProvider;
  private settings: SettingsState;
  private unlocked = false;
  private currentMusicKey: string | null = null;

  constructor(
    settings: SettingsState,
    private readonly deps: AudioManagerDeps,
  ) {
    this.settings = { ...settings };
    this.provider = deps.provider ?? new NullAudioProvider();
    for (const definition of deps.definitions ?? []) this.registerSound(definition);
  }

  /* ------------------------------------------------------------- registry */

  registerSound(definition: SoundDefinition): void {
    this.definitions.set(definition.key, definition);
  }

  unregisterSound(key: string): void {
    this.definitions.delete(key);
  }

  /* --------------------------------------------------------------- state */

  getSettings(): SettingsState {
    return { ...this.settings };
  }

  /** Called whenever settings change anywhere in the app. */
  applySettings(settings: SettingsState, emitEvent = false): void {
    this.settings = { ...settings };
    this.provider.setBusVolume('master', this.effectiveVolume('master'));
    this.provider.setBusVolume('music', this.effectiveVolume('music'));
    this.provider.setBusVolume('sfx', this.effectiveVolume('sfx'));
    if (emitEvent) this.deps.events.emit('audio:changed', { settings: this.getSettings() });
  }

  setVolume(bus: AudioBus, value: number, onSettings: (settings: SettingsState) => void): SettingsState {
    const next = { ...this.settings };
    const clamped = clamp01(value);
    if (bus === 'master') next.masterVolume = clamped;
    else if (bus === 'music') next.musicVolume = clamped;
    else next.sfxVolume = clamped;
    this.applySettings(next);
    onSettings(next);
    this.deps.events.emit('audio:changed', { settings: this.getSettings() });
    return next;
  }

  setMuted(muted: boolean, onSettings: (settings: SettingsState) => void): SettingsState {
    const next = { ...this.settings, muted };
    this.applySettings(next);
    onSettings(next);
    this.deps.events.emit('audio:changed', { settings: this.getSettings() });
    return next;
  }

  get mute(): boolean {
    return this.settings.muted;
  }

  /* ------------------------------------------------------------ playback */

  /**
   * Browsers block audio until a user gesture. Call this from the first tap/click;
   * it is idempotent and never throws.
   */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    try {
      await this.provider.unlock();
      this.unlocked = true;
      this.log.debug('audio unlocked');
    } catch (error) {
      this.log.warn('audio unlock failed', error);
    }
  }

  playMusic(key: string): void {
    if (this.currentMusicKey === key) return;
    if (this.currentMusicKey) this.provider.stop(this.currentMusicKey, 400);
    const definition = this.definitions.get(key);
    if (!definition || definition.bus !== 'music') {
      this.log.debug(`music "${key}" is not registered yet (Phase 0 placeholder)`);
      this.currentMusicKey = null;
      return;
    }
    this.currentMusicKey = key;
    this.provider.play(key, definition, this.effectiveVolume('music'));
  }

  stopMusic(fadeMs = 400): void {
    if (!this.currentMusicKey) return;
    this.provider.stop(this.currentMusicKey, fadeMs);
    this.currentMusicKey = null;
  }

  playSfx(key: string): void {
    const definition = this.definitions.get(key);
    if (!definition || definition.bus !== 'sfx') {
      this.log.debug(`sfx "${key}" is not registered yet (Phase 0 placeholder)`);
      return;
    }
    if (this.settings.muted) return;
    this.provider.play(key, definition, this.effectiveVolume('sfx') * (definition.volume ?? 1));
  }

  /** Swap providers at runtime (e.g. once Phaser is ready). */
  setProvider(provider: AudioProvider): void {
    this.provider.dispose();
    this.provider = provider;
    this.applySettings(this.settings);
  }

  get providerName(): string {
    return this.provider.name;
  }

  dispose(): void {
    this.provider.dispose();
  }

  private effectiveVolume(bus: AudioBus): number {
    if (this.settings.muted) return 0;
    const master = clamp01(this.settings.masterVolume);
    if (bus === 'master') return master;
    if (bus === 'music') return master * clamp01(this.settings.musicVolume);
    return master * clamp01(this.settings.sfxVolume);
  }
}
