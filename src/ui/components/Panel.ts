import Phaser from 'phaser';

import { RADIUS, SPACING } from '@/core/constants/Layout';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import { Widget, type WidgetOptions } from './Widget';

/**
 * Reusable surface: a rounded, bordered container with an optional title.
 * Every popup, panel and screen background is built from this, so the visual language
 * (radius, border, surface colours) lives in exactly one place.
 */
export interface PanelOptions extends WidgetOptions {
  readonly width: number;
  readonly height: number;
  readonly title?: string;
  readonly subtitle?: string;
  /** Extra translucent backdrop that dims the world behind the panel. */
  readonly withBackdrop?: boolean;
  readonly padding?: number;
}

export class Panel extends Widget {
  private readonly background: Phaser.GameObjects.Graphics;
  private readonly titleText: Phaser.GameObjects.Text | null;
  private readonly subtitleText: Phaser.GameObjects.Text | null;
  private readonly backdrop: Phaser.GameObjects.Rectangle | null = null;
  private readonly panelOptions: Required<Omit<PanelOptions, keyof WidgetOptions | 'title' | 'subtitle'>>;

  constructor(scene: Phaser.Scene, options: PanelOptions) {
    super(scene, {
      ...options,
      anchorY: options.anchorY ?? 'middle',
      size: { width: options.width, height: options.height },
    });
    this.panelOptions = {
      width: options.width,
      height: options.height,
      withBackdrop: options.withBackdrop ?? false,
      padding: options.padding ?? SPACING.lg,
    };

    this.background = this.addToWidget(scene.add.graphics());
    this.drawBackground();

    let titleY = -this.panelOptions.height / 2 + this.panelOptions.padding;
    if (options.title) {
      this.titleText = this.addToWidget(
        makeText(scene, options.title, { size: 'title', bold: true, color: UI_THEME.css.text, align: 'center' }),
      );
      this.titleText.setOrigin(0.5, 0);
      this.titleText.setPosition(0, titleY);
      titleY += UI_THEME.fontSize.title + SPACING.xs;
    } else {
      this.titleText = null;
    }

    if (options.subtitle) {
      this.subtitleText = this.addToWidget(
        makeText(scene, options.subtitle, {
          size: 'small',
          color: UI_THEME.css.textMuted,
          align: 'center',
          wordWrapWidth: this.panelOptions.width - this.panelOptions.padding * 2,
        }),
      );
      this.subtitleText.setOrigin(0.5, 0);
      this.subtitleText.setPosition(0, titleY);
    } else {
      this.subtitleText = null;
    }

    if (options.withBackdrop) {
      // The backdrop is a child of the panel container so it inherits the UI root's design-unit
      // scaling. It is inserted first (below the card) and sized to the whole frame in
      // `layout()`; `setInteractive()` makes it swallow taps meant for the world behind.
      this.backdrop = scene.add.rectangle(0, 0, 10, 10, UI_THEME.colors.background, 0.72).setOrigin(0.5, 0.5);
      this.backdrop.setInteractive();
      this.container.addAt(this.backdrop, 0);
    }
  }

  get contentWidth(): number {
    return this.panelOptions.width - this.panelOptions.padding * 2;
  }

  get contentHeight(): number {
    return this.panelOptions.height - this.panelOptions.padding * 2;
  }

  get padding(): number {
    return this.panelOptions.padding;
  }

  /** Vertical start for content below the title block, in design units (container space). */
  get contentTop(): number {
    let y = -this.panelOptions.height / 2 + this.panelOptions.padding;
    if (this.titleText) y += UI_THEME.fontSize.title + SPACING.xs;
    if (this.subtitleText) y += UI_THEME.fontSize.small + SPACING.xs;
    return y;
  }

  protected override layout(handle: LayoutHandle): void {
    if (!this.backdrop) return;
    // Frame size in design units; centred on the frame, expressed relative to this panel's
    // own position (the container's origin sits at the panel's centre).
    const frame = handle.metrics.frameUnits;
    this.backdrop.setSize(frame.width, frame.height);
    this.backdrop.setPosition(frame.width / 2 - this.container.x, frame.height / 2 - this.container.y);
  }

  setTitle(title: string): void {
    this.titleText?.setText(title);
  }

  override destroy(): void {
    this.backdrop?.removeAllListeners();
    this.backdrop?.destroy();
    super.destroy();
  }

  private drawBackground(): void {
    const { width, height } = this.panelOptions;
    const radius = RADIUS.lg;
    this.background.clear();
    this.background.fillStyle(UI_THEME.colors.surface, 0.98);
    this.background.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
    this.background.lineStyle(3, UI_THEME.colors.outline, 1);
    this.background.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
  }
}
