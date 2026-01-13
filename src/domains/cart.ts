/**
 * @module domains/cart
 *
 * Cart domain manager with optimistic updates and localStorage persistence.
 * Manages shopping cart state with automatic server synchronization.
 */

import type { CartData, CartItem, UUID } from "@marianmeres/collection-types";
import type { CartAdapter } from "../types/adapter.ts";
import type { EnrichedCartItem } from "../types/state.ts";
import { BaseDomainManager, type BaseDomainOptions } from "./base.ts";
import type { ProductManager } from "./product.ts";

export interface CartManagerOptions extends BaseDomainOptions {
	/** Cart adapter for server communication */
	adapter?: CartAdapter;
}

/**
 * Cart domain manager with optimistic updates and localStorage persistence.
 *
 * Features:
 * - Automatic localStorage persistence (configurable)
 * - Optimistic updates with automatic rollback on server error
 * - Server synchronization via CartAdapter
 * - Enriched items with product data support
 *
 * @example
 * ```typescript
 * const cart = new CartManager({ adapter: myCartAdapter });
 * await cart.initialize();
 *
 * await cart.addItem({ product_id: "prod-1", quantity: 2 });
 * console.log(cart.getItemCount()); // 2
 * ```
 */
export class CartManager extends BaseDomainManager<CartData, CartAdapter> {
	constructor(options: CartManagerOptions = {}) {
		super("cart", {
			...options,
			// Cart defaults to localStorage persistence
			storageKey: options.storageKey ?? "ecsuite:cart",
			storageType: options.storageType ?? "local",
		});

		if (options.adapter) {
			this._adapter = options.adapter;
		}
	}

	/** Initialize cart (load from storage, then sync with server) */
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
				const data = await this._adapter.fetch(this._context);
				this._setData(data);
				this._markSynced();
			} catch (e) {
				this._setError({
					code: "FETCH_FAILED",
					message: e instanceof Error ? e.message : "Failed to fetch cart",
					originalError: e,
					operation: "initialize",
				});
			}
		} else {
			// No adapter, just use local storage or create empty cart
			if (!current.data) {
				this._setData({ items: [] });
			}
			this._setState("ready");
		}
		this._clog.debug("initialize complete", { itemCount: this.getItemCount() });
	}

	/**
	 * Add item to cart with optimistic update.
	 * If the product already exists, its quantity is incremented.
	 *
	 * @param item - The cart item to add (product_id and quantity required)
	 * @emits cart:item:added - On successful addition
	 */
	async addItem(item: CartItem): Promise<void> {
		this._clog.debug("addItem", { productId: item.product_id, quantity: item.quantity });
		await this._withOptimisticUpdate(
			"addItem",
			() => {
				// Optimistic: update local state immediately
				const current = this._store.get().data ?? { items: [] };
				const existingIndex = current.items.findIndex(
					(i) => i.product_id === item.product_id
				);

				let newItems: CartItem[];
				if (existingIndex >= 0) {
					// Update quantity
					newItems = [...current.items];
					newItems[existingIndex] = {
						...newItems[existingIndex],
						quantity: newItems[existingIndex].quantity + item.quantity,
					};
				} else {
					// Add new item
					newItems = [...current.items, item];
				}

				this._setData({ items: newItems }, false);
			},
			async () => {
				// Server sync
				if (this._adapter) {
					return await this._adapter.addItem(item, this._context);
				}
				return this._store.get().data;
			},
			(serverData) => {
				// On success, use server data if available
				if (serverData) {
					this._setData(serverData);
				}
				this._emit({
					type: "cart:item:added",
					domain: "cart",
					timestamp: Date.now(),
					productId: item.product_id,
					quantity: item.quantity,
				});
			}
		);
	}

	/**
	 * Update the quantity of an item in the cart.
	 * If quantity is 0 or less, the item is removed.
	 *
	 * @param productId - The product ID to update
	 * @param quantity - The new quantity (removes item if <= 0)
	 * @emits cart:item:updated - On successful update
	 */
	async updateItemQuantity(productId: UUID, quantity: number): Promise<void> {
		this._clog.debug("updateItemQuantity", { productId, quantity });
		if (quantity <= 0) {
			return this.removeItem(productId);
		}

		const current = this._store.get().data;
		const existingItem = current?.items.find((i) => i.product_id === productId);
		const previousQuantity = existingItem?.quantity ?? 0;

		await this._withOptimisticUpdate(
			"updateItem",
			() => {
				const items = current?.items ?? [];
				const newItems = items.map((i) =>
					i.product_id === productId ? { ...i, quantity } : i
				);
				this._setData({ items: newItems }, false);
			},
			async () => {
				if (this._adapter) {
					return await this._adapter.updateItem(productId, quantity, this._context);
				}
				return this._store.get().data;
			},
			(serverData) => {
				if (serverData) {
					this._setData(serverData);
				}
				this._emit({
					type: "cart:item:updated",
					domain: "cart",
					timestamp: Date.now(),
					productId,
					previousQuantity,
					newQuantity: quantity,
				});
			}
		);
	}

	/**
	 * Remove an item from the cart.
	 *
	 * @param productId - The product ID to remove
	 * @emits cart:item:removed - On successful removal
	 */
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
					return await this._adapter.removeItem(productId, this._context);
				}
				return this._store.get().data;
			},
			(serverData) => {
				if (serverData) {
					this._setData(serverData);
				}
				this._emit({
					type: "cart:item:removed",
					domain: "cart",
					timestamp: Date.now(),
					productId,
				});
			}
		);
	}

	/**
	 * Clear all items from the cart.
	 *
	 * @emits cart:cleared - On successful clear
	 */
	async clear(): Promise<void> {
		this._clog.debug("clear");
		await this._withOptimisticUpdate(
			"clear",
			() => {
				this._setData({ items: [] }, false);
			},
			async () => {
				if (this._adapter) {
					return await this._adapter.clear(this._context);
				}
				return { items: [] };
			},
			() => {
				this._emit({
					type: "cart:cleared",
					domain: "cart",
					timestamp: Date.now(),
				});
			}
		);
	}

	/**
	 * Get the total number of items in the cart (sum of all quantities).
	 *
	 * @returns Total item count
	 */
	getItemCount(): number {
		const data = this._store.get().data;
		return data?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
	}

	/**
	 * Check if a product is in the cart.
	 *
	 * @param productId - The product ID to check
	 * @returns True if the product is in the cart
	 */
	hasProduct(productId: UUID): boolean {
		const data = this._store.get().data;
		return data?.items.some((i) => i.product_id === productId) ?? false;
	}

	/**
	 * Get a cart item by product ID.
	 *
	 * @param productId - The product ID to find
	 * @returns The cart item or undefined if not found
	 */
	getItem(productId: UUID): CartItem | undefined {
		const data = this._store.get().data;
		return data?.items.find((i) => i.product_id === productId);
	}

	/**
	 * Get cart items enriched with product data.
	 * Fetches product details and calculates line totals.
	 *
	 * @param productManager - The ProductManager to fetch product data from
	 * @returns Array of enriched cart items with product data and line totals
	 */
	async getEnrichedItems(productManager: ProductManager): Promise<EnrichedCartItem[]> {
		const data = this._store.get().data;
		if (!data?.items.length) return [];

		const productIds = data.items.map((i) => i.product_id);
		const products = await productManager.getByIds(productIds);

		return data.items.map((item) => {
			const product = products.get(item.product_id) ?? null;
			const price = product?.price ?? 0;
			return {
				...item,
				product,
				lineTotal: item.quantity * price,
			};
		});
	}
}
