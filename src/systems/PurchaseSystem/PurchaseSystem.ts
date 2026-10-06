import { logger } from '@/core/Logger';
import type { EventBus } from '@/core/events/EventBus';
import type { PurchaseService, StoreProduct } from '@/core/types/services';
import type { EconomySystem } from '@/systems/EconomySystem/EconomySystem';

/**
 * PURCHASE SYSTEM
 * ===============
 * Wraps the store provider and converts a completed purchase into an explicit,
 * catalog-driven grant. It exists so that:
 *
 * - **No store product id is ever hard-coded in gameplay code.** The catalog
 *   (`src/config/content/store_catalog.ts`) maps a product to its grants/entitlement, and
 *   the provider maps the product to a platform SKU.
 * - No scene or UI component calls the store directly.
 * - Purchases always grant through EconomySystem with a `purchase.*` reason tag, so
 *   paid currency is distinguishable from earned currency in the ledger.
 *
 * Phase 0 ships an EMPTY catalog and a mock provider: there are no real product ids and
 * no billing integration. Real providers (Apple/Google/Web) plug in behind
 * `PurchaseService` without touching this class.
 */

export interface StoreCatalogEntry {
  /** Store-agnostic key used by the game. */
  readonly productId: string;
  readonly displayName: string;
  readonly description: string;
  readonly kind: StoreProduct['kind'];
  /** Currency granted on purchase (consumables and gem packs). */
  readonly grants?: { readonly coins?: number; readonly gems?: number };
  /** Entitlement name for non-consumables (removeAds, vip, ...). */
  readonly entitlement?: string;
}

export type PurchaseStatus =
  | 'completed'
  | 'cancelled'
  | 'pending'
  | 'failed'
  | 'unavailable'
  | 'not-in-catalog';

export interface PurchaseOutcome {
  readonly status: PurchaseStatus;
  readonly productId: string;
  readonly grantedCoins: number;
  readonly grantedGems: number;
  readonly entitlement: string | null;
  readonly message: string;
}

export class PurchaseSystem {
  private catalog: readonly StoreCatalogEntry[];
  private products: readonly StoreProduct[] = [];
  private initialized = false;
  private readonly entitlements = new Set<string>();
  private readonly ownedProducts = new Set<string>();

  constructor(
    private readonly economy: EconomySystem,
    private readonly service: PurchaseService,
    private readonly events: EventBus,
    catalog: readonly StoreCatalogEntry[] = [],
  ) {
    this.catalog = catalog;
  }

  get providerName(): string {
    return this.service.providerName;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** Catalog entries currently offered to the player (empty in Phase 0). */
  getCatalog(): readonly StoreCatalogEntry[] {
    return this.catalog;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.service.initialize();
    this.products = await this.service.getProducts();
    this.initialized = true;
    logger.info('purchase', `store ready (${this.providerName}), ${this.products.length} product(s)`);
  }

  /** Platform product metadata (localised price, etc.) keyed by productId. */
  getStoreProducts(): readonly StoreProduct[] {
    return this.products;
  }

  getLocalizedPrice(productId: string): string | null {
    return this.products.find((product) => product.productId === productId)?.localizedPrice ?? null;
  }

  ownsProduct(productId: string): boolean {
    return this.ownedProducts.has(productId);
  }

  hasEntitlement(name: string): boolean {
    return this.entitlements.has(name);
  }

  /** Restores non-consumable entitlements (required on iOS/Android). */
  async restore(): Promise<readonly string[]> {
    await this.initialize();
    const restored = await this.service.restore();
    for (const productId of restored) {
      this.ownedProducts.add(productId);
      const entry = this.catalog.find((item) => item.productId === productId);
      if (entry?.entitlement) this.entitlements.add(entry.entitlement);
    }
    return restored;
  }

  /**
   * Runs a purchase and applies its grants.
   * The catalog is authoritative: an unknown product id is refused instead of granted
   * blindly, which is what protects the economy from provider/metadata mismatches.
   */
  async purchase(productId: string): Promise<PurchaseOutcome> {
    await this.initialize();

    const entry = this.catalog.find((item) => item.productId === productId);
    if (!entry) {
      logger.warn('purchase', `purchase refused: "${productId}" is not in the catalog`);
      return this.outcome('not-in-catalog', productId, 'Product is not available', 0, 0, null);
    }

    const result = await this.service.purchase(productId);
    switch (result.status) {
      case 'purchased': {
        if (entry.kind === 'nonConsumable') this.ownedProducts.add(productId);

        const grantedCoins = entry.grants?.coins
          ? this.economy.addCoins(entry.grants.coins, `purchase.${productId}`)
          : 0;
        const grantedGems = entry.grants?.gems
          ? this.economy.addGems(entry.grants.gems, `purchase.${productId}`)
          : 0;

        if (entry.entitlement) this.entitlements.add(entry.entitlement);

        this.events.emit('purchase:completed', {
          productId,
          currency: entry.grants?.gems ? 'gems' : 'coins',
          amount: entry.grants?.gems ?? entry.grants?.coins ?? 0,
        });

        logger.info('purchase', `completed ${productId}`, { grantedCoins, grantedGems });
        return this.outcome('completed', productId, 'Thank you!', grantedCoins, grantedGems, entry.entitlement ?? null);
      }
      case 'cancelled':
        return this.outcome('cancelled', productId, 'Purchase cancelled', 0, 0, null);
      case 'pending':
        // Never grant on "pending": the platform confirmation may never arrive.
        return this.outcome('pending', productId, 'Waiting for confirmation', 0, 0, null);
      case 'unavailable':
        return this.outcome('unavailable', productId, 'Store unavailable', 0, 0, null);
      default:
        return this.outcome('failed', productId, result.error ?? 'Purchase failed', 0, 0, null);
    }
  }

  /** Replaces the catalog (debug/QA and live-ops tooling). */
  setCatalog(catalog: readonly StoreCatalogEntry[]): void {
    this.catalog = catalog;
  }

  private outcome(
    status: PurchaseStatus,
    productId: string,
    message: string,
    grantedCoins: number,
    grantedGems: number,
    entitlement: string | null,
  ): PurchaseOutcome {
    return { status, productId, grantedCoins, grantedGems, entitlement, message };
  }
}
