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
			this.adapter = options.adapter;
		}
	}

	/** Initialize by fetching customer data from server */
	async initialize(): Promise<void> {
		this.clog.debug("initialize start");
		if (!this.adapter) {
			// No adapter, mark ready with no data
			this.setState("ready");
			this.clog.debug("initialize complete (no adapter)");
			return;
		}

		this.setState("syncing");
		try {
			const data = await this.adapter.fetch(this.context);
			this.setData(data);
			this.markSynced();
			this.emit({
				type: "customer:fetched",
				domain: "customer",
				timestamp: Date.now(),
			});
		} catch (e) {
			this.setError({
				code: "FETCH_FAILED",
				message: e instanceof Error ? e.message : "Failed to fetch customer",
				originalError: e,
				operation: "initialize",
			});
		}
		this.clog.debug("initialize complete");
	}

	/**
	 * Refresh customer data from the server.
	 *
	 * @emits customer:fetched - On successful fetch
	 */
	async refresh(): Promise<void> {
		this.clog.debug("refresh");
		if (!this.adapter) {
			return;
		}

		this.setState("syncing");
		try {
			const data = await this.adapter.fetch(this.context);
			this.setData(data);
			this.markSynced();
			this.emit({
				type: "customer:fetched",
				domain: "customer",
				timestamp: Date.now(),
			});
		} catch (e) {
			this.setError({
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
		this.clog.debug("update");
		if (!this.adapter) {
			return;
		}

		const current = this.store.get().data;
		if (!current) {
			return;
		}

		await this.withOptimisticUpdate(
			"update",
			() => {
				// Optimistic: merge partial data
				this.setData({ ...current, ...data }, false);
			},
			async () => {
				return await this.adapter!.update(data, this.context);
			},
			(serverData) => {
				if (serverData) {
					this.setData(serverData);
				}
				this.emit({
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
		return this.store.get().data?.email ?? null;
	}

	/**
	 * Get the customer's name.
	 *
	 * @returns Name or null if not loaded
	 */
	getName(): string | null {
		return this.store.get().data?.name ?? null;
	}

	/**
	 * Check if the customer is a guest (not logged in).
	 *
	 * @returns True if guest, defaults to true if no data
	 */
	isGuest(): boolean {
		return this.store.get().data?.guest ?? true;
	}

	/**
	 * Check if customer data has been loaded.
	 *
	 * @returns True if data is available
	 */
	hasData(): boolean {
		return this.store.get().data !== null;
	}
}
