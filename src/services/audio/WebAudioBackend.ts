import { logger } from '@/core/Logger';
import type { AudioBackend } from '@/systems/AudioSystem/AudioSystem';

/**
 * PROCEDURAL AUDIO BACKEND
 * ========================
 * Phase 1 ships no sound files: every cue is synthesised with a couple of oscillators and
 * an envelope. That keeps the repository free of binary assets, adds no dependency, and
 * still gives the game real audible feedback for every important interaction.
 *
 * Swapping in recorded audio later is a backend change (`AudioBackend`), not a gameplay
 * change - nothing outside this file knows how sound is produced.
 *
 * Mobile notes:
 * - `AudioContext` cannot start until a user gesture, hence `unlock()` (called by
 *   AudioSystem on the first tap).
 * - Nodes are created per cue and thrown away; with a handful of short cues per second
 *   that is cheaper and far easier to reason about than a persistent synth graph.
 */

interface ToneSpec {
  /** Starting frequency in Hz. */
  readonly from: number;
  /** Ending frequency in Hz (glide). Defaults to `from`. */
  readonly to?: number;
  readonly durationMs: number;
  readonly type: OscillatorType;
  readonly gain: number;
  /** Seconds of silence before the cue starts (used to sequence short arpeggios). */
  readonly delayMs?: number;
}

/**
 * Cue table - one entry per sound the game asks for. Tuned by ear for a warm, cosy
 * palette: soft sine/triangle bells for rewards, a dull thud for purchases.
 */
const CUES: Record<string, readonly ToneSpec[]> = {
  'sfx/tap': [{ from: 420, to: 520, durationMs: 70, type: 'triangle', gain: 0.18 }],
  'sfx/purchase': [
    { from: 220, to: 320, durationMs: 110, type: 'square', gain: 0.14 },
    { from: 330, to: 440, durationMs: 140, type: 'triangle', gain: 0.12, delayMs: 90 },
  ],
  'sfx/upgrade_start': [
    { from: 180, to: 260, durationMs: 220, type: 'sawtooth', gain: 0.1 },
    { from: 260, to: 390, durationMs: 260, type: 'triangle', gain: 0.1, delayMs: 160 },
  ],
  'sfx/upgrade_complete': [
    { from: 523, durationMs: 130, type: 'sine', gain: 0.2 },
    { from: 659, durationMs: 130, type: 'sine', gain: 0.2, delayMs: 110 },
    { from: 784, durationMs: 260, type: 'sine', gain: 0.22, delayMs: 220 },
  ],
  'sfx/coin': [{ from: 880, to: 1320, durationMs: 90, type: 'sine', gain: 0.12 }],
  'sfx/ad_reward': [
    { from: 440, durationMs: 120, type: 'triangle', gain: 0.18 },
    { from: 880, durationMs: 200, type: 'triangle', gain: 0.16, delayMs: 110 },
  ],
  'sfx/offline_reward': [
    { from: 392, durationMs: 160, type: 'sine', gain: 0.18 },
    { from: 523, durationMs: 160, type: 'sine', gain: 0.18, delayMs: 140 },
    { from: 659, durationMs: 320, type: 'sine', gain: 0.2, delayMs: 280 },
  ],
  'sfx/building_complete': [
    { from: 392, durationMs: 200, type: 'sine', gain: 0.2 },
    { from: 523, durationMs: 200, type: 'sine', gain: 0.2, delayMs: 180 },
    { from: 659, durationMs: 200, type: 'sine', gain: 0.2, delayMs: 360 },
    { from: 784, durationMs: 520, type: 'sine', gain: 0.24, delayMs: 540 },
  ],
  'sfx/error': [{ from: 200, to: 120, durationMs: 220, type: 'sawtooth', gain: 0.14 }],
};

export class WebAudioBackend implements AudioBackend {
  readonly name = 'webaudio-procedural';

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicOscillators: OscillatorNode[] = [];
  private muted = false;
  private failed = false;

  constructor(private readonly contextFactory?: () => AudioContext | null) {}

  /** Creates (or resumes) the AudioContext. Must be called from a user gesture. */
  unlock(): void {
    const context = this.ensureContext();
    if (!context) return;
    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }
  }

  playSfx(key: string, volume: number): void {
    const context = this.ensureContext();
    if (!context || this.muted) return;

    const cue = CUES[key];
    if (!cue) {
      // Unknown cue: silent by design, but visible so a typo shows up in QA logs.
      logger.debug('audio', `no cue registered for "${key}"`);
      return;
    }

    const start = context.currentTime;
    for (const tone of cue) {
      this.scheduleTone(context, tone, start + (tone.delayMs ?? 0) / 1000, volume);
    }
  }

  /** Placeholder "music": a very quiet two-note drone, looped while requested. */
  playMusic(_key: string, volume: number, _loop: boolean): void {
    const context = this.ensureContext();
    if (!context || this.muted) return;
    this.stopMusic();

    this.musicGain = context.createGain();
    this.musicGain.gain.value = volume * 0.06;
    this.musicGain.connect(this.master ?? context.destination);

    for (const frequency of [130.81, 196.0]) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(this.musicGain);
      oscillator.start();
      this.musicOscillators.push(oscillator);
    }
  }

  stopMusic(): void {
    for (const oscillator of this.musicOscillators) {
      try {
        oscillator.stop();
        oscillator.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.musicOscillators = [];
    this.musicGain?.disconnect();
    this.musicGain = null;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stopMusic();
  }

  dispose(): void {
    this.stopMusic();
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
      this.master = null;
    }
  }

  // --- internals -----------------------------------------------------------

  private scheduleTone(context: AudioContext, tone: ToneSpec, startAt: number, volume: number): void {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const duration = Math.max(0.02, tone.durationMs / 1000);

    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.from, startAt);
    if (tone.to && tone.to !== tone.from) {
      oscillator.frequency.linearRampToValueAtTime(tone.to, startAt + duration);
    }

    // Short attack, exponential decay: what makes a synthesised blip sound intentional.
    const peak = Math.max(0.0001, tone.gain * volume);
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(envelope);
    envelope.connect(this.master ?? context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.03);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
    };
  }

  private ensureContext(): AudioContext | null {
    if (this.failed) return null;
    if (this.context) return this.context;

    try {
      if (this.contextFactory) {
        this.context = this.contextFactory();
      } else {
        const Ctor: typeof AudioContext | undefined =
          typeof AudioContext !== 'undefined'
            ? AudioContext
            : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        this.context = Ctor ? new Ctor() : null;
      }

      if (!this.context) {
        this.failed = true;
        logger.info('audio', 'Web Audio unavailable; running silently');
        return null;
      }

      this.master = this.context.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.context.destination);
      return this.context;
    } catch (error) {
      this.failed = true;
      logger.warn('audio', 'could not create AudioContext; running silently', error);
      return null;
    }
  }
}
