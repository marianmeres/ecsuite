/**
 * Mock payment adapter for testing.
 */

import type {
	PaymentData,
	PaymentIntent,
	UUID,
} from "@marianmeres/collection-types";
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
		operation?: "fetchForOrder" | "fetchOne" | "initiate" | "capture";
		/** HTTP error class name from `HTTP_ERROR` (default: "BadRequest") */
		code?: keyof typeof HTTP_ERROR;
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
			const code = options.forceError.code ?? "BadRequest";
			const Ctor =
				(HTTP_ERROR as Record<string, typeof HTTP_ERROR.BadRequest>)[
					code
				] ?? HTTP_ERROR.BadRequest;
			throw new Ctor(
				options.forceError.message ?? `Mock error for ${operation}`,
			);
		}
	};

	const findPaymentByRef = (
		ref: string,
	): { payment: PaymentData; orderId: UUID } | null => {
		for (const [orderId, list] of Object.entries(payments)) {
			const payment = list.find((p) => p.provider_reference === ref);
			if (payment) return { payment, orderId: orderId as UUID };
		}
		return null;
	};

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

			const found = findPaymentByRef(paymentId);
			if (!found) {
				throw new HTTP_ERROR.NotFound(
					`Payment ${paymentId} not found`,
				);
			}

			return structuredClone(found.payment);
		},

		async initiate(
			orderId: UUID,
			config: PaymentInitConfig,
			_ctx: DomainContext,
		): Promise<PaymentIntent> {
			await wait();
			maybeThrow("initiate");

			const id = `pi_${Math.random().toString(36).slice(2)}` as UUID;

			// Persist the initiated (pending) payment so capture() can find it.
			if (!payments[orderId]) payments[orderId] = [];
			payments[orderId].push({
				provider: config.provider,
				status: "pending",
				amount: config.amount,
				currency: config.currency,
				provider_reference: id,
			});

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

			// Look up the (pending) payment by reference and complete it.
			// Preserves the original amount/currency/provider that initiate()
			// recorded — bypassing this would force the test to assert against
			// hardcoded zeros.
			const found = findPaymentByRef(paymentId);
			if (!found) {
				throw new HTTP_ERROR.NotFound(
					`Payment ${paymentId} not found`,
				);
			}

			found.payment.status = "completed";
			return structuredClone(found.payment);
		},
	};
}
