/**
 * Mock product adapter for testing.
 */

import type { ProductData, UUID } from "@marianmeres/collection-types";
import type { AdapterResult, ProductAdapter } from "../../types/adapter.ts";
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
	options: MockProductAdapterOptions = {}
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

	const maybeError = (
		operation: string
	): AdapterResult<ProductData> | AdapterResult<ProductData[]> | null => {
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
		async fetchOne(
			productId: UUID,
			_ctx: DomainContext
		): Promise<AdapterResult<ProductData>> {
			await wait();
			const error = maybeError("fetchOne");
			if (error) return error as AdapterResult<ProductData>;

			const product = products.get(productId);
			if (!product) {
				return {
					success: false,
					error: {
						code: "NOT_FOUND",
						message: `Product not found: ${productId}`,
					},
				};
			}

			return { success: true, data: structuredClone(product) };
		},

		async fetchMany(
			productIds: UUID[],
			_ctx: DomainContext
		): Promise<AdapterResult<ProductData[]>> {
			await wait();
			const error = maybeError("fetchMany");
			if (error) return error as AdapterResult<ProductData[]>;

			const found: StoredProduct[] = [];
			for (const id of productIds) {
				const product = products.get(id);
				if (product) {
					found.push(structuredClone(product));
				}
			}

			return { success: true, data: found };
		},
	};
}
