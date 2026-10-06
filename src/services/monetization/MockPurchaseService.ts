import { logger } from '@/core/Logger';
import type { PurchaseResult, PurchaseService, StoreProduct } from '@/core/types/services';

/**
 * DEVELOPMENT store provider.
 *
 * Product definitions are injected (they ultimately come from the platform store, never
 * from hard-coded ids in gameplay code), purchases resolve locally, and non-consumable
 * entitlements are tracked in memory + reported by `restore()`.
 *
 * Phase 0 ships an EMPTY catalog: no product ids exist anywhere in the codebase yet.
 * When the real store integration lands, only this provider is swapped (see
 * docs/MONETIZATION_ARCHITECTURE.md).
 */
export interface MockPurchaseOptions {
  readonly products?: readonly StoreProduct[];
  /** Simulated latency before a purchase resolves. */
  readonly latencyMs?: number;
  /** Force the next purchase outcome (QA). */
  readonly nextStatus?: PurchaseResult['status'];
  /** Product ids already owned (e.g. restored entitlements). */
  readonly ownedProductIds?: readonly string[];
}

export class MockPurchaseService implements PurchaseService {
  readonly providerName = 'mock';

  private ready = false;
  private products: StoreProduct[];
  private readonly latencyMs: number;
  private nextStatus: PurchaseResult['status'] | null;
  private readonly owned = new Set<string>();
  private readonly purchases: string[] = [];

  constructor(options: MockPurchaseOptions = {}) {
    this.products = [...(options.products ?? [])];
    this.latencyMs = options.latencyMs ?? 0;
    this.nextStatus = options.nextStatus ?? null;
    for (const id of options.ownedProductIds ?? []) this.owned.add(id);
  }

  async initialize(): Promise<void> {
    this.ready = true;
    logger.debug('purchase', `mock store initialised with ${this.products.length} product(s)`);
  }

  async getProducts(): Promise<readonly StoreProduct[]> {
    return this.products;
  }

  async purchase(productId: string): Promise<PurchaseResult> {
    if (!this.ready) {
      return { status: 'unavailable', productId, error: 'not initialised' };
    }

    const product = this.products.find((entry) => entry.productId === productId);
    if (!product) {
      return { status: 'unavailable', productId, error: 'unknown product' };
    }

    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }

    const status = this.nextStatus ?? 'purchased';
    this.nextStatus = null;

    if (status !== 'purchased') {
      return { status, productId };
    }

    if (product.kind === 'nonConsumable') this.owned.add(productId);
    this.purchases.push(productId);

    logger.debug('purchase', `mock purchase completed: ${productId}`);
    return { status: 'purchased', productId, receipt: `mock-receipt.${productId}.${this.purchases.length}` };
  }

  async restore(): Promise<readonly string[]> {
    return [...this.owned];
  }

  owns(productId: string): boolean {
    return this.owned.has(productId);
  }

  /** QA helper: replace the catalog (used by debug tooling). */
  setProducts(products: readonly StoreProduct[]): void {
    this.products = [...products];
  }

  /** QA helper: plan the next purchase outcome. */
  setNextStatus(status: PurchaseResult['status'] | null): void {
    this.nextStatus = status;
  }

  dispose(): void {
    this.ready = false;
  }
}
