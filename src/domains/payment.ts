/**
 * @module domains/payment
 *
 * Payment domain manager - read-only, no local persistence.
 * Manages payment data fetched from the server on demand.
 */

import type { PaymentData, UUID } from "@marianmeres/collection-types";
import { HTTP_ERROR } from "@marianmeres/http-utils";
import type { PaymentAdapter } from "../types/adapter.ts";
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
 * Payment domain manager - read-only, no local persistence.
 *
 * Features:
 * - Server-side data source (no local persistence)
 * - Fetch payments per order
 * - Fetch individual payments
 * - Local cache management
 *
 * @example
 * ```typescript
 * const payments = new PaymentManager({ adapter: myPaymentAdapter });
 * await payments.initialize();
 *
 * const orderPayments = await payments.fetchForOrder("order-123");
 * console.log(payments.getPaymentCount());
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
			this._adapter = options.adapter;
		}
	}

	/**
	 * Initialize - for payments, this just sets state to ready.
	 * Actual payment data is fetched per-order via fetchForOrder.
	 */
	async initialize(): Promise<void> {
		this._clog.debug("initialize start");
		this._setData({ payments: [] });
		this._setState("ready");
		this._clog.debug("initialize complete");
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
		this._clog.debug("fetchForOrder", { orderId });
		if (!this._adapter) {
			return [];
		}

		this._setState("syncing");
		try {
			const data = await this._adapter.fetchForOrder(orderId, this._context);
			// Merge payments into our list (avoid duplicates by provider_reference)
			const current = this._store.get().data ?? { payments: [] };
			const existingRefs = new Set(
				current.payments.map((p) => p.provider_reference)
			);
			const newPayments = data.filter(
				(p) => !existingRefs.has(p.provider_reference)
			);
			this._setData({ payments: [...current.payments, ...newPayments] });
			this._markSynced();
			this._emit({
				type: "payment:fetched",
				domain: "payment",
				timestamp: Date.now(),
			});
			return data;
		} catch (e) {
			this._setError({
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
		this._clog.debug("fetchOne", { paymentId });
		if (!this._adapter) {
			return null;
		}

		this._setState("syncing");
		try {
			const data = await this._adapter.fetchOne(paymentId, this._context);
			// Add or update in our local list
			const current = this._store.get().data ?? { payments: [] };
			const existingIndex = current.payments.findIndex(
				(p) => p.provider_reference === data.provider_reference
			);

			let payments: PaymentData[];
			if (existingIndex >= 0) {
				payments = [...current.payments];
				payments[existingIndex] = data;
			} else {
				payments = [...current.payments, data];
			}

			this._setData({ payments });
			this._markSynced();
			return data;
		} catch (e) {
			const isNotFound = e instanceof HTTP_ERROR.NotFound;
			this._setError({
				code: isNotFound ? "NOT_FOUND" : "FETCH_FAILED",
				message: e instanceof Error ? e.message : "Failed to fetch payment",
				originalError: e,
				operation: "fetchOne",
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
		return this._store.get().data?.payments.length ?? 0;
	}

	/**
	 * Get all fetched payments.
	 *
	 * @returns Array of payments
	 */
	getPayments(): PaymentData[] {
		return this._store.get().data?.payments ?? [];
	}

	/**
	 * Get a payment by its provider reference.
	 *
	 * @param providerReference - The payment provider reference
	 * @returns The payment or undefined if not found
	 */
	getPaymentByRef(providerReference: string): PaymentData | undefined {
		return this._store.get().data?.payments.find(
			(p) => p.provider_reference === providerReference
		);
	}

	/**
	 * Clear the local payment cache.
	 */
	clearCache(): void {
		this._setData({ payments: [] });
	}
}
