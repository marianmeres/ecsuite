/**
 * Mock customer adapter for testing.
 */

import type { CustomerData } from "@marianmeres/collection-types";
import type { AdapterResult, CustomerAdapter } from "../../types/adapter.ts";
import type { DomainContext } from "../../types/state.ts";

/** Mock customer adapter options */
export interface MockCustomerAdapterOptions {
	/** Initial customer data */
	initialData?: CustomerData;
	/** Simulated network delay in ms (default: 50) */
	delay?: number;
	/** Force errors for testing */
	forceError?: {
		operation?: "fetch" | "update";
		code?: string;
		message?: string;
	};
}

/** Create a mock customer adapter for testing */
export function createMockCustomerAdapter(
	options: MockCustomerAdapterOptions = {}
): CustomerAdapter {
	const delay = options.delay ?? 50;
	let customer: CustomerData | null = options.initialData
		? structuredClone(options.initialData)
		: null;

	const wait = () => new Promise<void>((r) => setTimeout(r, delay));

	const maybeError = <T>(operation: string): AdapterResult<T> | null => {
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
		async fetch(_ctx: DomainContext): Promise<AdapterResult<CustomerData>> {
			await wait();
			const error = maybeError<CustomerData>("fetch");
			if (error) return error;

			if (!customer) {
				return {
					success: false,
					error: {
						code: "NOT_FOUND",
						message: "Customer not found",
					},
				};
			}

			return { success: true, data: structuredClone(customer) };
		},

		async update(
			data: Partial<CustomerData>,
			_ctx: DomainContext
		): Promise<AdapterResult<CustomerData>> {
			await wait();
			const error = maybeError<CustomerData>("update");
			if (error) return error;

			if (!customer) {
				return {
					success: false,
					error: {
						code: "NOT_FOUND",
						message: "Customer not found",
					},
				};
			}

			customer = { ...customer, ...data };
			return { success: true, data: structuredClone(customer) };
		},
	};
}
