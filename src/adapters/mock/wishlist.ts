/**
 * Mock wishlist adapter for testing.
 */

import type { UUID } from "@marianmeres/collection-types";
import type { AdapterResult, WishlistAdapter } from "../../types/adapter.ts";
import type { DomainContext, WishlistData } from "../../types/state.ts";

/** Mock wishlist adapter options */
export interface MockWishlistAdapterOptions {
	/** Initial wishlist data */
	initialData?: WishlistData;
	/** Simulated network delay in ms (default: 50) */
	delay?: number;
	/** Force errors for testing */
	forceError?: {
		operation?: "fetch" | "addItem" | "removeItem" | "clear" | "sync";
		code?: string;
		message?: string;
	};
}

/** Create a mock wishlist adapter for testing */
export function createMockWishlistAdapter(
	options: MockWishlistAdapterOptions = {}
): WishlistAdapter {
	const delay = options.delay ?? 50;
	let wishlist: WishlistData = options.initialData
		? structuredClone(options.initialData)
		: { items: [] };

	const wait = () => new Promise<void>((r) => setTimeout(r, delay));

	const maybeError = (operation: string): AdapterResult<WishlistData> | null => {
		if (options.forceError?.operation === operation) {
			return {
				success: false,
				error: {
					code: options.forceError.code ?? "MOCK_ERROR",
					message: options.forceError.message ?? `Mock error for ${operation}`,
				},
			};
		}
		return null;
	};

	return {
		async fetch(_ctx: DomainContext): Promise<AdapterResult<WishlistData>> {
			await wait();
			const error = maybeError("fetch");
			if (error) return error;
			return { success: true, data: structuredClone(wishlist) };
		},

		async addItem(
			productId: UUID,
			_ctx: DomainContext
		): Promise<AdapterResult<WishlistData>> {
			await wait();
			const error = maybeError("addItem");
			if (error) return error;

			const exists = wishlist.items.some((i) => i.product_id === productId);
			if (!exists) {
				wishlist.items.push({
					product_id: productId,
					added_at: Date.now(),
				});
			}

			return { success: true, data: structuredClone(wishlist) };
		},

		async removeItem(
			productId: UUID,
			_ctx: DomainContext
		): Promise<AdapterResult<WishlistData>> {
			await wait();
			const error = maybeError("removeItem");
			if (error) return error;

			wishlist.items = wishlist.items.filter((i) => i.product_id !== productId);
			return { success: true, data: structuredClone(wishlist) };
		},

		async clear(_ctx: DomainContext): Promise<AdapterResult<WishlistData>> {
			await wait();
			const error = maybeError("clear");
			if (error) return error;

			wishlist = { items: [] };
			return { success: true, data: structuredClone(wishlist) };
		},

		async sync(
			newWishlist: WishlistData,
			_ctx: DomainContext
		): Promise<AdapterResult<WishlistData>> {
			await wait();
			const error = maybeError("sync");
			if (error) return error;

			wishlist = structuredClone(newWishlist);
			return { success: true, data: structuredClone(wishlist) };
		},
	};
}
