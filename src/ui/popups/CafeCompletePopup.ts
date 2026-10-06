import Phaser from 'phaser';

import { formatCompactNumber } from '@/core/events/EventBus';
import { Button } from '@/ui/components/Button';
import { PopupBase } from './PopupBase';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import { setTextIfChanged } from '@/ui/utils/TextUtils';
import type { LayoutHandle } from '@/ui/layout/LayoutService';

/**
 * BUILDING COMPLETION POPUP
 * =========================
 * The payoff for a finished restoration: the café at its best, and the numbers behind it
 * (final income, total spent, completion percentage). It intentionally ends with a
 * disabled "coming next" action - the *next* location is Phase 2 content, and pretending
 * otherwise would promise content the build does not have.
 */
export interface CafeCompletePopupOptions {
  readonly buildingName: string;
  readonly finalIncomePerMinute: number;
  readonly totalRestorationCost: number;
  readonly totalSpent: number;
  readonly completionPercent: number;
  readonly onClose: () => void;
}

export class CafeCompletePopup extends PopupBase {
  private readonly headline: Phaser.GameObjects.Text;
  private readonly stats: Phaser.GameObjects.Text;
  private readonly nextButton: Button;

  constructor(scene: Phaser.Scene, options: CafeCompletePopupOptions) {
    super(scene, {
      title: `${options.buildingName.toUpperCase()} RESTORED`,
      body: 'Every crack, counter and chair — back in business.',
      dismissible: false,
      width: 640,
      height: 660,
    });

    this.headline = makeText(scene, '★★★★★', {
      size: 'display',
      color: UI_THEME.css.accent,
      align: 'center',
    });
    this.headline.setOrigin(0.5, 0.5);
    this.container.add(this.headline);

    this.stats = makeText(scene, '', {
      size: 'small',
      color: UI_THEME.css.text,
      align: 'center',
    });
    this.stats.setOrigin(0.5, 0);
    this.container.add(this.stats);

    this.nextButton = new Button(scene, {
      label: 'NEXT LOCATION — COMING NEXT',
      variant: 'ghost',
      width: 520,
      height: 104,
      disabled: true,
      onClick: () => undefined,
    });
    this.container.add(this.nextButton.container);

    const closeButton = new Button(scene, {
      label: 'STAY FOR A COFFEE',
      variant: 'primary',
      width: 520,
      height: 104,
      onClick: () => {
        options.onClose();
        this.close();
      },
    });
    this.container.add(closeButton.container);
    this.closeButton = closeButton;

    setTextIfChanged(
      this.stats,
      [
        `${formatCompactNumber(options.finalIncomePerMinute)} coins / min`,
        `${formatCompactNumber(options.totalSpent)} coins spent of ${formatCompactNumber(options.totalRestorationCost)}`,
        `${Math.round(options.completionPercent)}% restored`,
      ].join('\n'),
    );
  }

  private readonly closeButton: Button;

  protected override layout(handle: LayoutHandle): void {
    super.layout(handle);
    const centre = this.centerX();
    this.headline.setPosition(centre, this.cardTop + 170);
    this.stats.setPosition(centre, this.cardTop + 240);
    const lines = this.stats.text.split('\n').length;
    this.nextButton.container.setPosition(centre, this.cardTop + 240 + lines * 44 + 60);
    this.nextButton.applyChildLayout(handle);
    this.closeButton.container.setPosition(centre, this.cardBottom - 72);
    this.closeButton.applyChildLayout(handle);
  }

  override destroy(): void {
    this.nextButton.destroy();
    this.closeButton.destroy();
    super.destroy();
  }
}
