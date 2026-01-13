/**
 * Mock cart adapter for testing.
 */

import type { CartData, CartItem, UUID } from "@marianmeres/collection-types";
import { HTTP_ERROR } from "@marianmeres/http-utils";
import type { CartAdapter } from "../../types/adapter.ts";
import type { DomainContext } from "../../types/state.ts";

/** Mock cart adapter options */
export interface MockCartAdapterOptions {
	/** Initial cart data */
	initialData?: CartData;
	/** Simulated network delay in ms (default: 50) */
	delay?: number;
	/** Force errors for testing */
	forceError?: {
		operation?: "fetch" | "addItem" | "updateItem" | "removeItem" | "clear" | "sync";
		code?: string;
		message?: string;
	};
}

/** Create a mock cart adapter for testing */
export function createMockCartAdapter(options: MockCartAdapterOptions = {}): CartAdapter {
	const delay = options.delay ?? 50;
	let cart: CartData = options.initialData
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
		async fetch(_ctx: DomainContext): Promise<CartData> {
			await wait();
			maybeThrow("fetch");
			return structuredClone(cart);
		},

		async addItem(item: CartItem, _ctx: DomainContext): Promise<CartData> {
			await wait();
			maybeThrow("addItem");

			const existingIndex = cart.items.findIndex(
				(i) => i.product_id === item.product_id
			);
			if (existingIndex >= 0) {
				cart.items[existingIndex].quantity += item.quantity;
			} else {
				cart.items.push({ ...item });
			}

			return structuredClone(cart);
		},

		async updateItem(
			productId: UUID,
			quantity: number,
			_ctx: DomainContext
		): Promise<CartData> {
			await wait();
			maybeThrow("updateItem");

			const index = cart.items.findIndex((i) => i.product_id === productId);
			if (index >= 0) {
				if (quantity <= 0) {
					cart.items.splice(index, 1);
				} else {
					cart.items[index].quantity = quantity;
				}
			}

			return structuredClone(cart);
		},

		async removeItem(productId: UUID, _ctx: DomainContext): Promise<CartData> {
			await wait();
			maybeThrow("removeItem");

			cart.items = cart.items.filter((i) => i.product_id !== productId);
			return structuredClone(cart);
		},

		async clear(_ctx: DomainContext): Promise<CartData> {
			await wait();
			maybeThrow("clear");

			cart = { items: [] };
			return structuredClone(cart);
		},

		async sync(newCart: CartData, _ctx: DomainContext): Promise<CartData> {
			await wait();
			maybeThrow("sync");

			cart = structuredClone(newCart);
			return structuredClone(cart);
		},
	};
}
