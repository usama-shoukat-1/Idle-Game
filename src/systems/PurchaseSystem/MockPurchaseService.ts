/**
 * Development/mock purchase service.
 *
 * No store SDK, no store product ids: prices come from the provider at runtime in
 * a real implementation, and the mock simply returns obviously-fake labels. This
 * keeps the purchase flow testable without a merchant account.
 */

import type { MockPurchaseOptions, PurchaseResult, PurchaseService, StoreProduct } from '@/core/types/monetization';
import type { ProductId } from '@/core/types/ids';
import { Rng } from '@/core/utils/rng';
import { createLogger } from '@/core/utils/logger';

export class MockPurchaseService implements PurchaseService {
  readonly providerName = 'mock-store';
  private readonly log = createLogger('purchase:mock');
  private readonly rng: Rng;
  private available: boolean;
  private readonly latencyMs: number;
  private readonly forcedStatus?: PurchaseResult['status'];
  private readonly cancelledProbability: number;
  private transactionCounter = 0;
  private readonly owned = new Set<ProductId>();

  constructor(options: MockPurchaseOptions = {}, seed = 99) {
    this.available = options.available ?? true;
    this.latencyMs = Math.max(0, options.latencyMs ?? 200);
    this.forcedStatus = options.forcedStatus;
    this.cancelledProbability = Math.min(1, Math.max(0, options.cancelledProbability ?? 0.1));
    this.rng = new Rng(seed);
  }

  isAvailable(): boolean {
    return this.available;
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }

  /** Mock price labels - a real provider supplies localized prices. */
  async listProducts(productIds: ProductId[]): Promise<StoreProduct[]> {
    if (!this.available) return [];
    return productIds.map((productId) => ({
      productId,
      priceLabel: `MOCK ${(productId.length % 5) + 1}.99`,
      available: true,
    }));
  }

  async purchase(productId: ProductId): Promise<PurchaseResult> {
    if (!this.available) {
      return { productId, status: 'unavailable', message: 'mock store unavailable' };
    }
    if (this.latencyMs > 0) await delay(this.latencyMs);

    if (this.forcedStatus) {
      return { productId, status: this.forcedStatus, message: `forced:${this.forcedStatus}` };
    }
    if (this.rng.next() < this.cancelledProbability) {
      return { productId, status: 'cancelled', message: 'player cancelled the mock purchase' };
    }

    this.transactionCounter += 1;
    this.owned.add(productId);
    this.log.debug(`mock purchase completed for ${productId}`);
    return { productId, status: 'completed', transactionId: `mock-tx-${this.transactionCounter}` };
  }

  async restore(): Promise<PurchaseResult[]> {
    if (!this.available) return [];
    return [...this.owned].map((productId) => ({
      productId,
      status: 'completed' as const,
      transactionId: 'mock-restore',
    }));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
