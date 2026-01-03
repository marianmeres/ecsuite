/**
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

/** Product manager with caching */
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

	/** Set the adapter */
	setAdapter(adapter: ProductAdapter): void {
		this._adapter = adapter;
		this._clog.debug("adapter set");
	}

	/** Get the adapter (may be null) */
	getAdapter(): ProductAdapter | null {
		return this._adapter;
	}

	/** Update context (customerId, sessionId) */
	setContext(context: DomainContext): void {
		this._context = { ...this._context, ...context };
	}

	/** Get the current context */
	getContext(): DomainContext {
		return { ...this._context };
	}

	/**
	 * Get single product by ID.
	 * Returns from cache if valid, otherwise fetches from server.
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
	 * Returns a Map of productId -> ProductData.
	 * Fetches missing products from server in batch.
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
	 */
	async prefetch(productIds: UUID[]): Promise<void> {
		const missingIds = productIds.filter((id) => !this.isCached(id));
		if (missingIds.length === 0) return;

		this._clog.debug("prefetch", { count: missingIds.length });
		await this.getByIds(missingIds);
	}

	/**
	 * Clear cache entirely or for a specific product.
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
	 * Check if product is in cache and not expired.
	 */
	isCached(productId: UUID): boolean {
		const entry = this._cache.get(productId);
		if (!entry) return false;
		return Date.now() < entry.expiresAt;
	}

	/**
	 * Get cache size (number of cached products).
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
