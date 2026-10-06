/**
 * Phaser-backed audio provider.
 *
 * Uses Phaser's sound manager for WebAudio handling/unlock, but keeps every
 * gameplay-facing call behind `AudioProvider`. Phase 0 registers no sound files,
 * so unsupported keys are ignored rather than throwing.
 */

import Phaser from 'phaser';
import type { AudioBus, AudioProvider, SoundDefinition } from './AudioManager';
import { createLogger } from '@/core/utils/logger';

export class PhaserAudioProvider implements AudioProvider {
  readonly name = 'phaser';
  private readonly log = createLogger('audio:phaser');
  private readonly playing = new Map<string, Phaser.Sound.BaseSound>();
  private game: Phaser.Game | null = null;

  attach(game: Phaser.Game): void {
    this.game = game;
  }

  private get sound(): Phaser.Sound.BaseSoundManager | null {
    if (!this.game) return null;
    return this.game.sound ?? null;
  }

  isReady(): boolean {
    return this.sound !== null;
  }

  async unlock(): Promise<void> {
    const sound = this.sound;
    if (!sound) return;
    try {
      // `unlock` is typed as protected on the base manager but is public on the
      // WebAudio implementation, so we call it structurally.
      const unlockable = sound as unknown as { unlock?: () => void | Promise<void> };
      await Promise.resolve(unlockable.unlock?.());
    } catch (error) {
      this.log.warn('phaser sound unlock failed', error);
    }
  }

  play(key: string, definition: SoundDefinition, volume: number): void {
    const sound = this.sound;
    if (!sound || !definition.url) {
      this.log.debug(`"${key}" has no asset url yet - skipping playback`);
      return;
    }

    // Assets are loaded by the PreloadScene from the asset manifest; if the key is
    // missing at runtime we degrade gracefully instead of crashing gameplay.
    if (!sound.game.cache.audio.exists(key)) {
      this.log.debug(`audio key "${key}" is not in the cache yet`);
      return;
    }

    const instance = sound.add(key, {
      volume,
      loop: Boolean(definition.loop),
    });
    if (definition.loop) this.playing.set(key, instance);
  }

  stop(key: string, fadeMs: number): void {
    const sound = this.sound;
    if (!sound) return;
    const instance = this.playing.get(key);
    if (instance) {
      this.playing.delete(key);
      if (fadeMs > 0) instance.stop();
      return;
    }
    if (sound.game.cache.audio.exists(key)) sound.stopByKey(key);
  }

  setBusVolume(bus: AudioBus, volume: number): void {
    const sound = this.sound;
    if (!sound) return;
    if (bus === 'master') sound.volume = volume;
    // Per-bus gains are applied when an instance is created; Phaser only exposes a
    // global volume plus per-sound volume, which is enough for Phase 0.
  }

  dispose(): void {
    for (const key of [...this.playing.keys()]) this.stop(key, 0);
    this.game = null;
  }
}
