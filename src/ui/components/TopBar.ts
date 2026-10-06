import Phaser from 'phaser';

import type { EventBus } from '@/core/events/EventBus';
import { SPACING } from '@/core/constants/Layout';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import { Widget } from './Widget';
import { CurrencyChip } from './CurrencyChip';
import { Button } from './Button';
import { makeText } from '@/ui/theme/UiTheme';

/**
 * The universal top bar: coins, gems, and an optional right-hand action (pause/settings).
 *
 * Layout is anchor-based and safe-area aware, so it sits below the notch on tall phones
 * without any per-device branching. Chips are spaced dynamically from the *content width*
 * (frame width minus safe-area insets) rather than from fixed pixel offsets.
 */
export interface TopBarOptions {
  readonly events: EventBus;
  readonly onMenuPress?: () => void;
  readonly menuIcon?: string;
  readonly title?: string;
}

export class TopBar extends Widget {
  readonly coins: CurrencyChip;
  readonly gems: CurrencyChip;
  private readonly menuButton: Button | null = null;
  private readonly titleText: Phaser.GameObjects.Text | null;

  constructor(scene: Phaser.Scene, private readonly topBarOptions: TopBarOptions) {
    super(scene, {
      anchorX: 'center',
      anchorY: 'top',
      offsetY: SPACING.md,
      respectSafeArea: true,
      depth: UI_DEPTH.panels,
    });

    this.coins = new CurrencyChip(scene, { kind: 'coins', events: topBarOptions.events, anchorX: 'left', anchorY: 'top' });
    this.gems = new CurrencyChip(scene, { kind: 'gems', events: topBarOptions.events, anchorX: 'left', anchorY: 'top' });

    // The chips are positioned manually inside this bar's own coordinate space, so their
    // independent anchoring is bypassed in `layout()`.
    this.container.add(this.coins.container);
    this.container.add(this.gems.container);
    this.coins.container.setPosition(0, 0);
    this.gems.container.setPosition(0, 0);

    if (topBarOptions.onMenuPress) {
      this.menuButton = new Button(scene, {
        label: '',
        icon: topBarOptions.menuIcon ?? '☰',
        width: 88,
        height: 62,
        variant: 'secondary',
        onClick: topBarOptions.onMenuPress,
      });
      this.container.add(this.menuButton.container);
    }

    if (topBarOptions.title) {
      this.titleText = makeText(scene, topBarOptions.title, { size: 'small', color: '#93a1b3' });
      this.titleText.setOrigin(0.5, 0);
      this.container.add(this.titleText);
    } else {
      this.titleText = null;
    }
  }

  protected override layout(handle: Parameters<Widget['applyLayout']>[0]): void {
    const content = handle.contentBox();
    const chipWidth = 186;
    const half = content.width / 2;

    // Inside the bar container: x runs from -half..half of the content box (design units).
    this.coins.applyLayout(handle);
    this.gems.applyLayout(handle);
    this.coins.container.setPosition(-half + chipWidth / 2, 0);
    this.gems.container.setPosition(-half + chipWidth * 1.5 + SPACING.sm, 0);

    if (this.menuButton) {
      this.menuButton.applyLayout(handle);
      this.menuButton.container.setPosition(half - 44, 0);
    }

    if (this.titleText) {
      this.titleText.setPosition(0, 12);
    }
  }

  override destroy(): void {
    this.coins.destroy();
    this.gems.destroy();
    this.menuButton?.destroy();
    super.destroy();
  }

  /** Exposed so screens can read the intended configuration without duplicating maths. */
  get config(): TopBarOptions {
    return this.topBarOptions;
  }
}
