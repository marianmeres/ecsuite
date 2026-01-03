/**
 * Mock payment adapter for testing.
 */

import type { PaymentData, UUID } from "@marianmeres/collection-types";
import type { AdapterResult, PaymentAdapter } from "../../types/adapter.ts";
import type { DomainContext } from "../../types/state.ts";

/** Mock payment adapter options */
export interface MockPaymentAdapterOptions {
	/** Initial payments data (keyed by order ID) */
	initialData?: Record<UUID, PaymentData[]>;
	/** Simulated network delay in ms (default: 50) */
	delay?: number;
	/** Force errors for testing */
	forceError?: {
		operation?: "fetchForOrder" | "fetchOne";
		code?: string;
		message?: string;
	};
}

/** Create a mock payment adapter for testing */
export function createMockPaymentAdapter(
	options: MockPaymentAdapterOptions = {}
): PaymentAdapter {
	const delay = options.delay ?? 50;
	const payments: Record<UUID, PaymentData[]> = options.initialData
		? structuredClone(options.initialData)
		: {};

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

	const getAllPayments = (): PaymentData[] =>
		Object.values(payments).flat();

	return {
		async fetchForOrder(
			orderId: UUID,
			_ctx: DomainContext
		): Promise<AdapterResult<PaymentData[]>> {
			await wait();
			const error = maybeError<PaymentData[]>("fetchForOrder");
			if (error) return error;

			const orderPayments = payments[orderId];
			if (!orderPayments) {
				return { success: true, data: [] };
			}

			return { success: true, data: structuredClone(orderPayments) };
		},

		async fetchOne(
			paymentId: UUID,
			_ctx: DomainContext
		): Promise<AdapterResult<PaymentData>> {
			await wait();
			const error = maybeError<PaymentData>("fetchOne");
			if (error) return error;

			const allPayments = getAllPayments();
			const payment = allPayments.find(
				(p) => p.provider_reference === paymentId
			);

			if (!payment) {
				return {
					success: false,
					error: {
						code: "NOT_FOUND",
						message: `Payment ${paymentId} not found`,
					},
				};
			}

			return { success: true, data: structuredClone(payment) };
		},
	};
}
