/**
 * Mock order adapter for testing.
 */

import type { OrderData, UUID } from "@marianmeres/collection-types";
import { HTTP_ERROR } from "@marianmeres/http-utils";
import type {
	OrderAdapter,
	OrderCreatePayload,
	OrderCreateResult,
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
	options: MockOrderAdapterOptions = {},
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

	const maybeThrow = (operation: string): void => {
		if (options.forceError?.operation === operation) {
			throw new HTTP_ERROR.BadRequest(
				options.forceError.message ?? `Mock error for ${operation}`,
			);
		}
	};

	return {
		async fetchAll(_ctx: DomainContext): Promise<OrderData[]> {
			await wait();
			maybeThrow("fetchAll");
			return structuredClone(orders);
		},

		async fetchOne(orderId: UUID, _ctx: DomainContext): Promise<OrderData> {
			await wait();
			maybeThrow("fetchOne");

			const order = orders.find((o) => o.model_id === orderId);
			if (!order) {
				throw new HTTP_ERROR.NotFound(`Order ${orderId} not found`);
			}

			return structuredClone(order);
		},

		async create(
			orderData: OrderCreatePayload,
			_ctx: DomainContext,
		): Promise<OrderCreateResult> {
			await wait();
			maybeThrow("create");

			const model_id = `order-${++orderIdCounter}` as UUID;
			const data = {
				...structuredClone(orderData),
				status: "pending" as const,
			} as OrderData;

			orders.push({ ...data, model_id });
			return { model_id, data: structuredClone(data) };
		},
	};
}
