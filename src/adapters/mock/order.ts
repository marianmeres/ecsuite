/**
 * Mock order adapter for testing.
 */

import type { OrderData, UUID } from "@marianmeres/collection-types";
import type {
	AdapterResult,
	OrderAdapter,
	OrderCreatePayload,
} from "../../types/adapter.ts";
import type { DomainContext } from "../../types/state.ts";

/** Mock order adapter options */
export interface MockOrderAdapterOptions {
	/** Initial orders data */
	initialData?: OrderData[];
	/** Simulated network delay in ms (default: 50) */
	delay?: number;
	/** Force errors for testing */
	forceError?: {
		operation?: "fetchAll" | "fetchOne" | "create";
		code?: string;
		message?: string;
	};
}

/** Create a mock order adapter for testing */
export function createMockOrderAdapter(
	options: MockOrderAdapterOptions = {}
): OrderAdapter {
	const delay = options.delay ?? 50;
	let orders: (OrderData & { model_id: UUID })[] = options.initialData
		? options.initialData.map((o, i) => ({
				...structuredClone(o),
				model_id: `order-${i + 1}`,
		  }))
		: [];

	let orderIdCounter = orders.length;

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
		async fetchAll(_ctx: DomainContext): Promise<AdapterResult<OrderData[]>> {
			await wait();
			const error = maybeError<OrderData[]>("fetchAll");
			if (error) return error;
			return { success: true, data: structuredClone(orders) };
		},

		async fetchOne(
			orderId: UUID,
			_ctx: DomainContext
		): Promise<AdapterResult<OrderData>> {
			await wait();
			const error = maybeError<OrderData>("fetchOne");
			if (error) return error;

			const order = orders.find((o) => o.model_id === orderId);
			if (!order) {
				return {
					success: false,
					error: {
						code: "NOT_FOUND",
						message: `Order ${orderId} not found`,
					},
				};
			}

			return { success: true, data: structuredClone(order) };
		},

		async create(
			orderData: OrderCreatePayload,
			_ctx: DomainContext
		): Promise<AdapterResult<OrderData>> {
			await wait();
			const error = maybeError<OrderData>("create");
			if (error) return error;

			const newOrder = {
				...structuredClone(orderData),
				status: "pending" as const,
				model_id: `order-${++orderIdCounter}`,
			} as OrderData & { model_id: UUID };

			orders.push(newOrder);
			return { success: true, data: structuredClone(newOrder) };
		},
	};
}
