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
	/** Guest customer data returned by fetchBySession */
	guestData?: CustomerData;
	/** Simulated network delay in ms (default: 50) */
	delay?: number;
	/** Force errors for testing */
	forceError?: {
		operation?: "fetch" | "fetchBySession" | "update";
		code?: string;
		message?: string;
	};
}

/** Create a mock customer adapter for testing */
export function createMockCustomerAdapter(
	options: MockCustomerAdapterOptions = {},
): CustomerAdapter {
	const delay = options.delay ?? 50;
	let customer: CustomerData | null = options.initialData
		? structuredClone(options.initialData)
		: null;
	const guestCustomer: CustomerData | null = options.guestData
		? structuredClone(options.guestData)
		: null;

	const wait = () => new Promise<void>((r) => setTimeout(r, delay));

	const maybeThrow = (operation: string): void => {
		if (options.forceError?.operation === operation) {
			throw new HTTP_ERROR.BadRequest(
				options.forceError.message ??
					`Mock error for ${operation}`,
			);
		}
	};

	const hasFetchBySession = "guestData" in options ||
		options.forceError?.operation === "fetchBySession";

	const adapter: CustomerAdapter = {
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
			_ctx: DomainContext,
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

	if (hasFetchBySession) {
		adapter.fetchBySession = async (
			_ctx: DomainContext,
		): Promise<CustomerData | null> => {
			await wait();
			maybeThrow("fetchBySession");

			if (!guestCustomer) return null;
			return structuredClone(guestCustomer);
		};
	}

	return adapter;
}
