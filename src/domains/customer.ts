/**
 * @module domains/customer
 *
 * Customer domain manager - read + limited update, no local persistence.
 * Manages customer profile state with server-side data as source of truth.
 */

import type { CustomerData } from "@marianmeres/collection-types";
import type { CustomerAdapter } from "../types/adapter.ts";
import { BaseDomainManager, type BaseDomainOptions } from "./base.ts";

export interface CustomerManagerOptions extends BaseDomainOptions {
	/** Customer adapter for server communication */
	adapter?: CustomerAdapter;
}

/**
 * Customer domain manager - read + limited update, no local persistence.
 *
 * Features:
 * - Server-side data source (no local persistence)
 * - Profile updates with optimistic updates
 * - Guest detection
 * - Profile data helpers
 *
 * @example
 * ```typescript
 * const customer = new CustomerManager({ adapter: myCustomerAdapter });
 * await customer.initialize();
 *
 * await customer.update({ name: "John Doe" });
 * console.log(customer.getName()); // "John Doe"
 * ```
 */
export class CustomerManager extends BaseDomainManager<CustomerData, CustomerAdapter> {
	constructor(options: CustomerManagerOptions = {}) {
		super("customer", {
			...options,
			// Customer is NOT persisted locally
			storageType: null,
		});

		if (options.adapter) {
			this._adapter = options.adapter;
		}
	}

	/** Initialize by fetching customer data from server */
	async initialize(): Promise<void> {
		this._clog.debug("initialize start");
		if (!this._adapter) {
			// No adapter, mark ready with no data
			this._setState("ready");
			this._clog.debug("initialize complete (no adapter)");
			return;
		}

		this._setState("syncing");
		try {
			const result = await this._adapter.fetch(this._context);
			if (result.success && result.data) {
				this._setData(result.data);
				this._markSynced();
				this._emit({
					type: "customer:fetched",
					domain: "customer",
					timestamp: Date.now(),
				});
			} else if (result.error) {
				this._setError({
					code: result.error.code,
					message: result.error.message,
					operation: "initialize",
				});
			}
		} catch (e) {
			this._setError({
				code: "FETCH_FAILED",
				message: e instanceof Error ? e.message : "Failed to fetch customer",
				originalError: e,
				operation: "initialize",
			});
		}
		this._clog.debug("initialize complete");
	}

	/**
	 * Refresh customer data from the server.
	 *
	 * @emits customer:fetched - On successful fetch
	 */
	async refresh(): Promise<void> {
		this._clog.debug("refresh");
		if (!this._adapter) {
			return;
		}

		this._setState("syncing");
		try {
			const result = await this._adapter.fetch(this._context);
			if (result.success && result.data) {
				this._setData(result.data);
				this._markSynced();
				this._emit({
					type: "customer:fetched",
					domain: "customer",
					timestamp: Date.now(),
				});
			} else if (result.error) {
				this._setError({
					code: result.error.code,
					message: result.error.message,
					operation: "refresh",
				});
			}
		} catch (e) {
			this._setError({
				code: "FETCH_FAILED",
				message: e instanceof Error ? e.message : "Failed to fetch customer",
				originalError: e,
				operation: "refresh",
			});
		}
	}

	/**
	 * Update customer data with optimistic update.
	 * Partial updates are merged with existing data.
	 *
	 * @param data - Partial customer data to update
	 * @emits customer:updated - On successful update
	 */
	async update(data: Partial<CustomerData>): Promise<void> {
		this._clog.debug("update");
		if (!this._adapter) {
			return;
		}

		const current = this._store.get().data;
		if (!current) {
			return;
		}

		await this._withOptimisticUpdate(
			"update",
			() => {
				// Optimistic: merge partial data
				this._setData({ ...current, ...data }, false);
			},
			async () => {
				const result = await this._adapter!.update(data, this._context);
				if (!result.success) {
					throw new Error(result.error?.message ?? "Failed to update customer");
				}
				return result.data;
			},
			(serverData) => {
				if (serverData) {
					this._setData(serverData);
				}
				this._emit({
					type: "customer:updated",
					domain: "customer",
					timestamp: Date.now(),
				});
			}
		);
	}

	/**
	 * Get the customer's email address.
	 *
	 * @returns Email or null if not loaded
	 */
	getEmail(): string | null {
		return this._store.get().data?.email ?? null;
	}

	/**
	 * Get the customer's name.
	 *
	 * @returns Name or null if not loaded
	 */
	getName(): string | null {
		return this._store.get().data?.name ?? null;
	}

	/**
	 * Check if the customer is a guest (not logged in).
	 *
	 * @returns True if guest, defaults to true if no data
	 */
	isGuest(): boolean {
		return this._store.get().data?.guest ?? true;
	}

	/**
	 * Check if customer data has been loaded.
	 *
	 * @returns True if data is available
	 */
	hasData(): boolean {
		return this._store.get().data !== null;
	}
}
