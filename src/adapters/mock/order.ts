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
		/** HTTP error class name from `HTTP_ERROR` (default: "BadRequest") */
		code?: keyof typeof HTTP_ERROR;
		message?: string;
	};
}

/** Create a mock order adapter for testing */
export function createMockOrderAdapter(
	options: MockOrderAdapterOptions = {},
): OrderAdapter {
	const delay = options.delay ?? 50;
	const orders: OrderCreateResult[] = options.initialData
		? options.initialData.map((o, i) => ({
			model_id: `order-${i + 1}` as UUID,
			data: structuredClone(o),
		}))
		: [];

	let orderIdCounter = orders.length;

	const wait = () => new Promise<void>((r) => setTimeout(r, delay));

	const maybeThrow = (operation: string): void => {
		if (options.forceError?.operation === operation) {
			const code = options.forceError.code ?? "BadRequest";
			const Ctor = (HTTP_ERROR as Record<string, typeof HTTP_ERROR.BadRequest>)[
				code
			] ?? HTTP_ERROR.BadRequest;
			throw new Ctor(
				options.forceError.message ?? `Mock error for ${operation}`,
			);
		}
	};

	return {
		async fetchAll(_ctx: DomainContext): Promise<OrderCreateResult[]> {
			await wait();
			maybeThrow("fetchAll");
			return structuredClone(orders);
		},

		async fetchOne(
			orderId: UUID,
			_ctx: DomainContext,
		): Promise<OrderCreateResult> {
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

			orders.push({ model_id, data: structuredClone(data) });
			return { model_id, data };
		},
	};
}
