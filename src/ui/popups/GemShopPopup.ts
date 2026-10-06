import Phaser from 'phaser';

import { formatCompactNumber } from '@/core/events/EventBus';
import { Button } from '@/ui/components/Button';
import { PopupBase } from './PopupBase';
import { UI_THEME, makeText } from '@/ui/theme/UiTheme';
import { setTextIfChanged } from '@/ui/utils/TextUtils';
import type { LayoutHandle } from '@/ui/layout/LayoutService';
import type { StoreCatalogEntry } from '@/systems/PurchaseSystem/PurchaseSystem';

/**
 * GEM SHOP (MOCK STORE)
 * =====================
 * A small shop reached from the gem counter. Every purchase goes through
 * `PurchaseSystem` -> `PurchaseService`, so this popup contains no prices, no product ids
 * and no store logic of its own: it renders whatever catalog and price labels the
 * provider reports.
 *
 * While the provider is a mock (Phase 1), the popup says so explicitly and shows the
 * provider's name - the player is never led to believe a mock price is a real one.
 */
export interface GemShopPopupOptions {
  readonly catalog: readonly StoreCatalogEntry[];
  readonly providerName: string;
  readonly isMock: boolean;
  readonly gemsOwned: () => number;
  readonly priceLabel: (productId: string) => string | null;
  /** Runs the purchase; returns a short status line for the popup footer. */
  readonly onPurchase: (productId: string) => Promise<string>;
}

export class GemShopPopup extends PopupBase {
  private readonly shopOptions: GemShopPopupOptions;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly gemCountText: Phaser.GameObjects.Text;
  private readonly rows: Array<{
    readonly button: Button;
    readonly productId: string;
    readonly label: Phaser.GameObjects.Text;
  }> = [];
  private busy = false;

  constructor(scene: Phaser.Scene, options: GemShopPopupOptions) {
    super(scene, {
      title: 'Gem Shop',
      body: options.isMock
        ? 'Development build — purchases are simulated by a mock store. No real money is charged.'
        : 'Gems are used to finish upgrades instantly.',
      dismissible: true,
      width: 640,
      height: 720,
    });

    this.shopOptions = options;

    this.gemCountText = makeText(scene, '', {
      size: 'small',
      bold: true,
      color: UI_THEME.css.gem,
      align: 'center',
    });
    this.gemCountText.setOrigin(0.5, 0);
    this.container.add(this.gemCountText);

    options.catalog.forEach((entry, index) => {
      const gems = entry.grants?.gems ?? 0;
      const price = options.priceLabel(entry.productId) ?? 'unavailable';
      const label = makeText(scene, `${formatCompactNumber(gems)} gems  ·  ${price}`, {
        size: 'micro',
        color: UI_THEME.css.textMuted,
      });
      label.setOrigin(0, 0.5);
      this.container.add(label);

      const button = new Button(scene, {
        label: entry.displayName.toUpperCase(),
        variant: index === options.catalog.length - 1 ? 'primary' : 'secondary',
        width: 340,
        height: 96,
        onClick: () => void this.buy(entry.productId),
      });
      this.container.add(button.container);
      this.rows.push({ button, productId: entry.productId, label });
    });

    this.statusText = makeText(scene, 'Instant finishes: 1 gem per remaining minute.', {
      size: 'micro',
      color: UI_THEME.css.textMuted,
      align: 'center',
    });
    this.statusText.setOrigin(0.5, 0.5);
    this.container.add(this.statusText);

    this.refresh();
  }

  private async buy(productId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setButtonsEnabled(false);
    setTextIfChanged(this.statusText, 'Contacting store…');

    try {
      const message = await this.shopOptions.onPurchase(productId);
      setTextIfChanged(this.statusText, message);
    } catch (error) {
      setTextIfChanged(this.statusText, `Purchase failed: ${String(error)}`);
    } finally {
      this.busy = false;
      this.setButtonsEnabled(true);
      this.refresh();
    }
  }

  private setButtonsEnabled(enabled: boolean): void {
    for (const row of this.rows) row.button.setEnabled(enabled);
  }

  private refresh(): void {
    setTextIfChanged(this.gemCountText, `You have ${formatCompactNumber(this.shopOptions.gemsOwned())} gems`);
  }

  protected override layout(handle: LayoutHandle): void {
    super.layout(handle);
    const centre = this.centerX();
    this.gemCountText.setPosition(centre, this.cardTop + 150);

    let cursor = this.cardTop + 208;
    for (const row of this.rows) {
      row.label.setPosition(centre - this.cardContentWidth / 2, cursor);
      row.button.container.setPosition(centre, cursor + 72);
      row.button.applyChildLayout(handle);
      cursor += 132;
    }

    this.statusText.setPosition(centre, this.cardBottom - 54);
    this.statusText.setWordWrapWidth(this.cardContentWidth);
  }

  public get productIds(): readonly string[] {
    return this.rows.map((row) => row.productId);
  }

  override destroy(): void {
    for (const row of this.rows) row.button.destroy();
    this.rows.length = 0;
    super.destroy();
  }
}
