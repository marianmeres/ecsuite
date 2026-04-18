/**
 * @module domains/product
 *
 * Product domain manager with in-memory caching.
 *
 * Read-only domain for fetching product data with TTL caching. Extends
 * `BaseDomainManager` for unified observability (subscribe, domain:error,
 * domain:state:changed) but the per-product cache itself is held in a
 * private Map — the store's `data` is null because there is no single
 * aggregate state worth subscribing to (use `getCacheSize()` /
 * `isCached()` for cache introspection).
 */

import type { ProductData, UUID } from "@marianmeres/collection-types";
import type { ProductAdapter } from "../types/adapter.ts";
import { BaseDomainManager, type BaseDomainOptions } from "./base.ts";
import type { ProductFetchedEvent } from "../types/events.ts";

/** Cache entry with expiration */
interface CacheEntry {
	data: ProductData;
	expiresAt: number;
}

/** Options for ProductManager */
export interface ProductManagerOptions extends BaseDomainOptions {
	/** Product adapter for server communication */
	adapter?: ProductAdapter;
	/** Cache TTL in milliseconds (default: 5 minutes) */
	cacheTtl?: number;
}

/**
 * Product manager with in-memory TTL caching.
 *
 * Extends `BaseDomainManager` for unified observability (Svelte-compatible
 * `subscribe`, `domain:state:changed`, `domain:error` events) but skips the
 * per-product state machine — fetching a single product never transitions
 * the whole domain into "syncing" because that would be misleading.
 *
 * Features:
 * - In-memory cache with per-entry TTL expiration
 * - Single and batch product fetching
 * - In-flight request dedup (cache stampede prevention)
 * - Prefetching support for UI optimization
 * - `domain:error` event emission on adapter failures
 *
 * @example
 * ```typescript
 * const products = new ProductManager({
 *   adapter: myProductAdapter,
 *   cacheTtl: 10 * 60 * 1000, // 10 minutes
 * });
 * await products.initialize();
 *
 * const product = await products.getById("prod-123");
 * const many = await products.getByIds(["prod-1", "prod-2"]);
 * ```
 */
export class ProductManager extends BaseDomainManager<null, ProductAdapter> {
	#cache = new Map<UUID, CacheEntry>();
	#cacheTtl: number;
	/** Pending fetches by id, used to dedup concurrent callers (D8). */
	#inflight = new Map<UUID, Promise<ProductData | null>>();

	constructor(options: ProductManagerOptions = {}) {
		super("product", {
			...options,
			// Cache lives in a private Map; the store's `data` carries no
			// aggregate so persistence is meaningless here.
			storageType: null,
		});

		if (options.adapter) {
			this.adapter = options.adapter;
		}

		this.#cacheTtl = options.cacheTtl ?? 5 * 60 * 1000;
	}

	/**
	 * Initialize. Lazy domain — there's nothing to fetch eagerly. Just
	 * transitions to "ready" so consumers can rely on the same readiness
	 * contract as other domains.
	 */
	initialize(): Promise<void> {
		this.clog.debug("initialize");
		this.setState("ready");
		return Promise.resolve();
	}

	/**
	 * Get a single product by ID.
	 * Returns from cache if valid, otherwise fetches from server. Concurrent
	 * callers for the same id share a single in-flight request.
	 *
	 * @param productId - The product ID to fetch
	 * @returns The product data or null if not found / no adapter
	 * @emits product:fetched - On successful server fetch
	 * @emits domain:error - On adapter failure
	 */
	async getById(productId: UUID): Promise<ProductData | null> {
		const cached = this.#getFromCache(productId);
		if (cached) return cached;

		if (!this.adapter) {
			this.clog.debug("getById: no adapter", { productId });
			return null;
		}

		// Dedup concurrent callers (cache stampede prevention)
		const pending = this.#inflight.get(productId);
		if (pending) return pending;

		const promise = (async () => {
			this.clog.debug("getById: fetching", { productId });
			try {
				const data = await this.adapter!.fetchOne(productId, this.context);
				this.#setCache(productId, data);
				this.#emitFetched(productId);
				return data;
			} catch (e) {
				this.#emitError("getById", e, { productId });
				return null;
			} finally {
				this.#inflight.delete(productId);
			}
		})();

		this.#inflight.set(productId, promise);
		return promise;
	}

	/**
	 * Get multiple products by IDs.
	 * Returns from cache when available, fetches missing products in batch.
	 *
	 * @param productIds - Array of product IDs to fetch
	 * @returns Map of productId to ProductData
	 * @emits product:fetched - For each product fetched from server
	 * @emits domain:error - On adapter failure
	 */
	async getByIds(productIds: UUID[]): Promise<Map<UUID, ProductData>> {
		const result = new Map<UUID, ProductData>();
		const missingIds: UUID[] = [];

		for (const id of productIds) {
			const cached = this.#getFromCache(id);
			if (cached) {
				result.set(id, cached);
			} else {
				missingIds.push(id);
			}
		}

		if (missingIds.length > 0 && this.adapter) {
			this.clog.debug("getByIds: fetching missing", {
				total: productIds.length,
				cached: result.size,
				missing: missingIds.length,
			});

			try {
				const fetchedData = await this.adapter.fetchMany(
					missingIds,
					this.context,
				);
				for (const product of fetchedData) {
					const productId =
						(product as ProductData & { model_id?: UUID }).model_id;
					if (productId) {
						this.#setCache(productId, product);
						result.set(productId, product);
						this.#emitFetched(productId);
					}
				}
			} catch (e) {
				this.#emitError("getByIds", e, { missingIds });
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

		this.clog.debug("prefetch", { count: missingIds.length });
		await this.getByIds(missingIds);
	}

	/**
	 * Clear the product cache entirely or for a specific product.
	 *
	 * @param productId - Optional product ID to clear (clears all if not provided)
	 */
	clearCache(productId?: UUID): void {
		if (productId) {
			this.#cache.delete(productId);
			this.clog.debug("cache cleared for product", { productId });
		} else {
			this.#cache.clear();
			this.clog.debug("cache cleared entirely");
		}
	}

	/**
	 * Check if a product is in the cache and not expired.
	 *
	 * @param productId - The product ID to check
	 * @returns True if the product is cached and valid
	 */
	isCached(productId: UUID): boolean {
		const entry = this.#cache.get(productId);
		if (!entry) return false;
		return Date.now() < entry.expiresAt;
	}

	/**
	 * Get the current cache size.
	 *
	 * @returns Number of cached products (includes expired entries)
	 */
	getCacheSize(): number {
		return this.#cache.size;
	}

	/** Reset clears the cache too (overrides base reset). */
	override reset(): void {
		this.#cache.clear();
		this.#inflight.clear();
		super.reset();
	}

	/** Get product from cache if valid */
	#getFromCache(productId: UUID): ProductData | null {
		const entry = this.#cache.get(productId);
		if (!entry) return null;

		if (Date.now() >= entry.expiresAt) {
			this.#cache.delete(productId);
			return null;
		}

		return entry.data;
	}

	/** Set product in cache */
	#setCache(productId: UUID, data: ProductData): void {
		this.#cache.set(productId, {
			data,
			expiresAt: Date.now() + this.#cacheTtl,
		});
	}

	/** Emit product:fetched event */
	#emitFetched(productId: UUID): void {
		const event: ProductFetchedEvent = {
			type: "product:fetched",
			domain: "product",
			timestamp: Date.now(),
			productId,
		};
		this.pubsub.publish(event.type, event);
	}

	/**
	 * Emit `domain:error` without changing state. A single failed product
	 * fetch should not blanket the whole domain in "error" — other cached
	 * lookups remain valid.
	 */
	#emitError(operation: string, e: unknown, context: Record<string, unknown>): void {
		this.clog.error(`${operation} failed`, { ...context, error: e });
		this.emit({
			type: "domain:error",
			domain: "product",
			timestamp: Date.now(),
			error: {
				code: "FETCH_FAILED",
				message: e instanceof Error ? e.message : "Failed to fetch",
				operation,
				originalError: e,
			},
		});
	}
}
