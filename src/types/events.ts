/**
 * Event type definitions for the ECSuite event system.
 */

import type { UUID } from "@marianmeres/collection-types";
import type { DomainError, DomainState } from "./state.ts";

/** Domain identifiers */
export type DomainName = "cart" | "wishlist" | "order" | "customer" | "payment" | "product";

/** Event types emitted by the suite */
export type ECSuiteEventType =
	| "domain:state:changed"
	| "domain:error"
	| "domain:synced"
	| "cart:item:added"
	| "cart:item:updated"
	| "cart:item:removed"
	| "cart:cleared"
	| "wishlist:item:added"
	| "wishlist:item:removed"
	| "wishlist:cleared"
	| "order:created"
	| "order:fetched"
	| "customer:updated"
	| "customer:fetched"
	| "payment:fetched"
	| "product:fetched";

/** Base event data */
export interface ECSuiteEventBase {
	/** Event timestamp */
	timestamp: number;
	/** Domain that emitted the event */
	domain: DomainName;
}

/** State change event */
export interface StateChangedEvent extends ECSuiteEventBase {
	type: "domain:state:changed";
	previousState: DomainState;
	newState: DomainState;
}

/** Error event */
export interface ErrorEvent extends ECSuiteEventBase {
	type: "domain:error";
	error: DomainError;
}

/** Sync completed event */
export interface SyncedEvent extends ECSuiteEventBase {
	type: "domain:synced";
}

/** Cart item added event */
export interface CartItemAddedEvent extends ECSuiteEventBase {
	type: "cart:item:added";
	domain: "cart";
	productId: UUID;
	quantity: number;
}

/** Cart item updated event */
export interface CartItemUpdatedEvent extends ECSuiteEventBase {
	type: "cart:item:updated";
	domain: "cart";
	productId: UUID;
	previousQuantity: number;
	newQuantity: number;
}

/** Cart item removed event */
export interface CartItemRemovedEvent extends ECSuiteEventBase {
	type: "cart:item:removed";
	domain: "cart";
	productId: UUID;
}

/** Cart cleared event */
export interface CartClearedEvent extends ECSuiteEventBase {
	type: "cart:cleared";
	domain: "cart";
}

/** Wishlist item added event */
export interface WishlistItemAddedEvent extends ECSuiteEventBase {
	type: "wishlist:item:added";
	domain: "wishlist";
	productId: UUID;
}

/** Wishlist item removed event */
export interface WishlistItemRemovedEvent extends ECSuiteEventBase {
	type: "wishlist:item:removed";
	domain: "wishlist";
	productId: UUID;
}

/** Wishlist cleared event */
export interface WishlistClearedEvent extends ECSuiteEventBase {
	type: "wishlist:cleared";
	domain: "wishlist";
}

/** Order created event */
export interface OrderCreatedEvent extends ECSuiteEventBase {
	type: "order:created";
	domain: "order";
	orderId?: UUID;
}

/** Order fetched event */
export interface OrderFetchedEvent extends ECSuiteEventBase {
	type: "order:fetched";
	domain: "order";
}

/** Customer updated event */
export interface CustomerUpdatedEvent extends ECSuiteEventBase {
	type: "customer:updated";
	domain: "customer";
}

/** Customer fetched event */
export interface CustomerFetchedEvent extends ECSuiteEventBase {
	type: "customer:fetched";
	domain: "customer";
}

/** Payment fetched event */
export interface PaymentFetchedEvent extends ECSuiteEventBase {
	type: "payment:fetched";
	domain: "payment";
}

/** Product fetched event */
export interface ProductFetchedEvent extends ECSuiteEventBase {
	type: "product:fetched";
	domain: "product";
	productId: UUID;
}

/** All event types union */
export type ECSuiteEvent =
	| StateChangedEvent
	| ErrorEvent
	| SyncedEvent
	| CartItemAddedEvent
	| CartItemUpdatedEvent
	| CartItemRemovedEvent
	| CartClearedEvent
	| WishlistItemAddedEvent
	| WishlistItemRemovedEvent
	| WishlistClearedEvent
	| OrderCreatedEvent
	| OrderFetchedEvent
	| CustomerUpdatedEvent
	| CustomerFetchedEvent
	| PaymentFetchedEvent
	| ProductFetchedEvent;
