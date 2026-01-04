/**
 * @module domains/base
 *
 * Base domain manager providing shared functionality for all domain managers.
 * Implements reactive state management, optimistic updates, and event emission.
 */

import { createClog, type Clog } from "@marianmeres/clog";
import {
	createStore,
	createStoragePersistor,
	type StoreLike,
} from "@marianmeres/store";
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
	protected readonly _store: StoreLike<DomainStateWrapper<TData>>;
	protected readonly _pubsub: PubSub;
	protected readonly _domainName: DomainName;
	protected readonly _clog: Clog;
	protected _adapter: TAdapter | null = null;
	protected _context: DomainContext = {};

	constructor(domainName: DomainName, options: BaseDomainOptions = {}) {
		this._domainName = domainName;
		this._clog = createClog(`ecsuite:${domainName}`, { color: "auto" });
		this._pubsub = options.pubsub ?? createPubSub();
		this._context = options.context ?? {};
		this._clog.debug("initializing", { storageKey: options.storageKey });

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
				options.storageType
			);
			const persisted = persistor.get();
			this._store = createStore<DomainStateWrapper<TData>>(
				persisted ?? initialState,
				{ persist: persistor.set }
			);
		} else {
			this._store = createStore<DomainStateWrapper<TData>>(initialState);
		}
	}

	/** Get the Svelte-compatible subscribe method */
	get subscribe(): StoreLike<DomainStateWrapper<TData>>["subscribe"] {
		return this._store.subscribe;
	}

	/** Get current state synchronously */
	get(): DomainStateWrapper<TData> {
		return this._store.get();
	}

	/** Set the adapter */
	setAdapter(adapter: TAdapter): void {
		this._adapter = adapter;
	}

	/** Get the adapter (may be null) */
	getAdapter(): TAdapter | null {
		return this._adapter;
	}

	/** Update context (customerId, sessionId) */
	setContext(context: DomainContext): void {
		this._context = { ...this._context, ...context };
	}

	/** Get the current context */
	getContext(): DomainContext {
		return { ...this._context };
	}

	/** Transition to a new state */
	protected _setState(state: DomainState): void {
		const current = this._store.get();
		if (current.state !== state) {
			this._clog.debug("state change", {
				from: current.state,
				to: state,
			});
			this._store.update((s) => ({ ...s, state }));
			this._emit({
				type: "domain:state:changed",
				domain: this._domainName,
				timestamp: Date.now(),
				previousState: current.state,
				newState: state,
			});
		}
	}

	/** Update data and optionally set state to ready */
	protected _setData(data: TData, markReady = true): void {
		this._store.update((s) => ({
			...s,
			data,
			state: markReady ? "ready" : s.state,
			error: null,
		}));
	}

	/** Set error state */
	protected _setError(error: DomainError): void {
		this._clog.error("error", {
			code: error.code,
			message: error.message,
			operation: error.operation,
		});
		this._store.update((s) => ({
			...s,
			state: "error",
			error,
		}));
		this._emit({
			type: "domain:error",
			domain: this._domainName,
			timestamp: Date.now(),
			error,
		});
	}

	/** Mark as synced */
	protected _markSynced(): void {
		this._clog.debug("synced");
		this._store.update((s) => ({
			...s,
			state: "ready",
			lastSyncedAt: Date.now(),
		}));
		this._emit({
			type: "domain:synced",
			domain: this._domainName,
			timestamp: Date.now(),
		});
	}

	/** Emit an event via pubsub */
	protected _emit(event: ECSuiteEvent): void {
		this._pubsub.publish(event.type, event);
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
	protected async _withOptimisticUpdate<T>(
		operation: string,
		optimisticUpdate: () => void,
		serverSync: () => Promise<T>,
		onSuccess?: (result: T) => void,
		onError?: (error: DomainError) => void
	): Promise<void> {
		// Capture current state for rollback
		const previousData = this._store.get().data;

		// Apply optimistic update immediately
		optimisticUpdate();
		this._setState("syncing");

		try {
			const result = await serverSync();
			this._markSynced();
			onSuccess?.(result);
		} catch (e) {
			// Rollback on error
			if (previousData !== null) {
				this._setData(previousData, false);
			}
			const error: DomainError = {
				code: "SYNC_FAILED",
				message: e instanceof Error ? e.message : "Unknown error",
				originalError: e,
				operation,
			};
			this._setError(error);
			onError?.(error);
		}
	}

	/** Initialize the domain (fetch from server) */
	abstract initialize(): Promise<void>;

	/** Reset to initial state */
	reset(): void {
		this._clog.debug("reset");
		this._store.set({
			state: "initializing",
			data: null,
			error: null,
			lastSyncedAt: null,
		});
	}
}
