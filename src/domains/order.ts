/**
 * @module domains/order
 *
 * Order domain manager - read + create only, no local persistence.
 * Manages order state with server-side data as source of truth.
 */

import type { OrderData, UUID } from "@marianmeres/collection-types";
import { HTTP_ERROR } from "@marianmeres/http-utils";
import type {
	OrderAdapter,
	OrderCreatePayload,
	OrderCreateResult,
} from "../types/adapter.ts";
import { BaseDomainManager, type BaseDomainOptions } from "./base.ts";

/**
 * Order list data — array of `{ model_id, data }` envelopes so each order is
 * uniquely identifiable by its server-assigned `model_id`. (Bare `OrderData`
 * has no id field, only an open index signature.)
 */
export interface OrderListData {
	orders: OrderCreateResult[];
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
 * - Order list management keyed by `model_id`
 *
 * @example
 * ```typescript
 * const orders = new OrderManager({ adapter: myOrderAdapter });
 * await orders.initialize();
 *
 * const result = await orders.create({ items: [...], total: 100 });
 * console.log(result.model_id, result.data);
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
	 * Updates or adds the order to the local list, keyed by `model_id`.
	 *
	 * @param orderId - The order ID to fetch
	 * @returns The fetched order envelope or null on error
	 */
	async fetchOne(orderId: UUID): Promise<OrderCreateResult | null> {
		this.clog.debug("fetchOne", { orderId });
		if (!this.adapter) {
			return null;
		}

		this.setState("syncing");
		try {
			const result = await this.adapter.fetchOne(orderId, this.context);
			const current = this.store.get().data ?? { orders: [] };
			const existingIndex = current.orders.findIndex(
				(o) => o.model_id === result.model_id,
			);

			let orders: OrderCreateResult[];
			if (existingIndex >= 0) {
				orders = [...current.orders];
				orders[existingIndex] = result;
			} else {
				orders = [...current.orders, result];
			}

			this.setData({ orders });
			this.markSynced();
			return result;
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
	 * @returns The created order envelope (with model_id) or null on error
	 * @emits order:created - On successful creation
	 */
	async create(
		orderData: OrderCreatePayload,
	): Promise<OrderCreateResult | null> {
		this.clog.debug("create");
		if (!this.adapter) {
			return null;
		}

		this.setState("syncing");
		try {
			const result = await this.adapter.create(
				orderData,
				this.context,
			);
			const current = this.store.get().data ?? { orders: [] };
			this.setData({
				orders: [...current.orders, result],
			});
			this.markSynced();
			this.emit({
				type: "order:created",
				domain: "order",
				timestamp: Date.now(),
				orderId: result.model_id,
			});
			return result;
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
	 * Get all order envelopes (`{ model_id, data }`).
	 *
	 * @returns Array of order envelopes
	 */
	getOrders(): OrderCreateResult[] {
		return this.store.get().data?.orders ?? [];
	}

	/**
	 * Get an order envelope by its `model_id`.
	 *
	 * @param modelId - The order's server-assigned model id
	 * @returns The order envelope or undefined if not found
	 */
	getOrderById(modelId: UUID): OrderCreateResult | undefined {
		return this.store.get().data?.orders.find((o) => o.model_id === modelId);
	}

	/**
	 * Get the bare `OrderData` for an order by its `model_id`.
	 *
	 * @param modelId - The order's server-assigned model id
	 * @returns The order data or undefined if not found
	 */
	getOrderDataById(modelId: UUID): OrderData | undefined {
		return this.getOrderById(modelId)?.data;
	}

	/**
	 * Get an order envelope by its index in the list.
	 *
	 * @param index - The index in the orders array
	 * @returns The order envelope or undefined if index is out of bounds
	 */
	getOrderByIndex(index: number): OrderCreateResult | undefined {
		return this.store.get().data?.orders[index];
	}
}
