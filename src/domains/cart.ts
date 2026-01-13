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
			this.adapter = options.adapter;
		}
	}

	/** Initialize cart (load from storage, then sync with server) */
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
					message: e instanceof Error ? e.message : "Failed to fetch cart",
					originalError: e,
					operation: "initialize",
				});
			}
		} else {
			// No adapter, just use local storage or create empty cart
			if (!current.data) {
				this.setData({ items: [] });
			}
			this.setState("ready");
		}
		this.clog.debug("initialize complete", { itemCount: this.getItemCount() });
	}

	/**
	 * Add item to cart with optimistic update.
	 * If the product already exists, its quantity is incremented.
	 *
	 * @param item - The cart item to add (product_id and quantity required)
	 * @emits cart:item:added - On successful addition
	 */
	async addItem(item: CartItem): Promise<void> {
		this.clog.debug("addItem", { productId: item.product_id, quantity: item.quantity });
		await this.withOptimisticUpdate(
			"addItem",
			() => {
				// Optimistic: update local state immediately
				const current = this.store.get().data ?? { items: [] };
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

				this.setData({ items: newItems }, false);
			},
			async () => {
				// Server sync
				if (this.adapter) {
					return await this.adapter.addItem(item, this.context);
				}
				return this.store.get().data;
			},
			(serverData) => {
				// On success, use server data if available
				if (serverData) {
					this.setData(serverData);
				}
				this.emit({
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
		this.clog.debug("updateItemQuantity", { productId, quantity });
		if (quantity <= 0) {
			return this.removeItem(productId);
		}

		const current = this.store.get().data;
		const existingItem = current?.items.find((i) => i.product_id === productId);
		const previousQuantity = existingItem?.quantity ?? 0;

		await this.withOptimisticUpdate(
			"updateItem",
			() => {
				const items = current?.items ?? [];
				const newItems = items.map((i) =>
					i.product_id === productId ? { ...i, quantity } : i
				);
				this.setData({ items: newItems }, false);
			},
			async () => {
				if (this.adapter) {
					return await this.adapter.updateItem(productId, quantity, this.context);
				}
				return this.store.get().data;
			},
			(serverData) => {
				if (serverData) {
					this.setData(serverData);
				}
				this.emit({
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
		const data = this.store.get().data;
		return data?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
	}

	/**
	 * Check if a product is in the cart.
	 *
	 * @param productId - The product ID to check
	 * @returns True if the product is in the cart
	 */
	hasProduct(productId: UUID): boolean {
		const data = this.store.get().data;
		return data?.items.some((i) => i.product_id === productId) ?? false;
	}

	/**
	 * Get a cart item by product ID.
	 *
	 * @param productId - The product ID to find
	 * @returns The cart item or undefined if not found
	 */
	getItem(productId: UUID): CartItem | undefined {
		const data = this.store.get().data;
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
		const data = this.store.get().data;
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
