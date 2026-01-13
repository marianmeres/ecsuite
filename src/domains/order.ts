/**
 * @module domains/order
 *
 * Order domain manager - read + create only, no local persistence.
 * Manages order state with server-side data as source of truth.
 */

import type { OrderData, UUID } from "@marianmeres/collection-types";
import { HTTP_ERROR } from "@marianmeres/http-utils";
import type { OrderAdapter, OrderCreatePayload } from "../types/adapter.ts";
import { BaseDomainManager, type BaseDomainOptions } from "./base.ts";

/** Order list data (array of orders) */
export interface OrderListData {
	orders: OrderData[];
}

export interface OrderManagerOptions extends BaseDomainOptions {
	/** Order adapter for server communication */
	adapter?: OrderAdapter;
}

/**
 * Order domain manager - read + create only, no local persistence.
 *
 * Features:
 * - Server-side data source (no local persistence)
 * - Fetch all orders or individual orders
 * - Create new orders
 * - Order list management
 *
 * @example
 * ```typescript
 * const orders = new OrderManager({ adapter: myOrderAdapter });
 * await orders.initialize();
 *
 * const newOrder = await orders.create({ items: [...], total: 100 });
 * console.log(orders.getOrderCount());
 * ```
 */
export class OrderManager extends BaseDomainManager<OrderListData, OrderAdapter> {
	constructor(options: OrderManagerOptions = {}) {
		super("order", {
			...options,
			// Orders are NOT persisted locally
			storageType: null,
		});

		if (options.adapter) {
			this.adapter = options.adapter;
		}
	}

	/** Initialize by fetching orders from server */
	async initialize(): Promise<void> {
		this.clog.debug("initialize start");
		if (!this.adapter) {
			// No adapter, set empty orders and mark ready
			this.setData({ orders: [] });
			this.setState("ready");
			this.clog.debug("initialize complete (no adapter)");
			return;
		}

		this.setState("syncing");
		try {
			const data = await this.adapter.fetchAll(this.context);
			this.setData({ orders: data });
			this.markSynced();
		} catch (e) {
			this.setError({
				code: "FETCH_FAILED",
				message: e instanceof Error ? e.message : "Failed to fetch orders",
				originalError: e,
				operation: "initialize",
			});
		}
		this.clog.debug("initialize complete", { orderCount: this.getOrderCount() });
	}

	/**
	 * Fetch all orders from the server.
	 * Replaces the current order list with server data.
	 *
	 * @emits order:fetched - On successful fetch
	 */
	async fetchAll(): Promise<void> {
		this.clog.debug("fetchAll");
		if (!this.adapter) {
			return;
		}

		this.setState("syncing");
		try {
			const data = await this.adapter.fetchAll(this.context);
			this.setData({ orders: data });
			this.markSynced();
			this.emit({
				type: "order:fetched",
				domain: "order",
				timestamp: Date.now(),
			});
		} catch (e) {
			this.setError({
				code: "FETCH_FAILED",
				message: e instanceof Error ? e.message : "Failed to fetch orders",
				originalError: e,
				operation: "fetchAll",
			});
		}
	}

	/**
	 * Fetch a single order by ID from the server.
	 * Updates or adds the order to the local list.
	 *
	 * @param orderId - The order ID to fetch
	 * @returns The fetched order or null on error
	 */
	async fetchOne(orderId: UUID): Promise<OrderData | null> {
		this.clog.debug("fetchOne", { orderId });
		if (!this.adapter) {
			return null;
		}

		this.setState("syncing");
		try {
			const data = await this.adapter.fetchOne(orderId, this.context);
			// Update the order in our local list
			const current = this.store.get().data ?? { orders: [] };
			const existingIndex = current.orders.findIndex(
				(o) => (o as OrderData & { model_id?: UUID }).model_id === orderId
			);

			let orders: OrderData[];
			if (existingIndex >= 0) {
				orders = [...current.orders];
				orders[existingIndex] = data;
			} else {
				orders = [...current.orders, data];
			}

			this.setData({ orders });
			this.markSynced();
			return data;
		} catch (e) {
			const isNotFound = e instanceof HTTP_ERROR.NotFound;
			this.setError({
				code: isNotFound ? "NOT_FOUND" : "FETCH_FAILED",
				message: e instanceof Error ? e.message : "Failed to fetch order",
				originalError: e,
				operation: "fetchOne",
			});
		}
		return null;
	}

	/**
	 * Create a new order.
	 * The order status is assigned by the server.
	 *
	 * @param orderData - The order data (without status)
	 * @returns The created order or null on error
	 * @emits order:created - On successful creation
	 */
	async create(orderData: OrderCreatePayload): Promise<OrderData | null> {
		this.clog.debug("create");
		if (!this.adapter) {
			return null;
		}

		this.setState("syncing");
		try {
			const data = await this.adapter.create(orderData, this.context);
			// Add the new order to our local list
			const current = this.store.get().data ?? { orders: [] };
			this.setData({ orders: [...current.orders, data] });
			this.markSynced();
			this.emit({
				type: "order:created",
				domain: "order",
				timestamp: Date.now(),
				orderId: (data as OrderData & { model_id?: UUID }).model_id,
			});
			return data;
		} catch (e) {
			this.setError({
				code: "CREATE_FAILED",
				message: e instanceof Error ? e.message : "Failed to create order",
				originalError: e,
				operation: "create",
			});
		}
		return null;
	}

	/**
	 * Get the total number of orders.
	 *
	 * @returns Total order count
	 */
	getOrderCount(): number {
		return this.store.get().data?.orders.length ?? 0;
	}

	/**
	 * Get all orders.
	 *
	 * @returns Array of orders
	 */
	getOrders(): OrderData[] {
		return this.store.get().data?.orders ?? [];
	}

	/**
	 * Get an order by its index in the list.
	 *
	 * @param index - The index in the orders array
	 * @returns The order or undefined if index is out of bounds
	 */
	getOrderByIndex(index: number): OrderData | undefined {
		return this.store.get().data?.orders[index];
	}
}
