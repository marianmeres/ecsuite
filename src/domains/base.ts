/**
 * @module domains/base
 *
 * Base domain manager providing shared functionality for all domain managers.
 * Implements reactive state management, optimistic updates, and event emission.
 */

import { type Clog, createClog } from "@marianmeres/clog";
import { createStoragePersistor, createStore, type StoreLike } from "@marianmeres/store";
import { createPubSub, type PubSub } from "@marianmeres/pubsub";
import type {
	DomainContext,
	DomainError,
	DomainState,
	DomainStateWrapper,
} from "../types/state.ts";
import type { DomainName, ECSuiteEvent } from "../types/events.ts";

/** Storage type options */
export type StorageType = "local" | "session" | "memory" | null;

/** Base options for domain managers */
export interface BaseDomainOptions {
	/** Storage key for localStorage persistence (if applicable) */
	storageKey?: string;
	/** Storage type: "local" | "session" | "memory" | null (no persistence) */
	storageType?: StorageType;
	/** Initial context (customerId, sessionId) */
	context?: DomainContext;
	/** Shared pubsub instance for events */
	pubsub?: PubSub;
}

/**
 * Abstract base class for domain managers providing shared functionality.
 *
 * Implements:
 * - Reactive store with Svelte-compatible `subscribe()` method
 * - State machine transitions (initializing → ready ↔ syncing → error)
 * - Optimistic update pattern with automatic rollback
 * - Event emission via pub/sub
 * - Optional persistence (localStorage, sessionStorage, memory)
 *
 * @typeParam TData - The domain data type
 * @typeParam TAdapter - The adapter interface type for server communication
 */
export abstract class BaseDomainManager<TData, TAdapter> {
	protected readonly store: StoreLike<DomainStateWrapper<TData>>;
	protected readonly pubsub: PubSub;
	protected readonly domainName: DomainName;
	protected readonly clog: Clog;
	protected adapter: TAdapter | null = null;
	protected context: DomainContext = {};

	constructor(domainName: DomainName, options: BaseDomainOptions = {}) {
		this.domainName = domainName;
		this.clog = createClog(`ecsuite:${domainName}`, { color: "auto" });
		this.pubsub = options.pubsub ?? createPubSub();
		this.context = options.context ?? {};
		this.clog.debug("initializing", { storageKey: options.storageKey });

		// Create initial state
		const initialState: DomainStateWrapper<TData> = {
			state: "initializing",
			data: null,
			error: null,
			lastSyncedAt: null,
		};

		// Setup store with optional persistence
		if (options.storageKey && options.storageType) {
			const persistor = createStoragePersistor<DomainStateWrapper<TData>>(
				options.storageKey,
				options.storageType,
			);
			const persisted = persistor.get();
			this.store = createStore<DomainStateWrapper<TData>>(
				persisted ?? initialState,
				{ persist: persistor.set },
			);
		} else {
			this.store = createStore<DomainStateWrapper<TData>>(initialState);
		}
	}

	/** Get the Svelte-compatible subscribe method */
	get subscribe(): StoreLike<DomainStateWrapper<TData>>["subscribe"] {
		return this.store.subscribe;
	}

	/** Get current state synchronously */
	get(): DomainStateWrapper<TData> {
		return this.store.get();
	}

	/** Set the adapter */
	setAdapter(adapter: TAdapter): void {
		this.adapter = adapter;
	}

	/** Get the adapter (may be null) */
	getAdapter(): TAdapter | null {
		return this.adapter;
	}

	/** Update context (customerId, sessionId) */
	setContext(context: DomainContext): void {
		this.context = { ...this.context, ...context };
	}

	/** Get the current context */
	getContext(): DomainContext {
		return { ...this.context };
	}

	/** Transition to a new state */
	protected setState(state: DomainState): void {
		const current = this.store.get();
		if (current.state !== state) {
			this.clog.debug("state change", {
				from: current.state,
				to: state,
			});
			this.store.update((s) => ({ ...s, state }));
			this.emit({
				type: "domain:state:changed",
				domain: this.domainName,
				timestamp: Date.now(),
				previousState: current.state,
				newState: state,
			});
		}
	}

	/** Update data and optionally set state to ready */
	protected setData(data: TData, markReady = true): void {
		this.store.update((s) => ({
			...s,
			data,
			state: markReady ? "ready" : s.state,
			error: null,
		}));
	}

	/** Set error state */
	protected setError(error: DomainError): void {
		this.clog.error("error", {
			code: error.code,
			message: error.message,
			operation: error.operation,
		});
		this.store.update((s) => ({
			...s,
			state: "error",
			error,
		}));
		this.emit({
			type: "domain:error",
			domain: this.domainName,
			timestamp: Date.now(),
			error,
		});
	}

	/** Mark as synced */
	protected markSynced(): void {
		this.clog.debug("synced");
		this.store.update((s) => ({
			...s,
			state: "ready",
			lastSyncedAt: Date.now(),
		}));
		this.emit({
			type: "domain:synced",
			domain: this.domainName,
			timestamp: Date.now(),
		});
	}

	/** Emit an event via pubsub */
	protected emit(event: ECSuiteEvent): void {
		this.pubsub.publish(event.type, event);
	}

	/**
	 * Execute an async operation with optimistic update pattern.
	 *
	 * 1. Captures current state for potential rollback
	 * 2. Applies optimistic update immediately
	 * 3. Sets state to "syncing"
	 * 4. Awaits server sync
	 * 5. On success: marks synced, calls success callback
	 * 6. On error: rolls back to previous state, sets error state
	 */
	protected async withOptimisticUpdate<T>(
		operation: string,
		optimisticUpdate: () => void,
		serverSync: () => Promise<T>,
		onSuccess?: (result: T) => void,
		onError?: (error: DomainError) => void,
	): Promise<void> {
		// Capture current state for rollback
		const previousData = this.store.get().data;

		// Apply optimistic update immediately
		optimisticUpdate();
		this.setState("syncing");

		try {
			const result = await serverSync();
			this.markSynced();
			onSuccess?.(result);
		} catch (e) {
			// Rollback on error
			if (previousData !== null) {
				this.setData(previousData, false);
			}
			const error: DomainError = {
				code: "SYNC_FAILED",
				message: e instanceof Error ? e.message : "Unknown error",
				originalError: e,
				operation,
			};
			this.setError(error);
			onError?.(error);
		}
	}

	/** Initialize the domain (fetch from server) */
	abstract initialize(): Promise<void>;

	/** Reset to initial state */
	reset(): void {
		this.clog.debug("reset");
		this.store.set({
			state: "initializing",
			data: null,
			error: null,
			lastSyncedAt: null,
		});
	}
}
