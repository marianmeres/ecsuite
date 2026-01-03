/**
 * Mock cart adapter for testing.
 */

import type { CartData, CartItem, UUID } from "@marianmeres/collection-types";
import type { AdapterResult, CartAdapter } from "../../types/adapter.ts";
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

	const maybeError = (operation: string): AdapterResult<CartData> | null => {
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
		async fetch(_ctx: DomainContext): Promise<AdapterResult<CartData>> {
			await wait();
			const error = maybeError("fetch");
			if (error) return error;
			return { success: true, data: structuredClone(cart) };
		},

		async addItem(
			item: CartItem,
			_ctx: DomainContext
		): Promise<AdapterResult<CartData>> {
			await wait();
			const error = maybeError("addItem");
			if (error) return error;

			const existingIndex = cart.items.findIndex(
				(i) => i.product_id === item.product_id
			);
			if (existingIndex >= 0) {
				cart.items[existingIndex].quantity += item.quantity;
			} else {
				cart.items.push({ ...item });
			}

			return { success: true, data: structuredClone(cart) };
		},

		async updateItem(
			productId: UUID,
			quantity: number,
			_ctx: DomainContext
		): Promise<AdapterResult<CartData>> {
			await wait();
			const error = maybeError("updateItem");
			if (error) return error;

			const index = cart.items.findIndex((i) => i.product_id === productId);
			if (index >= 0) {
				if (quantity <= 0) {
					cart.items.splice(index, 1);
				} else {
					cart.items[index].quantity = quantity;
				}
			}

			return { success: true, data: structuredClone(cart) };
		},

		async removeItem(
			productId: UUID,
			_ctx: DomainContext
		): Promise<AdapterResult<CartData>> {
			await wait();
			const error = maybeError("removeItem");
			if (error) return error;

			cart.items = cart.items.filter((i) => i.product_id !== productId);
			return { success: true, data: structuredClone(cart) };
		},

		async clear(_ctx: DomainContext): Promise<AdapterResult<CartData>> {
			await wait();
			const error = maybeError("clear");
			if (error) return error;

			cart = { items: [] };
			return { success: true, data: structuredClone(cart) };
		},

		async sync(
			newCart: CartData,
			_ctx: DomainContext
		): Promise<AdapterResult<CartData>> {
			await wait();
			const error = maybeError("sync");
			if (error) return error;

			cart = structuredClone(newCart);
			return { success: true, data: structuredClone(cart) };
		},
	};
}
