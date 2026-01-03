/**
 * Payment domain manager - read-only, no local persistence.
 */

import type { PaymentData, UUID } from "@marianmeres/collection-types";
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

	/** Fetch payments for a specific order */
	async fetchForOrder(orderId: UUID): Promise<PaymentData[]> {
		this._clog.debug("fetchForOrder", { orderId });
		if (!this._adapter) {
			return [];
		}

		this._setState("syncing");
		try {
			const result = await this._adapter.fetchForOrder(orderId, this._context);
			if (result.success && result.data) {
				// Merge payments into our list (avoid duplicates by provider_reference)
				const current = this._store.get().data ?? { payments: [] };
				const existingRefs = new Set(
					current.payments.map((p) => p.provider_reference)
				);
				const newPayments = result.data.filter(
					(p) => !existingRefs.has(p.provider_reference)
				);
				this._setData({ payments: [...current.payments, ...newPayments] });
				this._markSynced();
				this._emit({
					type: "payment:fetched",
					domain: "payment",
					timestamp: Date.now(),
				});
				return result.data;
			} else if (result.error) {
				this._setError({
					code: result.error.code,
					message: result.error.message,
					operation: "fetchForOrder",
				});
			}
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

	/** Fetch single payment by ID */
	async fetchOne(paymentId: UUID): Promise<PaymentData | null> {
		this._clog.debug("fetchOne", { paymentId });
		if (!this._adapter) {
			return null;
		}

		this._setState("syncing");
		try {
			const result = await this._adapter.fetchOne(paymentId, this._context);
			if (result.success && result.data) {
				// Add or update in our local list
				const current = this._store.get().data ?? { payments: [] };
				const existingIndex = current.payments.findIndex(
					(p) => p.provider_reference === result.data!.provider_reference
				);

				let payments: PaymentData[];
				if (existingIndex >= 0) {
					payments = [...current.payments];
					payments[existingIndex] = result.data;
				} else {
					payments = [...current.payments, result.data];
				}

				this._setData({ payments });
				this._markSynced();
				return result.data;
			} else if (result.error) {
				this._setError({
					code: result.error.code,
					message: result.error.message,
					operation: "fetchOne",
				});
			}
		} catch (e) {
			this._setError({
				code: "FETCH_FAILED",
				message: e instanceof Error ? e.message : "Failed to fetch payment",
				originalError: e,
				operation: "fetchOne",
			});
		}
		return null;
	}

	/** Get payment count */
	getPaymentCount(): number {
		return this._store.get().data?.payments.length ?? 0;
	}

	/** Get all fetched payments */
	getPayments(): PaymentData[] {
		return this._store.get().data?.payments ?? [];
	}

	/** Get payment by provider reference */
	getPaymentByRef(providerReference: string): PaymentData | undefined {
		return this._store.get().data?.payments.find(
			(p) => p.provider_reference === providerReference
		);
	}

	/** Clear local payment cache */
	clearCache(): void {
		this._setData({ payments: [] });
	}
}
