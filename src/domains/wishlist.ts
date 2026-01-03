/**
 * Wishlist domain manager with optimistic updates and localStorage persistence.
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

export class WishlistManager extends BaseDomainManager<WishlistData, WishlistAdapter> {
	constructor(options: WishlistManagerOptions = {}) {
		super("wishlist", {
			...options,
			// Wishlist defaults to localStorage persistence
			storageKey: options.storageKey ?? "ecsuite:wishlist",
			storageType: options.storageType ?? "local",
		});

		if (options.adapter) {
			this._adapter = options.adapter;
		}
	}

	/** Initialize wishlist (load from storage, then sync with server) */
	async initialize(): Promise<void> {
		this._clog.debug("initialize start");
		const current = this._store.get();

		// If we have persisted data, use it immediately
		if (current.data) {
			this._setState("ready");
		}

		// Then sync with server if adapter is available
		if (this._adapter) {
			this._setState("syncing");
			try {
				const result = await this._adapter.fetch(this._context);
				if (result.success && result.data) {
					this._setData(result.data);
					this._markSynced();
				} else if (result.error) {
					this._setError({
						code: result.error.code,
						message: result.error.message,
						operation: "initialize",
					});
				}
			} catch (e) {
				this._setError({
					code: "FETCH_FAILED",
					message: e instanceof Error ? e.message : "Failed to fetch wishlist",
					originalError: e,
					operation: "initialize",
				});
			}
		} else {
			// No adapter, just use local storage or create empty wishlist
			if (!current.data) {
				this._setData({ items: [] });
			}
			this._setState("ready");
		}
		this._clog.debug("initialize complete", { itemCount: this.getItemCount() });
	}

	/** Add item to wishlist with optimistic update */
	async addItem(productId: UUID): Promise<void> {
		this._clog.debug("addItem", { productId });
		// Check if already in wishlist
		const current = this._store.get().data ?? { items: [] };
		if (current.items.some((i) => i.product_id === productId)) {
			return; // Already in wishlist, no-op
		}

		const newItem: WishlistItem = {
			product_id: productId,
			added_at: Date.now(),
		};

		await this._withOptimisticUpdate(
			"addItem",
			() => {
				const items = [...current.items, newItem];
				this._setData({ items }, false);
			},
			async () => {
				if (this._adapter) {
					const result = await this._adapter.addItem(productId, this._context);
					if (!result.success) {
						throw new Error(result.error?.message ?? "Failed to add item");
					}
					return result.data;
				}
				return this._store.get().data;
			},
			(serverData) => {
				if (serverData) {
					this._setData(serverData);
				}
				this._emit({
					type: "wishlist:item:added",
					domain: "wishlist",
					timestamp: Date.now(),
					productId,
				});
			}
		);
	}

	/** Remove item from wishlist */
	async removeItem(productId: UUID): Promise<void> {
		this._clog.debug("removeItem", { productId });
		await this._withOptimisticUpdate(
			"removeItem",
			() => {
				const current = this._store.get().data ?? { items: [] };
				const newItems = current.items.filter((i) => i.product_id !== productId);
				this._setData({ items: newItems }, false);
			},
			async () => {
				if (this._adapter) {
					const result = await this._adapter.removeItem(productId, this._context);
					if (!result.success) {
						throw new Error(result.error?.message ?? "Failed to remove item");
					}
					return result.data;
				}
				return this._store.get().data;
			},
			(serverData) => {
				if (serverData) {
					this._setData(serverData);
				}
				this._emit({
					type: "wishlist:item:removed",
					domain: "wishlist",
					timestamp: Date.now(),
					productId,
				});
			}
		);
	}

	/** Toggle item in wishlist (add if not present, remove if present) */
	async toggleItem(productId: UUID): Promise<boolean> {
		this._clog.debug("toggleItem", { productId });
		if (this.hasProduct(productId)) {
			await this.removeItem(productId);
			return false;
		} else {
			await this.addItem(productId);
			return true;
		}
	}

	/** Clear wishlist */
	async clear(): Promise<void> {
		this._clog.debug("clear");
		await this._withOptimisticUpdate(
			"clear",
			() => {
				this._setData({ items: [] }, false);
			},
			async () => {
				if (this._adapter) {
					const result = await this._adapter.clear(this._context);
					if (!result.success) {
						throw new Error(result.error?.message ?? "Failed to clear wishlist");
					}
					return result.data;
				}
				return { items: [] };
			},
			() => {
				this._emit({
					type: "wishlist:cleared",
					domain: "wishlist",
					timestamp: Date.now(),
				});
			}
		);
	}

	/** Get total item count */
	getItemCount(): number {
		const data = this._store.get().data;
		return data?.items.length ?? 0;
	}

	/** Check if product is in wishlist */
	hasProduct(productId: UUID): boolean {
		const data = this._store.get().data;
		return data?.items.some((i) => i.product_id === productId) ?? false;
	}

	/** Get item by product ID */
	getItem(productId: UUID): WishlistItem | undefined {
		const data = this._store.get().data;
		return data?.items.find((i) => i.product_id === productId);
	}

	/** Get all product IDs in wishlist */
	getProductIds(): UUID[] {
		const data = this._store.get().data;
		return data?.items.map((i) => i.product_id) ?? [];
	}

	/** Get wishlist items enriched with product data */
	async getEnrichedItems(productManager: ProductManager): Promise<EnrichedWishlistItem[]> {
		const data = this._store.get().data;
		if (!data?.items.length) return [];

		const productIds = data.items.map((i) => i.product_id);
		const products = await productManager.getByIds(productIds);

		return data.items.map((item) => ({
			...item,
			product: products.get(item.product_id) ?? null,
		}));
	}
}
