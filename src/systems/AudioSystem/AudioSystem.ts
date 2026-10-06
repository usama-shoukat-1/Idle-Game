import { DisposableBag } from '@/core/Disposable';
import { logger } from '@/core/Logger';
import type { EventBus } from '@/core/events/EventBus';
import type { GameState } from '@/core/types/state';
import { clamp } from '@/core/utils/NumberUtils';

/**
 * AUDIO ARCHITECTURE
 * ==================
 * The game talks to `AudioSystem`, never to Phaser's sound manager or an <audio> tag.
 * Phase 0 registers no audio assets: `NoopAudioBackend` keeps every call legal and
 * silent, so gameplay code, tests and QA flows are identical before and after real
 * sound lands.
 *
 * Volume model (applied per-play, computed once):
 *   effective = master * channel * mute
 * Changing a setting updates state + emits `audio:settings-changed`, and the backend is
 * never asked to play anything at volume 0.
 */

export type AudioChannel = 'music' | 'sfx';

export interface AudioBackend {
  readonly name: string;
  /** Unlock the audio context on the first user gesture (mobile browsers require it). */
  unlock(): void;
  playMusic(key: string, volume: number, loop: boolean): void;
  stopMusic(): void;
  playSfx(key: string, volume: number): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

/** Silent backend used until real assets exist and by tests. */
export class NoopAudioBackend implements AudioBackend {
  readonly name = 'noop';
  private unlocked = false;

  unlock(): void {
    this.unlocked = true;
  }

  playMusic(key: string, _volume: number, _loop: boolean): void {
    if (!this.unlocked) return;
    logger.debug('audio', `(silent) music "${key}"`);
  }

  stopMusic(): void {
    /* no-op */
  }

  playSfx(key: string, _volume: number): void {
    if (!this.unlocked) return;
    logger.debug('audio', `(silent) sfx "${key}"`);
  }

  setMuted(_muted: boolean): void {
    /* no-op */
  }

  dispose(): void {
    /* no-op */
  }
}

export class AudioSystem {
  private readonly bag = new DisposableBag();
  private currentMusicKey: string | null = null;
  private unlocked = false;

  constructor(
    private readonly state: GameState,
    private readonly events: EventBus,
    private readonly backend: AudioBackend = new NoopAudioBackend(),
  ) {
    this.bag.add(
      this.events.on('audio:play', ({ key, volume }) => {
        this.playSfx(key, volume);
      }),
    );
  }

  get settings(): GameState['settings']['audio'] {
    return this.state.settings.audio;
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  get backendName(): string {
    return this.backend.name;
  }

  /** Call from the first user gesture; safe to call repeatedly. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.backend.unlock();
    logger.debug('audio', 'audio unlocked by user gesture');
  }

  setMasterVolume(value: number, reason = 'settings'): void {
    this.settings.master = clamp(value, 0, 1);
    this.announce(reason);
  }

  setMusicVolume(value: number, reason = 'settings'): void {
    this.settings.music = clamp(value, 0, 1);
    this.announce(reason);
  }

  setSfxVolume(value: number, reason = 'settings'): void {
    this.settings.sfx = clamp(value, 0, 1);
    this.announce(reason);
  }

  setMuted(muted: boolean, reason = 'settings'): void {
    this.settings.muted = muted;
    this.backend.setMuted(muted);
    this.announce(reason);
  }

  toggleMute(): boolean {
    this.setMuted(!this.settings.muted, 'toggle');
    return this.settings.muted;
  }

  getEffectiveVolume(channel: AudioChannel): number {
    if (this.settings.muted || !this.unlocked) return 0;
    const channelVolume = channel === 'music' ? this.settings.music : this.settings.sfx;
    return clamp(this.settings.master * channelVolume, 0, 1);
  }

  playMusic(key: string, loop = true): void {
    const volume = this.getEffectiveVolume('music');
    this.currentMusicKey = key;
    if (volume <= 0) return;
    this.backend.playMusic(key, volume, loop);
  }

  stopMusic(): void {
    this.currentMusicKey = null;
    this.backend.stopMusic();
  }

  /** Re-applies volume to whatever is currently playing (after a settings change). */
  refreshMusic(): void {
    if (!this.currentMusicKey) return;
    const volume = this.getEffectiveVolume('music');
    if (volume <= 0) {
      this.backend.stopMusic();
      return;
    }
    this.backend.playMusic(this.currentMusicKey, volume, true);
  }

  playSfx(key: string, volumeOverride?: number): void {
    const volume = clamp(volumeOverride ?? this.getEffectiveVolume('sfx'), 0, 1);
    if (volume <= 0) return;
    this.backend.playSfx(key, volume);
  }

  dispose(): void {
    this.backend.dispose();
    this.bag.dispose();
  }

  private announce(reason: string): void {
    this.events.emit('audio:settings-changed', {
      master: this.settings.master,
      music: this.settings.music,
      sfx: this.settings.sfx,
      muted: this.settings.muted,
    });
    this.refreshMusic();
    logger.debug('audio', 'audio settings updated', { reason });
  }
}
