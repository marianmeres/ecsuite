/**
 * @module domains/payment
 *
 * Payment domain manager - fetch, initiate, and capture payments.
 * Manages payment data fetched from the server on demand.
 */

import type { PaymentData, PaymentIntent, UUID } from "@marianmeres/collection-types";
import { HTTP_ERROR } from "@marianmeres/http-utils";
import type { PaymentAdapter, PaymentInitConfig } from "../types/adapter.ts";
import { BaseDomainManager, type BaseDomainOptions } from "./base.ts";

/** Payment list data (array of payments) */
export interface PaymentListData {
	payments: PaymentData[];
}

export interface PaymentManagerOptions extends BaseDomainOptions {
	/** Payment adapter for server communication */
	adapter?: PaymentAdapter;
}

/**
 * Payment domain manager - fetch, initiate, and capture payments.
 *
 * Features:
 * - Server-side data source (no local persistence)
 * - Fetch payments per order
 * - Fetch individual payments
 * - Initiate payments (optional adapter support)
 * - Capture/confirm payments (optional adapter support)
 * - Local cache management
 *
 * @example
 * ```typescript
 * const payments = new PaymentManager({ adapter: myPaymentAdapter });
 * await payments.initialize();
 *
 * const orderPayments = await payments.fetchForOrder("order-123");
 * const intent = await payments.initiate("order-123", {
 *   provider: "stripe", amount: 1000, currency: "EUR",
 * });
 * ```
 */
export class PaymentManager extends BaseDomainManager<PaymentListData, PaymentAdapter> {
	constructor(options: PaymentManagerOptions = {}) {
		super("payment", {
			...options,
			// Payments are NOT persisted locally
			storageType: null,
		});

		if (options.adapter) {
			this.adapter = options.adapter;
		}
	}

	/**
	 * Initialize - for payments, this just sets state to ready.
	 * Actual payment data is fetched per-order via fetchForOrder.
	 */
	async initialize(): Promise<void> {
		this.clog.debug("initialize start");
		this.setData({ payments: [] });
		this.setState("ready");
		this.clog.debug("initialize complete");
	}

	/**
	 * Fetch all payments for a specific order.
	 * New payments are merged into the local list (avoiding duplicates).
	 *
	 * @param orderId - The order ID to fetch payments for
	 * @returns Array of payments for the order
	 * @emits payment:fetched - On successful fetch
	 */
	async fetchForOrder(orderId: UUID): Promise<PaymentData[]> {
		this.clog.debug("fetchForOrder", { orderId });
		if (!this.adapter) {
			return [];
		}

		this.setState("syncing");
		try {
			const data = await this.adapter.fetchForOrder(orderId, this.context);
			// Merge payments into our list (avoid duplicates by provider_reference)
			const current = this.store.get().data ?? { payments: [] };
			const existingRefs = new Set(
				current.payments.map((p) => p.provider_reference),
			);
			const newPayments = data.filter(
				(p) => !existingRefs.has(p.provider_reference),
			);
			this.setData({ payments: [...current.payments, ...newPayments] });
			this.markSynced();
			this.emit({
				type: "payment:fetched",
				domain: "payment",
				timestamp: Date.now(),
			});
			return data;
		} catch (e) {
			this.setError({
				code: "FETCH_FAILED",
				message: e instanceof Error ? e.message : "Failed to fetch payments",
				originalError: e,
				operation: "fetchForOrder",
			});
		}
		return [];
	}

	/**
	 * Fetch a single payment by ID.
	 * Updates or adds the payment to the local list.
	 *
	 * @param paymentId - The payment ID to fetch
	 * @returns The payment or null on error
	 */
	async fetchOne(paymentId: UUID): Promise<PaymentData | null> {
		this.clog.debug("fetchOne", { paymentId });
		if (!this.adapter) {
			return null;
		}

		this.setState("syncing");
		try {
			const data = await this.adapter.fetchOne(paymentId, this.context);
			// Add or update in our local list
			const current = this.store.get().data ?? { payments: [] };
			const existingIndex = current.payments.findIndex(
				(p) => p.provider_reference === data.provider_reference,
			);

			let payments: PaymentData[];
			if (existingIndex >= 0) {
				payments = [...current.payments];
				payments[existingIndex] = data;
			} else {
				payments = [...current.payments, data];
			}

			this.setData({ payments });
			this.markSynced();
			return data;
		} catch (e) {
			const isNotFound = e instanceof HTTP_ERROR.NotFound;
			this.setError({
				code: isNotFound ? "NOT_FOUND" : "FETCH_FAILED",
				message: e instanceof Error ? e.message : "Failed to fetch payment",
				originalError: e,
				operation: "fetchOne",
			});
		}
		return null;
	}

	/**
	 * Initiate a payment for an order.
	 * Requires adapter with initiate() support.
	 *
	 * @param orderId - The order to pay for
	 * @param config - Payment configuration
	 * @returns PaymentIntent with redirect URL, or null
	 * @emits payment:initiated - On successful initiation
	 */
	async initiate(
		orderId: UUID,
		config: PaymentInitConfig,
	): Promise<PaymentIntent | null> {
		this.clog.debug("initiate", { orderId });
		if (!this.adapter?.initiate) {
			return null;
		}

		this.setState("syncing");
		try {
			const intent = await this.adapter.initiate(
				orderId,
				config,
				this.context,
			);
			this.markSynced();
			this.emit({
				type: "payment:initiated",
				domain: "payment",
				timestamp: Date.now(),
				orderId,
				paymentIntentId: intent.id,
				redirectUrl: intent.redirect_url,
			});
			return intent;
		} catch (e) {
			this.setError({
				code: "INITIATE_FAILED",
				message: e instanceof Error ? e.message : "Failed to initiate payment",
				originalError: e,
				operation: "initiate",
			});
		}
		return null;
	}

	/**
	 * Capture/confirm a payment.
	 * Requires adapter with capture() support.
	 *
	 * @param paymentId - The payment to capture
	 * @returns Captured payment data, or null
	 * @emits payment:captured - On successful capture
	 */
	async capture(paymentId: UUID): Promise<PaymentData | null> {
		this.clog.debug("capture", { paymentId });
		if (!this.adapter?.capture) {
			return null;
		}

		this.setState("syncing");
		try {
			const data = await this.adapter.capture(
				paymentId,
				this.context,
			);
			// Add or update in our local list
			const current = this.store.get().data ?? { payments: [] };
			const existingIndex = current.payments.findIndex(
				(p) => p.provider_reference === data.provider_reference,
			);

			let payments: PaymentData[];
			if (existingIndex >= 0) {
				payments = [...current.payments];
				payments[existingIndex] = data;
			} else {
				payments = [...current.payments, data];
			}

			this.setData({ payments });
			this.markSynced();
			this.emit({
				type: "payment:captured",
				domain: "payment",
				timestamp: Date.now(),
				paymentId,
			});
			return data;
		} catch (e) {
			this.setError({
				code: "CAPTURE_FAILED",
				message: e instanceof Error ? e.message : "Failed to capture payment",
				originalError: e,
				operation: "capture",
			});
		}
		return null;
	}

	/**
	 * Get the total number of fetched payments.
	 *
	 * @returns Total payment count
	 */
	getPaymentCount(): number {
		return this.store.get().data?.payments.length ?? 0;
	}

	/**
	 * Get all fetched payments.
	 *
	 * @returns Array of payments
	 */
	getPayments(): PaymentData[] {
		return this.store.get().data?.payments ?? [];
	}

	/**
	 * Get a payment by its provider reference.
	 *
	 * @param providerReference - The payment provider reference
	 * @returns The payment or undefined if not found
	 */
	getPaymentByRef(providerReference: string): PaymentData | undefined {
		return this.store.get().data?.payments.find(
			(p) => p.provider_reference === providerReference,
		);
	}

	/**
	 * Clear the local payment cache.
	 */
	clearCache(): void {
		this.setData({ payments: [] });
	}
}
