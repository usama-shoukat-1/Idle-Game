/**
 * Debug overlay: FPS + a live game-state summary in the corner of the screen.
 * Development builds only - it is created exclusively from `GameScene` when
 * `config.debug.showOverlay` is true.
 */

import Phaser from 'phaser';
import type { GameContext } from '@/core/GameContext';
import type { Viewport } from '@/ui/layout/Viewport';
import { formatNumber } from '@/core/utils/numbers';

export class DebugOverlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly text: Phaser.GameObjects.Text;
  private readonly backdrop: Phaser.GameObjects.Rectangle;
  private accumulated = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly context: GameContext,
    viewport: Viewport,
  ) {
    const bounds = viewport.bounds;
    this.backdrop = scene.add
      .rectangle(0, 0, 10, 10, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x00ff9c, 0.5);

    this.text = scene.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: `${Math.max(9, Math.round(bounds.width * 0.021))}px`,
        color: '#9ef7c1',
        lineSpacing: 2,
      })
      .setOrigin(0, 0);

    this.container = scene.add.container(bounds.safeLeft + 6, bounds.safeTop + 6, [this.backdrop, this.text]); // eslint-disable-line
    this.container.setDepth(10_000).setScrollFactor(0);
    this.refresh();
  }

  update(deltaMs: number): void {
    this.accumulated += deltaMs;
    if (this.accumulated < 500) return; // 2 Hz is plenty for a debug readout
    this.accumulated = 0;
    this.refresh();
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }

  resize(viewport: Viewport): void {
    const bounds = viewport.bounds;
    this.container.setPosition(bounds.safeLeft + 6, bounds.safeTop + 6);
    this.text.setFontSize(Math.max(9, Math.round(bounds.width * 0.021)));
    this.refresh();
  }

  private refresh(): void {
    const { state, economy, buildings, timers } = this.context;
    const fps = this.context.debug.fps();
    const lines = [
      `FPS ${fps ?? '--'}  ${this.scene.game.config.width}x${this.scene.game.config.height}`,
      `coins ${formatNumber(economy.getCoins())}  gems ${formatNumber(economy.getGems())}`,
      `income/s ${formatNumber(buildings.getTotalIncomePerSecond())}  pending ${formatNumber(buildings.pending)}`,
      `buildings ${Object.keys(state.state.buildings).length}  timers ${timers.getAll('running').length}`,
      `taps ${state.state.stats.totalTaps}  saves ${this.context.save.stats.saveCount}`,
    ];
    this.text.setText(lines.join('\n'));

    const padding = 6;
    this.backdrop.setSize(this.text.width + padding * 2, this.text.height + padding * 2);
    this.text.setPosition(padding, padding);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
