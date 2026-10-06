/**
 * Purchase facade.
 *
 * The catalogue comes from content (`ProductCatalogEntry`), prices come from the
 * provider, and reward delivery goes through the shared `RewardDispatcher`.
 * No store product ids or ad unit ids are hard-coded anywhere in game code.
 */

import type { Clock } from '@/core/Clock';
import type { ProductCatalogEntry } from '@/core/types/content';
import type { EntitlementId, ProductId } from '@/core/types/ids';
import type { PurchaseResult, PurchaseService, StoreProduct } from '@/core/types/monetization';
import type { GameStateStore } from '@/core/state/GameStateStore';
import { createLogger } from '@/core/utils/logger';
import type { GameEventBus } from '@/systems/EventSystem';
import type { ContentRegistry } from '@/systems/ContentSystem/ContentRegistry';
import type { RewardDispatcher } from '@/systems/AdRewardSystem/RewardDispatcher';

export interface PurchaseSystemDeps {
  store: GameStateStore;
  events: GameEventBus;
  clock: Clock;
  content: ContentRegistry;
  service: PurchaseService;
  dispatcher: RewardDispatcher;
}

export class PurchaseSystem {
  private readonly log = createLogger('purchases');
  private storeProducts: StoreProduct[] = [];

  constructor(private readonly deps: PurchaseSystemDeps) {}

  get providerName(): string {
    return this.deps.service.providerName;
  }

  isProviderAvailable(): boolean {
    return this.deps.service.isAvailable();
  }

  /** Enabled catalogue entries (content), independent of provider availability. */
  getCatalog(): ProductCatalogEntry[] {
    return this.deps.content.listProducts().filter((entry) => entry.enabled);
  }

  /** Last fetched provider prices (localized strings). */
  getStoreProducts(): StoreProduct[] {
    return this.storeProducts;
  }

  /** Fetch provider price info for the enabled catalogue. */
  async refreshStoreProducts(): Promise<StoreProduct[]> {
    if (!this.deps.service.isAvailable()) {
      this.storeProducts = [];
      return [];
    }
    try {
      this.storeProducts = await this.deps.service.listProducts(this.getCatalog().map((entry) => entry.id));
      return this.storeProducts;
    } catch (error) {
      this.log.error('failed to list store products', error);
      this.storeProducts = [];
      return [];
    }
  }

  /** Price label for a product, preferring the provider's localized string. */
  getPriceLabel(productId: ProductId): string {
    const product = this.deps.content.getProduct(productId);
    const storeProduct = this.storeProducts.find((entry) => entry.productId === productId);
    return storeProduct?.priceLabel ?? (product ? 'unavailable' : 'unknown-product');
  }

  async purchase(productId: ProductId): Promise<PurchaseResult> {
    const product = this.deps.content.getProduct(productId);
    if (!product || !product.enabled) {
      const result: PurchaseResult = { productId, status: 'unavailable', message: 'product not in catalogue' };
      this.deps.events.emit('purchase:failed', { productId, status: result.status, message: result.message });
      return result;
    }

    if (!this.deps.service.isAvailable()) {
      const result: PurchaseResult = { productId, status: 'unavailable', message: 'store unavailable' };
      this.deps.events.emit('purchase:failed', { productId, status: result.status, message: result.message });
      return result;
    }

    const result = await this.deps.service.purchase(productId);
    if (result.status === 'completed') {
      this.deliver(product, result.transactionId);
      this.deps.events.emit('purchase:completed', {
        productId,
        status: result.status,
        ...(result.transactionId ? { transactionId: result.transactionId } : {}),
      });
      return result;
    }

    this.deps.events.emit('purchase:failed', {
      productId,
      status: result.status,
      ...(result.message ? { message: result.message } : {}),
    });
    return result;
  }

  /**
   * Re-apply non-consumable entitlements after a reinstall (required by the
   * App Store guidelines, supported here for symmetry).
   */
  async restore(): Promise<PurchaseResult[]> {
    if (!this.deps.service.isAvailable()) return [];
    const results = await this.deps.service.restore();
    for (const result of results) {
      if (result.status !== 'completed') continue;
      const product = this.deps.content.getProduct(result.productId);
      if (product) this.deliver(product, result.transactionId);
    }
    return results;
  }

  isEntitled(entitlementId: EntitlementId): boolean {
    const entry = this.deps.store.state.entitlements[entitlementId];
    if (!entry) return false;
    if (entry.expiresAt !== null && entry.expiresAt <= this.deps.clock.now()) return false;
    return entry.active;
  }

  /** Convenience for content that wants to hide ad offers after "remove ads". */
  get hasRemoveAds(): boolean {
    return this.deps.content
      .listEntitlements()
      .filter((entitlement) => entitlement.kind === 'remove-ads')
      .some((entitlement) => this.isEntitled(entitlement.id));
  }

  private deliver(product: ProductCatalogEntry, transactionId?: string): void {
    const at = this.deps.clock.now();
    // Delivery is pure data: the catalogue entry lists the grants, including any
    // entitlement grants. There is deliberately no implicit mapping here.
    const grants = [...(product.grants ?? [])];
    const applied = this.deps.dispatcher.apply(grants, `purchase:${product.id}`, { now: at });
    this.log.info(
      `purchase delivered: ${product.id} (${applied.filter((entry) => entry.applied).length}/${grants.length} grants)${transactionId ? ` tx=${transactionId}` : ''}`,
    );
  }
}
