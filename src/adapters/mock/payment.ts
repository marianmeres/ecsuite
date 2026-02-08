/**
 * Mock payment adapter for testing.
 */

import type { PaymentData, PaymentIntent, UUID } from "@marianmeres/collection-types";
import { HTTP_ERROR } from "@marianmeres/http-utils";
import type { PaymentAdapter, PaymentInitConfig } from "../../types/adapter.ts";
import type { DomainContext } from "../../types/state.ts";

/** Mock payment adapter options */
export interface MockPaymentAdapterOptions {
	/** Initial payments data (keyed by order ID) */
	initialData?: Record<UUID, PaymentData[]>;
	/** Simulated network delay in ms (default: 50) */
	delay?: number;
	/** Force errors for testing */
	forceError?: {
		operation?:
			| "fetchForOrder"
			| "fetchOne"
			| "initiate"
			| "capture";
		code?: string;
		message?: string;
	};
}

/** Create a mock payment adapter for testing */
export function createMockPaymentAdapter(
	options: MockPaymentAdapterOptions = {},
): PaymentAdapter {
	const delay = options.delay ?? 50;
	const payments: Record<UUID, PaymentData[]> = options.initialData
		? structuredClone(options.initialData)
		: {};

	const wait = () => new Promise<void>((r) => setTimeout(r, delay));

	const maybeThrow = (operation: string): void => {
		if (options.forceError?.operation === operation) {
			throw new HTTP_ERROR.BadRequest(
				options.forceError.message ??
					`Mock error for ${operation}`,
			);
		}
	};

	const getAllPayments = (): PaymentData[] => Object.values(payments).flat();

	return {
		async fetchForOrder(
			orderId: UUID,
			_ctx: DomainContext,
		): Promise<PaymentData[]> {
			await wait();
			maybeThrow("fetchForOrder");

			const orderPayments = payments[orderId];
			if (!orderPayments) {
				return [];
			}

			return structuredClone(orderPayments);
		},

		async fetchOne(
			paymentId: UUID,
			_ctx: DomainContext,
		): Promise<PaymentData> {
			await wait();
			maybeThrow("fetchOne");

			const allPayments = getAllPayments();
			const payment = allPayments.find(
				(p) => p.provider_reference === paymentId,
			);

			if (!payment) {
				throw new HTTP_ERROR.NotFound(
					`Payment ${paymentId} not found`,
				);
			}

			return structuredClone(payment);
		},

		async initiate(
			orderId: UUID,
			config: PaymentInitConfig,
			_ctx: DomainContext,
		): Promise<PaymentIntent> {
			await wait();
			maybeThrow("initiate");

			const id = `pi_${Math.random().toString(36).slice(2)}` as UUID;
			return {
				id,
				redirect_url: `https://mock-payment.test/pay/${id}`,
				provider_data: {
					orderId,
					provider: config.provider,
				},
			};
		},

		async capture(
			paymentId: UUID,
			_ctx: DomainContext,
		): Promise<PaymentData> {
			await wait();
			maybeThrow("capture");

			const payment: PaymentData = {
				provider: "mock",
				status: "completed",
				amount: 0,
				currency: "EUR",
				provider_reference: paymentId,
			};

			// Store captured payment
			const key = Object.keys(payments)[0] ?? "mock-order";
			if (!payments[key]) payments[key] = [];
			payments[key].push(payment);

			return structuredClone(payment);
		},
	};
}
