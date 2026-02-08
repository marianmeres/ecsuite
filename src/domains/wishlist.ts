/**
 * @module domains/wishlist
 *
 * Wishlist domain manager with optimistic updates and localStorage persistence.
 * Manages wishlist state with automatic server synchronization.
 */

import type { UUID } from "@marianmeres/collection-types";
import type { WishlistAdapter } from "../types/adapter.ts";
import type { EnrichedWishlistItem, WishlistData, WishlistItem } from "../types/state.ts";
import { BaseDomainManager, type BaseDomainOptions } from "./base.ts";
import type { ProductManager } from "./product.ts";

export interface WishlistManagerOptions extends BaseDomainOptions {
	/** Wishlist adapter for server communication */
	adapter?: WishlistAdapter;
}

/**
 * Wishlist domain manager with optimistic updates and localStorage persistence.
 *
 * Features:
 * - Automatic localStorage persistence (configurable)
 * - Optimistic updates with automatic rollback on server error
 * - Server synchronization via WishlistAdapter
 * - Toggle functionality for easy add/remove
 * - Enriched items with product data support
 *
 * @example
 * ```typescript
 * const wishlist = new WishlistManager({ adapter: myWishlistAdapter });
 * await wishlist.initialize();
 *
 * await wishlist.toggleItem("prod-1"); // Adds item
 * await wishlist.toggleItem("prod-1"); // Removes item
 * ```
 */
export class WishlistManager extends BaseDomainManager<WishlistData, WishlistAdapter> {
	constructor(options: WishlistManagerOptions = {}) {
		super("wishlist", {
			...options,
			// Wishlist defaults to localStorage persistence
			storageKey: options.storageKey ?? "ecsuite:wishlist",
			storageType: options.storageType ?? "local",
		});

		if (options.adapter) {
			this.adapter = options.adapter;
		}
	}

	/** Initialize wishlist (load from storage, then sync with server) */
	async initialize(): Promise<void> {
		this.clog.debug("initialize start");
		const current = this.store.get();

		// If we have persisted data, use it immediately
		if (current.data) {
			this.setState("ready");
		}

		// Then sync with server if adapter is available
		if (this.adapter) {
			this.setState("syncing");
			try {
				const data = await this.adapter.fetch(this.context);
				this.setData(data);
				this.markSynced();
			} catch (e) {
				this.setError({
					code: "FETCH_FAILED",
					message: e instanceof Error ? e.message : "Failed to fetch wishlist",
					originalError: e,
					operation: "initialize",
				});
			}
		} else {
			// No adapter, just use local storage or create empty wishlist
			if (!current.data) {
				this.setData({ items: [] });
			}
			this.setState("ready");
		}
		this.clog.debug("initialize complete", { itemCount: this.getItemCount() });
	}

	/**
	 * Add a product to the wishlist.
	 * No-op if the product is already in the wishlist.
	 *
	 * @param productId - The product ID to add
	 * @emits wishlist:item:added - On successful addition
	 */
	async addItem(productId: UUID): Promise<void> {
		this.clog.debug("addItem", { productId });
		// Check if already in wishlist
		const current = this.store.get().data ?? { items: [] };
		if (current.items.some((i) => i.product_id === productId)) {
			return; // Already in wishlist, no-op
		}

		const newItem: WishlistItem = {
			product_id: productId,
			added_at: Date.now(),
		};

		await this.withOptimisticUpdate(
			"addItem",
			() => {
				const items = [...current.items, newItem];
				this.setData({ items }, false);
			},
			async () => {
				if (this.adapter) {
					return await this.adapter.addItem(productId, this.context);
				}
				return this.store.get().data;
			},
			(serverData) => {
				if (serverData) {
					this.setData(serverData);
				}
				this.emit({
					type: "wishlist:item:added",
					domain: "wishlist",
					timestamp: Date.now(),
					productId,
				});
			},
		);
	}

	/**
	 * Remove a product from the wishlist.
	 *
	 * @param productId - The product ID to remove
	 * @emits wishlist:item:removed - On successful removal
	 */
	async removeItem(productId: UUID): Promise<void> {
		this.clog.debug("removeItem", { productId });
		await this.withOptimisticUpdate(
			"removeItem",
			() => {
				const current = this.store.get().data ?? { items: [] };
				const newItems = current.items.filter((i) => i.product_id !== productId);
				this.setData({ items: newItems }, false);
			},
			async () => {
				if (this.adapter) {
					return await this.adapter.removeItem(productId, this.context);
				}
				return this.store.get().data;
			},
			(serverData) => {
				if (serverData) {
					this.setData(serverData);
				}
				this.emit({
					type: "wishlist:item:removed",
					domain: "wishlist",
					timestamp: Date.now(),
					productId,
				});
			},
		);
	}

	/**
	 * Toggle a product in the wishlist.
	 * Adds the product if not present, removes it if present.
	 *
	 * @param productId - The product ID to toggle
	 * @returns True if the item was added, false if removed
	 */
	async toggleItem(productId: UUID): Promise<boolean> {
		this.clog.debug("toggleItem", { productId });
		if (this.hasProduct(productId)) {
			await this.removeItem(productId);
			return false;
		} else {
			await this.addItem(productId);
			return true;
		}
	}

	/**
	 * Clear all items from the wishlist.
	 *
	 * @emits wishlist:cleared - On successful clear
	 */
	async clear(): Promise<void> {
		this.clog.debug("clear");
		await this.withOptimisticUpdate(
			"clear",
			() => {
				this.setData({ items: [] }, false);
			},
			async () => {
				if (this.adapter) {
					return await this.adapter.clear(this.context);
				}
				return { items: [] };
			},
			() => {
				this.emit({
					type: "wishlist:cleared",
					domain: "wishlist",
					timestamp: Date.now(),
				});
			},
		);
	}

	/**
	 * Get the total number of items in the wishlist.
	 *
	 * @returns Total item count
	 */
	getItemCount(): number {
		const data = this.store.get().data;
		return data?.items.length ?? 0;
	}

	/**
	 * Check if a product is in the wishlist.
	 *
	 * @param productId - The product ID to check
	 * @returns True if the product is in the wishlist
	 */
	hasProduct(productId: UUID): boolean {
		const data = this.store.get().data;
		return data?.items.some((i) => i.product_id === productId) ?? false;
	}

	/**
	 * Get a wishlist item by product ID.
	 *
	 * @param productId - The product ID to find
	 * @returns The wishlist item or undefined if not found
	 */
	getItem(productId: UUID): WishlistItem | undefined {
		const data = this.store.get().data;
		return data?.items.find((i) => i.product_id === productId);
	}

	/**
	 * Get all product IDs in the wishlist.
	 *
	 * @returns Array of product IDs
	 */
	getProductIds(): UUID[] {
		const data = this.store.get().data;
		return data?.items.map((i) => i.product_id) ?? [];
	}

	/**
	 * Get wishlist items enriched with product data.
	 *
	 * @param productManager - The ProductManager to fetch product data from
	 * @returns Array of enriched wishlist items with product data
	 */
	async getEnrichedItems(
		productManager: ProductManager,
	): Promise<EnrichedWishlistItem[]> {
		const data = this.store.get().data;
		if (!data?.items.length) return [];

		const productIds = data.items.map((i) => i.product_id);
		const products = await productManager.getByIds(productIds);

		return data.items.map((item) => ({
			...item,
			product: products.get(item.product_id) ?? null,
		}));
	}
}
