/**
 * @module types/adapter
 *
 * Adapter interface definitions for server communication.
 * Implement these interfaces to connect ECSuite to your backend.
 */

import type {
	CartData,
	CartItem,
	CustomerData,
	OrderData,
	PaymentData,
	ProductData,
	UUID,
} from "@marianmeres/collection-types";
import type { DomainContext, WishlistData } from "./state.ts";

/** Base adapter result */
export interface AdapterResult<T> {
	success: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
	};
}

/** Cart adapter interface */
export interface CartAdapter {
	/** Fetch current cart from server */
	fetch(ctx: DomainContext): Promise<AdapterResult<CartData>>;
	/** Add item to cart */
	addItem(item: CartItem, ctx: DomainContext): Promise<AdapterResult<CartData>>;
	/** Update item quantity */
	updateItem(
		productId: UUID,
		quantity: number,
		ctx: DomainContext
	): Promise<AdapterResult<CartData>>;
	/** Remove item from cart */
	removeItem(productId: UUID, ctx: DomainContext): Promise<AdapterResult<CartData>>;
	/** Clear all items */
	clear(ctx: DomainContext): Promise<AdapterResult<CartData>>;
	/** Sync full cart state (for optimistic update reconciliation) */
	sync(cart: CartData, ctx: DomainContext): Promise<AdapterResult<CartData>>;
}

/** Wishlist adapter interface */
export interface WishlistAdapter {
	/** Fetch current wishlist from server */
	fetch(ctx: DomainContext): Promise<AdapterResult<WishlistData>>;
	/** Add item to wishlist */
	addItem(productId: UUID, ctx: DomainContext): Promise<AdapterResult<WishlistData>>;
	/** Remove item from wishlist */
	removeItem(productId: UUID, ctx: DomainContext): Promise<AdapterResult<WishlistData>>;
	/** Clear all items */
	clear(ctx: DomainContext): Promise<AdapterResult<WishlistData>>;
	/** Sync full wishlist state */
	sync(wishlist: WishlistData, ctx: DomainContext): Promise<AdapterResult<WishlistData>>;
}

/** Order create payload (status is set by server) */
export type OrderCreatePayload = Omit<OrderData, "status">;

/** Order adapter interface (read + create only) */
export interface OrderAdapter {
	/** Fetch all orders for customer */
	fetchAll(ctx: DomainContext): Promise<AdapterResult<OrderData[]>>;
	/** Fetch single order by ID */
	fetchOne(orderId: UUID, ctx: DomainContext): Promise<AdapterResult<OrderData>>;
	/** Create new order */
	create(order: OrderCreatePayload, ctx: DomainContext): Promise<AdapterResult<OrderData>>;
}

/** Customer adapter interface (read + limited update) */
export interface CustomerAdapter {
	/** Fetch customer data */
	fetch(ctx: DomainContext): Promise<AdapterResult<CustomerData>>;
	/** Update customer data (partial) */
	update(
		data: Partial<CustomerData>,
		ctx: DomainContext
	): Promise<AdapterResult<CustomerData>>;
}

/** Payment adapter interface (read-only) */
export interface PaymentAdapter {
	/** Fetch payments for an order */
	fetchForOrder(orderId: UUID, ctx: DomainContext): Promise<AdapterResult<PaymentData[]>>;
	/** Fetch single payment by ID */
	fetchOne(paymentId: UUID, ctx: DomainContext): Promise<AdapterResult<PaymentData>>;
}

/** Product adapter interface (read-only with batch support) */
export interface ProductAdapter {
	/** Fetch single product by ID */
	fetchOne(productId: UUID, ctx: DomainContext): Promise<AdapterResult<ProductData>>;
	/** Fetch multiple products by IDs */
	fetchMany(productIds: UUID[], ctx: DomainContext): Promise<AdapterResult<ProductData[]>>;
}
