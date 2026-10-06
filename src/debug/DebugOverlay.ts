import Phaser from 'phaser';

import { SPACING } from '@/core/constants/Layout';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import type { GameClock } from '@/core/Time';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import { Screen } from '@/ui/components/Screen';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import type { DebugTools } from './DebugTools';

/**
 * FPS + state overlay (development builds only).
 *
 * Sampling is cheap: it accumulates frames and refreshes the label at most twice per
 * second, instead of updating text every frame (which would itself cost frame time and
 * distort the number being measured).
 */
export interface DebugOverlayOptions {
  readonly tools: DebugTools;
  readonly clock: GameClock;
  readonly showState?: boolean;
}

/**
 * Keyboard cheat sheet. Development only - it is rendered by the debug overlay, which is
 * never constructed in a release build.
 */
export const DEBUG_KEY_LEGEND =
  'F1 overlay   F2 +1,000 coins   F3 +50 gems   F4 café tier +1   F5 finish upgrade\n' +
  'F6 reset save   F7 simulate offline   F8 mock ads on/off   F9 +60s   F10 mock store on/off';

export class DebugOverlay extends Screen {
  private readonly tools: DebugTools;
  private readonly clock: GameClock;
  private readonly fpsText: Phaser.GameObjects.Text;
  private readonly stateText: Phaser.GameObjects.Text;
  private readonly hintText: Phaser.GameObjects.Text;
  private frames = 0;
  private lastSampleAt = 0;
  private fps = 0;
  private showState: boolean;

  constructor(scene: Phaser.Scene, options: DebugOverlayOptions) {
    super(scene, { depth: UI_DEPTH.debug });
    this.tools = options.tools;
    this.clock = options.clock;
    this.showState = options.showState ?? true;

    this.fpsText = makeText(scene, 'FPS --', { size: 'micro', color: UI_THEME.css.success });
    this.fpsText.setOrigin(0, 0);
    this.stateText = makeText(scene, '', {
      size: 'micro',
      color: UI_THEME.css.textMuted,
      wordWrapWidth: 660,
    });
    this.stateText.setOrigin(0, 0);
    this.hintText = makeText(scene, DEBUG_KEY_LEGEND, {
      size: 'micro',
      color: UI_THEME.css.textMuted,
      wordWrapWidth: 660,
    });
    this.hintText.setOrigin(0, 0);

    this.container.add([this.fpsText, this.stateText, this.hintText]);
    this.lastSampleAt = this.clock.monotonic();
  }

  get isEnabled(): boolean {
    return this.tools.enabled;
  }

  get isVisible(): boolean {
    return this.container.visible;
  }

  /** F1: show/hide the overlay (no-op when the build has no debug tools). */
  toggle(): boolean {
    if (!this.tools.enabled) return false;
    this.setVisible(!this.container.visible);
    return this.container.visible;
  }

  /** Forces an immediate state-summary refresh (used after a cheat). */
  refresh(): void {
    if (!this.tools.enabled) return;
    if (this.showState) this.stateText.setText(this.tools.stateSummary());
  }

  toggleState(): boolean {
    this.showState = !this.showState;
    this.stateText.setVisible(this.showState);
    return this.showState;
  }

  override update(): void {
    if (!this.tools.enabled) return;

    this.frames += 1;
    const now = this.clock.monotonic();
    const elapsed = now - this.lastSampleAt;
    if (elapsed >= 500) {
      // Displayed FPS is derived from real elapsed time, not from a fixed frame budget.
      this.fps = Math.round((this.frames * 1000) / elapsed);
      this.frames = 0;
      this.lastSampleAt = now;
      this.fpsText.setText(
        `FPS ${this.fps}\ncheats used ${this.tools.cheatsUsed}`,
      );
      if (this.showState) this.stateText.setText(this.tools.stateSummary());
    }
  }

  protected override layout(_handle: LayoutHandle): void {
    const frameBottom = this.bottom(0);
    this.fpsText.setPosition(this.left(SPACING.sm), this.top(SPACING.sm));
    this.stateText.setPosition(this.left(SPACING.sm), this.top(SPACING.sm + 52));
    this.stateText.setVisible(this.showState && this.tools.enabled);
    // The key legend sits at the bottom of the screen so it never covers the HUD.
    this.hintText.setPosition(this.left(SPACING.sm), frameBottom - 120);
  }

  refreshNow(): void {
    this.frames = 0;
    this.lastSampleAt = this.clock.monotonic();
    this.fpsText.setText(`FPS --\ncheats used ${this.tools.cheatsUsed}`);
    this.stateText.setText(this.tools.stateSummary());
  }
}
