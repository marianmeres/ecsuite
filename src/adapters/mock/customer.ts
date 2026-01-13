/**
 * Mock customer adapter for testing.
 */

import type { CustomerData } from "@marianmeres/collection-types";
import { HTTP_ERROR } from "@marianmeres/http-utils";
import type { CustomerAdapter } from "../../types/adapter.ts";
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

	const maybeThrow = (operation: string): void => {
		if (options.forceError?.operation === operation) {
			throw new HTTP_ERROR.BadRequest(
				options.forceError.message ?? `Mock error for ${operation}`
			);
		}
	};

	return {
		async fetch(_ctx: DomainContext): Promise<CustomerData> {
			await wait();
			maybeThrow("fetch");

			if (!customer) {
				throw new HTTP_ERROR.NotFound("Customer not found");
			}

			return structuredClone(customer);
		},

		async update(
			data: Partial<CustomerData>,
			_ctx: DomainContext
		): Promise<CustomerData> {
			await wait();
			maybeThrow("update");

			if (!customer) {
				throw new HTTP_ERROR.NotFound("Customer not found");
			}

			customer = { ...customer, ...data };
			return structuredClone(customer);
		},
	};
}
