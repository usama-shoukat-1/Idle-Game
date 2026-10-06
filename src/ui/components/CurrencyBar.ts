/**
 * Top currency bar.
 *
 * Purely reactive: it subscribes to economy events and repaints (never polls the
 * state), and it is layout-driven so it reflows correctly when the viewport changes.
 */

import Phaser from 'phaser';
import { COLORS, HEX } from '../UiTheme';
import { createLabel } from './Label';
import { Panel } from './Panel';
import { topBarRect } from '../layout/Layout';
import type { GameContext } from '@/core/GameContext';
import type { Viewport } from '../layout/Viewport';
import type { Subscription } from '@/systems/EventSystem';
import { formatNumber } from '@/core/utils/numbers';

export class CurrencyBar extends Phaser.GameObjects.Container {
  private readonly panel: Panel;
  private readonly coinIcon: Phaser.GameObjects.Image;
  private readonly gemIcon: Phaser.GameObjects.Image;
  private readonly coinText: Phaser.GameObjects.Text;
  private readonly gemText: Phaser.GameObjects.Text;
  private readonly rateText: Phaser.GameObjects.Text;
  private readonly subscriptions: Subscription[] = [];

  constructor(
    scene: Phaser.Scene,
    private readonly context: GameContext,
    viewport: Viewport,
  ) {
    const rect = topBarRect(viewport);
    super(scene, rect.x, rect.y);

    this.panel = new Panel(scene, { x: 0, y: 0, width: rect.width, height: rect.height }, {
      fill: COLORS.panel,
      fillAlpha: 0.94,
    });

    this.coinIcon = scene.add.image(0, 0, 'placeholder-coin').setOrigin(0, 0.5);
    this.gemIcon = scene.add.image(0, 0, 'placeholder-gem').setOrigin(0, 0.5);
    this.coinText = createLabel(scene, viewport, '0', { size: 'lg', bold: true, color: HEX.coin, origin: { x: 0, y: 0.5 } });
    this.gemText = createLabel(scene, viewport, '0', { size: 'lg', bold: true, color: HEX.gem, origin: { x: 0, y: 0.5 } });
    this.rateText = createLabel(scene, viewport, '', { size: 'xs', color: HEX.textDim, origin: { x: 1, y: 0.5 } });

    this.add([this.panel, this.coinIcon, this.coinText, this.gemIcon, this.gemText, this.rateText]);
    this.setDepth(1000).setScrollFactor(0);
    scene.add.existing(this);

    this.layout(viewport);
    this.bindEvents();
    this.refresh();
  }

  /** Reposition + resize for a new viewport (called on resize/orientation change). */
  layout(viewport: Viewport): void {
    const rect = topBarRect(viewport);
    this.setPosition(rect.x, rect.y);
    this.panel.setRect({ x: 0, y: 0, width: rect.width, height: rect.height });

    const pad = Math.round(rect.height * 0.18);
    const iconSize = Math.round(Math.min(rect.height * 0.42, rect.width * 0.06));
    const midY = rect.height / 2;

    this.coinIcon.setPosition(pad, midY).setDisplaySize(iconSize, iconSize);
    this.coinText.setPosition(pad + iconSize + Math.round(pad * 0.4), midY);
    this.gemIcon.setPosition(Math.round(rect.width * 0.48), midY).setDisplaySize(iconSize, iconSize);
    this.gemText.setPosition(Math.round(rect.width * 0.48) + iconSize + Math.round(pad * 0.4), midY);
    this.rateText.setPosition(rect.width - pad, midY);
  }

  private bindEvents(): void {
    this.subscriptions.push(
      this.context.events.on('economy:changed', () => this.refresh()),
      this.context.events.on('building:income-flushed', () => this.refresh()),
    );
  }

  private refresh(): void {
    this.coinText.setText(formatNumber(this.context.economy.getCoins()));
    this.gemText.setText(formatNumber(this.context.economy.getGems()));
    const rate = this.context.buildings.getTotalIncomePerSecond();
    this.rateText.setText(rate > 0 ? `+${formatNumber(rate)}/s` : '');
  }

  override destroy(fromScene?: boolean): void {
    for (const subscription of this.subscriptions) subscription.off();
    this.subscriptions.length = 0;
    super.destroy(fromScene);
  }
}
