import Phaser from 'phaser';

import { MIN_TOUCH_TARGET, SPACING } from '@/core/constants/Layout';
import { UI_DEPTH } from '@/core/constants/GameConstants';
import { Button } from '@/ui/components/Button';
import { Widget } from '@/ui/components/Widget';
import { setTextIfChanged } from '@/ui/utils/TextUtils';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import type { LayoutHandle } from '@/ui/layout/LayoutService';

/**
 * TUTORIAL HINT BANNER
 * ====================
 * A single non-modal line of guidance that sits above the restore panel. It never blocks
 * input, never covers the café and can be acknowledged ("GOT IT") or dismissed outright
 * ("SKIP"). Steps that are satisfied by doing the thing advance on their own - the player
 * does not have to tap anything to continue playing.
 */
export interface TutorialBannerOptions {
  readonly onAcknowledge: () => void;
  readonly onSkip: () => void;
}

export class TutorialBanner extends Widget {
  private readonly card: Phaser.GameObjects.Graphics;
  private readonly progressLabel: Phaser.GameObjects.Text;
  private readonly message: Phaser.GameObjects.Text;
  private readonly detail: Phaser.GameObjects.Text;
  private readonly gotItButton: Button;
  private readonly skipButton: Button;
  private acknowledgePending = true;

  private readonly bannerWidth = 620;
  private readonly bannerHeight = 210;

  constructor(scene: Phaser.Scene, options: TutorialBannerOptions) {
    super(scene, {
      anchorX: 'center',
      anchorY: 'bottom',
      offsetY: 420,
      respectSafeArea: true,
      depth: UI_DEPTH.panels + 40,
      size: { width: 620, height: 210 },
      startHidden: true,
    });

    this.card = this.addToWidget(scene.add.graphics());
    this.progressLabel = makeText(scene, '', { size: 'micro', color: UI_THEME.css.gem, bold: true });
    this.message = makeText(scene, '', { size: 'small', bold: true });
    this.detail = makeText(scene, '', { size: 'micro', color: UI_THEME.css.textMuted });
    this.container.add([this.progressLabel, this.message, this.detail]);

    this.gotItButton = new Button(scene, {
      label: 'GOT IT',
      variant: 'primary',
      width: 260,
      height: MIN_TOUCH_TARGET,
      onClick: () => options.onAcknowledge(),
    });
    this.skipButton = new Button(scene, {
      label: 'SKIP',
      variant: 'ghost',
      width: 180,
      height: MIN_TOUCH_TARGET,
      onClick: () => options.onSkip(),
    });
    this.container.add([this.gotItButton.container, this.skipButton.container]);
  }

  show(step: { readonly message: string; readonly detail?: string; readonly index: number; readonly total: number }, 
       options: { readonly requireAcknowledge: boolean }): void {
    setTextIfChanged(this.progressLabel, `HINT ${step.index + 1} / ${step.total}`);
    setTextIfChanged(this.message, step.message);
    setTextIfChanged(this.detail, step.detail ?? '');
    this.acknowledgePending = options.requireAcknowledge;
    // "GOT IT" is only meaningful on steps that need a tap; otherwise it is a shortcut.
    this.gotItButton.setLabel(options.requireAcknowledge ? 'GOT IT' : 'NEXT');
    this.container.setVisible(true);
  }

  /** Re-shows the banner after layout moved it (rotation) without resetting content. */
  override applyLayout(handle: LayoutHandle): this {
    super.applyLayout(handle);
    return this;
  }

  get needsAcknowledge(): boolean {
    return this.acknowledgePending;
  }

  protected override layout(handle: LayoutHandle): void {
    const width = Math.min(this.bannerWidth, handle.metrics.frameUnits.width - SPACING.md * 2);
    const left = -width / 2;
    const top = -this.bannerHeight;

    this.card.clear();
    this.card.fillStyle(UI_THEME.colors.surfaceAlt, 0.97);
    this.card.fillRoundedRect(left, top, width, this.bannerHeight, UI_THEME.radius.lg);
    this.card.lineStyle(2, UI_THEME.colors.gem, 0.75);
    this.card.strokeRoundedRect(left, top, width, this.bannerHeight, UI_THEME.radius.lg);

    this.progressLabel.setPosition(left + SPACING.lg, top + SPACING.sm);
    this.message.setPosition(left + SPACING.lg, top + SPACING.sm + 26);
    this.message.setWordWrapWidth(width - SPACING.lg * 2);
    this.detail.setPosition(left + SPACING.lg, top + SPACING.sm + 76);
    this.detail.setWordWrapWidth(width - SPACING.lg * 2);

    this.gotItButton.container.setPosition(-72, top + this.bannerHeight - 44);
    this.gotItButton.applyChildLayout(handle);
    this.skipButton.container.setPosition(148, top + this.bannerHeight - 44);
    this.skipButton.applyChildLayout(handle);
  }

  override destroy(): void {
    this.gotItButton.destroy();
    this.skipButton.destroy();
    super.destroy();
  }
}
