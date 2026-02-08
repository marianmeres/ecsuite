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
	OrderCreateResult,
	OrderData,
	PaymentData,
	PaymentInitConfig,
	PaymentIntent,
	ProductData,
	UUID,
} from "@marianmeres/collection-types";
import type { DomainContext, WishlistData } from "./state.ts";

/** Cart adapter interface */
export interface CartAdapter {
	/** Fetch current cart from server */
	fetch(ctx: DomainContext): Promise<CartData>;
	/** Add item to cart */
	addItem(item: CartItem, ctx: DomainContext): Promise<CartData>;
	/** Update item quantity */
	updateItem(productId: UUID, quantity: number, ctx: DomainContext): Promise<CartData>;
	/** Remove item from cart */
	removeItem(productId: UUID, ctx: DomainContext): Promise<CartData>;
	/** Clear all items */
	clear(ctx: DomainContext): Promise<CartData>;
	/** Sync full cart state (for optimistic update reconciliation) */
	sync(cart: CartData, ctx: DomainContext): Promise<CartData>;
}

/** Wishlist adapter interface */
export interface WishlistAdapter {
	/** Fetch current wishlist from server */
	fetch(ctx: DomainContext): Promise<WishlistData>;
	/** Add item to wishlist */
	addItem(productId: UUID, ctx: DomainContext): Promise<WishlistData>;
	/** Remove item from wishlist */
	removeItem(productId: UUID, ctx: DomainContext): Promise<WishlistData>;
	/** Clear all items */
	clear(ctx: DomainContext): Promise<WishlistData>;
	/** Sync full wishlist state */
	sync(wishlist: WishlistData, ctx: DomainContext): Promise<WishlistData>;
}

/** Order create payload (status is set by server) */
export type OrderCreatePayload = Omit<OrderData, "status">;

// OrderCreateResult is now provided by @marianmeres/collection-types
export type { OrderCreateResult } from "@marianmeres/collection-types";

/** Order adapter interface (read + create) */
export interface OrderAdapter {
	/** Fetch all orders for customer */
	fetchAll(ctx: DomainContext): Promise<OrderData[]>;
	/** Fetch single order by ID */
	fetchOne(orderId: UUID, ctx: DomainContext): Promise<OrderData>;
	/** Create new order — returns data + model_id */
	create(
		order: OrderCreatePayload,
		ctx: DomainContext,
	): Promise<OrderCreateResult>;
}

/** Customer adapter interface (read + limited update) */
export interface CustomerAdapter {
	/** Fetch customer data (requires customerId in context) */
	fetch(ctx: DomainContext): Promise<CustomerData>;
	/** Optional: resolve customer by session when customerId is unknown */
	fetchBySession?(ctx: DomainContext): Promise<CustomerData | null>;
	/** Update customer data (partial) */
	update(
		data: Partial<CustomerData>,
		ctx: DomainContext,
	): Promise<CustomerData>;
}

// PaymentInitConfig is now provided by @marianmeres/collection-types
export type { PaymentInitConfig } from "@marianmeres/collection-types";

/** Payment adapter interface */
export interface PaymentAdapter {
	/** Fetch payments for an order */
	fetchForOrder(orderId: UUID, ctx: DomainContext): Promise<PaymentData[]>;
	/** Fetch single payment by ID */
	fetchOne(paymentId: UUID, ctx: DomainContext): Promise<PaymentData>;
	/** Optional: initiate a new payment for an order */
	initiate?(
		orderId: UUID,
		config: PaymentInitConfig,
		ctx: DomainContext,
	): Promise<PaymentIntent>;
	/** Optional: capture/confirm a payment */
	capture?(
		paymentId: UUID,
		ctx: DomainContext,
	): Promise<PaymentData>;
}

/** Product adapter interface (read-only with batch support) */
export interface ProductAdapter {
	/** Fetch single product by ID */
	fetchOne(productId: UUID, ctx: DomainContext): Promise<ProductData>;
	/** Fetch multiple products by IDs */
	fetchMany(productIds: UUID[], ctx: DomainContext): Promise<ProductData[]>;
}
