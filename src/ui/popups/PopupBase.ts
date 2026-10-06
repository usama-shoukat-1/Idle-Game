import Phaser from 'phaser';

import { SPACING } from '@/core/constants/Layout';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import { Button } from '@/ui/components/Button';
import { Screen } from '@/ui/components/Screen';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';

/**
 * POPUP BASE
 * ==========
 * Every modal (confirmation, reward, offline summary, future shop) shares this shell:
 * full-frame scrim, centred card, title + body, and a row of actions.
 *
 * Popup buttons are laid out from the card's *content width* rather than fixed x/y, so a
 * one-button confirm and a three-button reward card both look correct on every aspect
 * ratio. Actions are labelled with verbs; the destructive one is visually distinct.
 */
export interface PopupAction {
  readonly label: string;
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  readonly onClick?: () => void;
  readonly closeOnClick?: boolean;
}

export interface PopupOptions {
  readonly title: string;
  readonly body?: string;
  readonly actions?: readonly PopupAction[];
  readonly onClose?: () => void;
  /** Popups are dismissible by default; confirmations of paid actions are not. */
  readonly dismissible?: boolean;
  readonly width?: number;
  readonly height?: number;
}

export class PopupBase extends Screen {
  private readonly card: Phaser.GameObjects.Graphics;
  private readonly popupTitle: Phaser.GameObjects.Text;
  private readonly bodyText: Phaser.GameObjects.Text | null;
  private readonly buttons: Button[] = [];
  private readonly popupOptions: PopupOptions;
  private cardWidth = 0;
  private cardHeight = 0;

  constructor(scene: Phaser.Scene, options: PopupOptions) {
    super(scene, { depth: UI_DEPTH.popups, withScrim: true });
    this.popupOptions = options;

    this.card = scene.add.graphics();
    this.container.add(this.card);

    this.popupTitle = makeText(scene, options.title, {
      size: 'title',
      bold: true,
      align: 'center',
    });
    this.popupTitle.setOrigin(0.5, 0);
    this.container.add(this.popupTitle);

    this.bodyText = options.body
      ? makeText(scene, options.body, {
          size: 'small',
          align: 'center',
          color: UI_THEME.css.textMuted,
        })
      : null;
    if (this.bodyText) {
      this.bodyText.setOrigin(0.5, 0);
      this.container.add(this.bodyText);
    }

    for (const action of options.actions ?? []) {
      const button = new Button(scene, {
        label: action.label,
        width: 240,
        height: 96,
        variant: action.variant ?? 'secondary',
        onClick: () => {
          action.onClick?.();
          if (action.closeOnClick !== false) this.close();
        },
      });
      this.buttons.push(button);
      this.container.add(button.container);
    }

    if (options.dismissible !== false) {
      // Tapping the scrim dismisses; the scrim is the first child so buttons stay on top.
      this.scrim?.on('pointerup', () => this.close());
      scene.input.keyboard?.on('keydown-ESC', this.close, this);
    }
  }

  protected get cardTop(): number {
    return this.centerY() - this.cardHeight / 2;
  }

  protected get cardBottom(): number {
    return this.centerY() + this.cardHeight / 2;
  }

  protected get cardContentWidth(): number {
    return this.cardWidth - SPACING.xl * 2;
  }

  protected override layout(_handle: LayoutHandle): void {
    this.cardWidth = Math.min(this.popupOptions.width ?? 600, this.frameWidth - SPACING.xl * 2);
    this.cardHeight = this.popupOptions.height ?? 560;

    const left = this.centerX() - this.cardWidth / 2;
    const top = this.cardTop;

    this.card.clear();
    this.card.fillStyle(UI_THEME.colors.surface, 0.99);
    this.card.fillRoundedRect(left, top, this.cardWidth, this.cardHeight, SPACING.lg);
    this.card.lineStyle(3, UI_THEME.colors.outline, 1);
    this.card.strokeRoundedRect(left, top, this.cardWidth, this.cardHeight, SPACING.lg);

    this.popupTitle.setPosition(this.centerX(), top + SPACING.xl);
    let cursor = top + SPACING.xl + UI_THEME.fontSize.title + SPACING.md;

    if (this.bodyText) {
      this.bodyText.setPosition(this.centerX(), cursor);
      this.bodyText.setWordWrapWidth(this.cardContentWidth);
      cursor += this.bodyText.height + SPACING.xl;
    }

    // Buttons are stacked from the bottom of the card upwards: predictable on any height.
    const buttonRowHeight = 96 + SPACING.md;
    this.buttons.forEach((button, index) => {
      const y = this.cardBottom - SPACING.xl - 96 / 2 - index * buttonRowHeight;
      button.container.setPosition(this.centerX(), y);
      button.applyChildLayout(_handle);
    });
  }

  close(): void {
    this.popupOptions.onClose?.();
    this.destroy();
  }

  override destroy(): void {
    this.scene.input.keyboard?.off('keydown-ESC', this.close, this);
    for (const button of this.buttons) button.destroy();
    this.buttons.length = 0;
    super.destroy();
  }
}
