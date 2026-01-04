/**
 * @module domains/product
 *
 * Product domain manager with in-memory caching.
 *
 * Read-only domain for fetching product data with caching support.
 * Does not use state machine - just a simple cache layer.
 */

import { createClog } from "@marianmeres/clog";
import { createPubSub, type PubSub } from "@marianmeres/pubsub";
import type { ProductData, UUID } from "@marianmeres/collection-types";
import type { ProductAdapter } from "../types/adapter.ts";
import type { DomainContext } from "../types/state.ts";
import type { ProductFetchedEvent } from "../types/events.ts";

/** Cache entry with expiration */
interface CacheEntry {
	data: ProductData;
	expiresAt: number;
}

/** Options for ProductManager */
export interface ProductManagerOptions {
	/** Product adapter for server communication */
	adapter?: ProductAdapter;
	/** Initial context (customerId, sessionId) */
	context?: DomainContext;
	/** Shared pubsub instance for events */
	pubsub?: PubSub;
	/** Cache TTL in milliseconds (default: 5 minutes) */
	cacheTtl?: number;
}

/**
 * Product manager with in-memory caching.
 *
 * Unlike other domain managers, ProductManager uses a simple cache layer
 * instead of a full state machine. Products are fetched on-demand and cached
 * with a configurable TTL.
 *
 * Features:
 * - In-memory cache with TTL expiration
 * - Single and batch product fetching
 * - Prefetching support for UI optimization
 * - Event emission on fetch
 *
 * @example
 * ```typescript
 * const products = new ProductManager({
 *   adapter: myProductAdapter,
 *   cacheTtl: 10 * 60 * 1000, // 10 minutes
 * });
 *
 * const product = await products.getById("prod-123");
 * const many = await products.getByIds(["prod-1", "prod-2"]);
 * ```
 */
export class ProductManager {
	private readonly _clog = createClog("ecsuite:product", { color: "auto" });
	private readonly _pubsub: PubSub;
	private _adapter: ProductAdapter | null = null;
	private _context: DomainContext = {};
	private _cache = new Map<UUID, CacheEntry>();
	private _cacheTtl: number;

	constructor(options: ProductManagerOptions = {}) {
		this._adapter = options.adapter ?? null;
		this._context = options.context ?? {};
		this._pubsub = options.pubsub ?? createPubSub();
		this._cacheTtl = options.cacheTtl ?? 5 * 60 * 1000; // 5 minutes default
		this._clog.debug("initialized", { cacheTtl: this._cacheTtl });
	}

	/**
	 * Set the product adapter for server communication.
	 *
	 * @param adapter - The ProductAdapter implementation
	 */
	setAdapter(adapter: ProductAdapter): void {
		this._adapter = adapter;
		this._clog.debug("adapter set");
	}

	/**
	 * Get the current adapter.
	 *
	 * @returns The adapter or null if not set
	 */
	getAdapter(): ProductAdapter | null {
		return this._adapter;
	}

	/**
	 * Update context (customerId, sessionId).
	 *
	 * @param context - Context to merge with existing context
	 */
	setContext(context: DomainContext): void {
		this._context = { ...this._context, ...context };
	}

	/**
	 * Get the current context.
	 *
	 * @returns Copy of the current context
	 */
	getContext(): DomainContext {
		return { ...this._context };
	}

	/**
	 * Get a single product by ID.
	 * Returns from cache if valid, otherwise fetches from server.
	 *
	 * @param productId - The product ID to fetch
	 * @returns The product data or null if not found/error
	 * @emits product:fetched - On successful server fetch
	 */
	async getById(productId: UUID): Promise<ProductData | null> {
		// Check cache first
		const cached = this._getFromCache(productId);
		if (cached) {
			return cached;
		}

		// Fetch from server
		if (!this._adapter) {
			this._clog.debug("getById: no adapter", { productId });
			return null;
		}

		this._clog.debug("getById: fetching", { productId });
		try {
			const result = await this._adapter.fetchOne(productId, this._context);
			if (result.success && result.data) {
				this._setCache(productId, result.data);
				this._emitFetched(productId);
				return result.data;
			}
			return null;
		} catch (e) {
			this._clog.error("getById failed", { productId, error: e });
			return null;
		}
	}

	/**
	 * Get multiple products by IDs.
	 * Returns from cache when available, fetches missing products in batch.
	 *
	 * @param productIds - Array of product IDs to fetch
	 * @returns Map of productId to ProductData
	 * @emits product:fetched - For each product fetched from server
	 */
	async getByIds(productIds: UUID[]): Promise<Map<UUID, ProductData>> {
		const result = new Map<UUID, ProductData>();
		const missingIds: UUID[] = [];

		// Check cache for each product
		for (const id of productIds) {
			const cached = this._getFromCache(id);
			if (cached) {
				result.set(id, cached);
			} else {
				missingIds.push(id);
			}
		}

		// Fetch missing from server
		if (missingIds.length > 0 && this._adapter) {
			this._clog.debug("getByIds: fetching missing", {
				total: productIds.length,
				cached: result.size,
				missing: missingIds.length,
			});

			try {
				const fetchResult = await this._adapter.fetchMany(missingIds, this._context);
				if (fetchResult.success && fetchResult.data) {
					for (const product of fetchResult.data) {
						// Products from collection-types have model_id
						const productId = (product as ProductData & { model_id?: UUID }).model_id;
						if (productId) {
							this._setCache(productId, product);
							result.set(productId, product);
							this._emitFetched(productId);
						}
					}
				}
			} catch (e) {
				this._clog.error("getByIds failed", { missingIds, error: e });
			}
		}

		return result;
	}

	/**
	 * Prefetch products into cache.
	 * Useful for preloading product data before rendering.
	 *
	 * @param productIds - Array of product IDs to prefetch
	 */
	async prefetch(productIds: UUID[]): Promise<void> {
		const missingIds = productIds.filter((id) => !this.isCached(id));
		if (missingIds.length === 0) return;

		this._clog.debug("prefetch", { count: missingIds.length });
		await this.getByIds(missingIds);
	}

	/**
	 * Clear the product cache entirely or for a specific product.
	 *
	 * @param productId - Optional product ID to clear (clears all if not provided)
	 */
	clearCache(productId?: UUID): void {
		if (productId) {
			this._cache.delete(productId);
			this._clog.debug("cache cleared for product", { productId });
		} else {
			this._cache.clear();
			this._clog.debug("cache cleared entirely");
		}
	}

	/**
	 * Check if a product is in the cache and not expired.
	 *
	 * @param productId - The product ID to check
	 * @returns True if the product is cached and valid
	 */
	isCached(productId: UUID): boolean {
		const entry = this._cache.get(productId);
		if (!entry) return false;
		return Date.now() < entry.expiresAt;
	}

	/**
	 * Get the current cache size.
	 *
	 * @returns Number of cached products (includes expired entries)
	 */
	getCacheSize(): number {
		return this._cache.size;
	}

	/** Get product from cache if valid */
	private _getFromCache(productId: UUID): ProductData | null {
		const entry = this._cache.get(productId);
		if (!entry) return null;

		if (Date.now() >= entry.expiresAt) {
			// Expired, remove from cache
			this._cache.delete(productId);
			return null;
		}

		return entry.data;
	}

	/** Set product in cache */
	private _setCache(productId: UUID, data: ProductData): void {
		this._cache.set(productId, {
			data,
			expiresAt: Date.now() + this._cacheTtl,
		});
	}

	/** Emit product:fetched event */
	private _emitFetched(productId: UUID): void {
		const event: ProductFetchedEvent = {
			type: "product:fetched",
			domain: "product",
			timestamp: Date.now(),
			productId,
		};
		this._pubsub.publish(event.type, event);
	}
}
