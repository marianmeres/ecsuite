/**
 * Mock product adapter for testing.
 */

import type { ProductData, UUID } from "@marianmeres/collection-types";
import { HTTP_ERROR } from "@marianmeres/http-utils";
import type { ProductAdapter } from "../../types/adapter.ts";
import type { DomainContext } from "../../types/state.ts";

/** Product with model_id for internal storage */
interface StoredProduct extends ProductData {
	model_id: UUID;
}

/** Mock product adapter options */
export interface MockProductAdapterOptions {
	/** Initial product catalog (each product must have a model_id) */
	products?: StoredProduct[];
	/** Simulated network delay in ms (default: 50) */
	delay?: number;
	/** Force errors for testing */
	forceError?: {
		operation?: "fetchOne" | "fetchMany";
		code?: string;
		message?: string;
	};
}

/** Create a mock product adapter for testing */
export function createMockProductAdapter(
	options: MockProductAdapterOptions = {},
): ProductAdapter {
	const delay = options.delay ?? 50;
	const products = new Map<UUID, StoredProduct>();

	// Populate products from options
	if (options.products) {
		for (const product of options.products) {
			products.set(product.model_id, structuredClone(product));
		}
	}

	const wait = () => new Promise<void>((r) => setTimeout(r, delay));

	const maybeThrow = (operation: string): void => {
		if (options.forceError?.operation === operation) {
			throw new HTTP_ERROR.BadRequest(
				options.forceError.message ?? `Mock error for ${operation}`,
			);
		}
	};

	return {
		async fetchOne(productId: UUID, _ctx: DomainContext): Promise<ProductData> {
			await wait();
			maybeThrow("fetchOne");

			const product = products.get(productId);
			if (!product) {
				throw new HTTP_ERROR.NotFound(`Product not found: ${productId}`);
			}

			return structuredClone(product);
		},

		async fetchMany(productIds: UUID[], _ctx: DomainContext): Promise<ProductData[]> {
			await wait();
			maybeThrow("fetchMany");

			const found: StoredProduct[] = [];
			for (const id of productIds) {
				const product = products.get(id);
				if (product) {
					found.push(structuredClone(product));
				}
			}

			return found;
		},
	};
}
