import Phaser from 'phaser';

import { formatCompactNumber } from '@/core/events/EventBus';
import { formatDuration } from '@/core/utils/TimeUtils';
import { Button } from '@/ui/components/Button';
import { PopupBase } from './PopupBase';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import { setTextIfChanged } from '@/ui/utils/TextUtils';
import type { PendingOfflineReward } from '@/core/types/state';

/**
 * OFFLINE EARNINGS POPUP
 * ======================
 * Shown once per return, when the calculated (not yet granted) offline reward is waiting.
 *
 *   "You earned 1,250 coins"     [ COLLECT ]  [ WATCH AD → 2× REWARD ]
 *
 * Two rules this popup exists to enforce:
 *  1. The reward is money the player already earned, so COLLECT is the primary action and
 *     dismissing the popup still collects it (see `OfflineEarningsPopupOptions.onDismiss`).
 *  2. The ad is an *extra*: it doubles the pending reward and is never required. The
 *     boosted amount is only granted when the player taps COLLECT afterwards.
 */
export interface OfflineEarningsPopupOptions {
  readonly pending: PendingOfflineReward;
  readonly capMs: number;
  /**
   * Doubles the pending reward through the ad system and resolves with the new amount.
   * Async because the provider's `show()` is async (`MockRewardedAdService` resolves
   * immediately; a real network SDK would not).
   */
  readonly onWatchAd: () => Promise<number> | number;
  /** Grants the (possibly boosted) reward. Called exactly once. */
  readonly onCollect: () => void;
  /**
   * Safety net for a dismiss that bypasses COLLECT (e.g. an ESC key): the earned coins
   * are still granted, so a stray tap can never lose the player money.
   */
  readonly onDismiss?: (coins: number, boosted: boolean) => void;
}

export class OfflineEarningsPopup extends PopupBase {
  private readonly amountText: Phaser.GameObjects.Text;
  private readonly doubledText: Phaser.GameObjects.Text;
  private readonly detailText: Phaser.GameObjects.Text;
  private readonly adButton: Button;
  private readonly collectButton: Button;

  private coins: number;
  private boosted: boolean;
  private settled = false;
  private readonly offlineOptions: OfflineEarningsPopupOptions;

  constructor(scene: Phaser.Scene, options: OfflineEarningsPopupOptions) {
    const minutes = Math.max(1, Math.round(options.pending.effectiveElapsedMs / 60_000));
    super(scene, {
      title: 'Welcome back',
      body: options.pending.capped
        ? `You were away ${formatDuration(options.pending.elapsedMs)} — offline earnings are capped at ${formatDuration(options.capMs)}.`
        : `You were away ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      dismissible: false,
      width: 620,
      height: 620,
    });

    this.offlineOptions = options;
    this.coins = options.pending.coins;
    this.boosted = options.pending.boosted;

    this.amountText = makeText(scene, `${formatCompactNumber(this.coins)} coins`, {
      size: 'display',
      bold: true,
      color: UI_THEME.css.accent,
      align: 'center',
    });
    this.amountText.setOrigin(0.5, 0.5);
    this.container.add(this.amountText);

    this.doubledText = makeText(scene, '', {
      size: 'small',
      bold: true,
      color: UI_THEME.css.success,
      align: 'center',
    });
    this.doubledText.setOrigin(0.5, 0.5);
    this.container.add(this.doubledText);

    this.detailText = makeText(scene, 'Earned while you were away — collect any time.', {
      size: 'micro',
      color: UI_THEME.css.textMuted,
      align: 'center',
    });
    this.detailText.setOrigin(0.5, 0.5);
    this.container.add(this.detailText);

    // Ads are optional, so the ad button is secondary and the collect button is primary.
    this.adButton = new Button(scene, {
      label: 'WATCH AD → 2× REWARD',
      variant: 'secondary',
      width: 520,
      height: 96,
      onClick: async () => {
        if (this.boosted) return;
        this.adButton.setEnabled(false);
        const next = await options.onWatchAd();
        // Only claim the bonus when the ad actually paid out (a dismissed or failed ad
        // leaves the reward exactly as it was, with the button usable again).
        if (next > this.coins) {
          this.boosted = true;
          this.coins = next;
        }
        this.refresh();
      },
    });
    if (this.boosted) this.adButton.setEnabled(false);

    this.collectButton = new Button(scene, {
      label: 'COLLECT',
      variant: 'primary',
      width: 520,
      height: 104,
      onClick: () => {
        this.settle(options.onCollect);
        this.close();
      },
    });

    this.container.add([this.adButton.container, this.collectButton.container]);
    this.refresh();
  }

  private refresh(): void {
    setTextIfChanged(this.amountText, `${formatCompactNumber(this.coins)} coins`);
    setTextIfChanged(
      this.doubledText,
      this.boosted ? 'AD BONUS APPLIED — 2× REWARD' : 'Watch an optional ad to double it',
    );
    this.adButton.setEnabled(!this.boosted);
  }

  private settle(callback: () => void): void {
    if (this.settled) return;
    this.settled = true;
    callback();
  }

  override close(): void {
    // Even if the popup is dismissed by another route, the earned coins are never lost.
    if (!this.settled) {
      this.settled = true;
      this.offlineOptions.onDismiss?.(this.coins, this.boosted);
    }
    super.close();
  }

  protected override layout(handle: Parameters<PopupBase['applyLayout']>[0]): void {
    super.layout(handle);
    const centre = this.centerX();
    this.amountText.setPosition(centre, this.cardTop + 180);
    this.doubledText.setPosition(centre, this.cardTop + 250);
    this.detailText.setPosition(centre, this.cardTop + 296);
    this.detailText.setWordWrapWidth(this.cardContentWidth);

    this.collectButton.container.setPosition(centre, this.cardBottom - 72);
    this.collectButton.applyChildLayout(handle);
    this.adButton.container.setPosition(centre, this.cardBottom - 186);
    this.adButton.applyChildLayout(handle);
  }
}
