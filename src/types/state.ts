/**
 * @module types/state
 *
 * Domain state and context type definitions.
 * Core types for domain state management and data structures.
 */

import type {
	CartItem,
	ProductData,
	UUID,
	WishlistItem,
} from "@marianmeres/collection-types";

/** Domain state progression */
export type DomainState = "initializing" | "ready" | "syncing" | "error";

/** Error information structure */
export interface DomainError {
	/** Error code for programmatic handling */
	code: string;
	/** Human-readable message */
	message: string;
	/** Operation that failed */
	operation: string;
	/** Original error for debugging */
	originalError?: unknown;
}

/** Base state wrapper for all domains */
export interface DomainStateWrapper<T> {
	/** Current domain state */
	state: DomainState;
	/** Domain data (null during initialization or after critical error) */
	data: T | null;
	/** Error information when state is "error" */
	error: DomainError | null;
	/** Timestamp of last successful sync */
	lastSyncedAt: number | null;
}

/** Context passed to adapters and events */
export interface DomainContext {
	/** Optional customer ID */
	customerId?: UUID;
	/** Optional session ID */
	sessionId?: UUID;
	/** Additional context properties for adapter-specific needs */
	[key: string]: unknown;
}

// WishlistItem and WishlistData are now provided by @marianmeres/collection-types
export type { WishlistData, WishlistItem } from "@marianmeres/collection-types";

/** Cart item enriched with product data */
export interface EnrichedCartItem extends CartItem {
	/** Product data (null if not found) */
	product: ProductData | null;
	/** Line total: quantity * price (0 if no product or price) */
	lineTotal: number;
}

/** Wishlist item enriched with product data */
export interface EnrichedWishlistItem extends WishlistItem {
	/** Product data (null if not found) */
	product: ProductData | null;
}
