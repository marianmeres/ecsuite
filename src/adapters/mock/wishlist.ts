/**
 * Mock wishlist adapter for testing.
 */

import type { UUID } from "@marianmeres/collection-types";
import { HTTP_ERROR } from "@marianmeres/http-utils";
import type { WishlistAdapter } from "../../types/adapter.ts";
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

	const maybeThrow = (operation: string): void => {
		if (options.forceError?.operation === operation) {
			throw new HTTP_ERROR.BadRequest(
				options.forceError.message ?? `Mock error for ${operation}`
			);
		}
	};

	return {
		async fetch(_ctx: DomainContext): Promise<WishlistData> {
			await wait();
			maybeThrow("fetch");
			return structuredClone(wishlist);
		},

		async addItem(productId: UUID, _ctx: DomainContext): Promise<WishlistData> {
			await wait();
			maybeThrow("addItem");

			const exists = wishlist.items.some((i) => i.product_id === productId);
			if (!exists) {
				wishlist.items.push({
					product_id: productId,
					added_at: Date.now(),
				});
			}

			return structuredClone(wishlist);
		},

		async removeItem(productId: UUID, _ctx: DomainContext): Promise<WishlistData> {
			await wait();
			maybeThrow("removeItem");

			wishlist.items = wishlist.items.filter((i) => i.product_id !== productId);
			return structuredClone(wishlist);
		},

		async clear(_ctx: DomainContext): Promise<WishlistData> {
			await wait();
			maybeThrow("clear");

			wishlist = { items: [] };
			return structuredClone(wishlist);
		},

		async sync(newWishlist: WishlistData, _ctx: DomainContext): Promise<WishlistData> {
			await wait();
			maybeThrow("sync");

			wishlist = structuredClone(newWishlist);
			return structuredClone(wishlist);
		},
	};
}
