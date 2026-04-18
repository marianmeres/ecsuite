/**
 * @module suite
 *
 * ECSuite - Main orchestrator for e-commerce frontend state management.
 * Coordinates all domain managers, provides shared event system, and manages context.
 */

import { createClog } from "@marianmeres/clog";
import {
	createPubSub,
	type PubSub,
	type Subscriber,
	type Unsubscriber,
} from "@marianmeres/pubsub";
import type {
	CartAdapter,
	CustomerAdapter,
	OrderAdapter,
	PaymentAdapter,
	ProductAdapter,
	WishlistAdapter,
} from "./types/adapter.ts";
import type { DomainContext, DomainError, DomainState } from "./types/state.ts";
import type {
	DomainName,
	ECSuiteEvent,
	ECSuiteEventType,
	ErrorEvent,
	InitializableDomainName,
	StateChangedEvent,
	SyncedEvent,
} from "./types/events.ts";
import { CartManager } from "./domains/cart.ts";
import { WishlistManager } from "./domains/wishlist.ts";
import { OrderManager } from "./domains/order.ts";
import { CustomerManager } from "./domains/customer.ts";
import { PaymentManager } from "./domains/payment.ts";
import { ProductManager } from "./domains/product.ts";
import type { StorageType } from "./domains/base.ts";

/** Combine multiple unsubscribers into one (also `Symbol.dispose`-compatible). */
function combineUnsubscribers(...unsubs: Unsubscriber[]): Unsubscriber {
	const fn = () => {
		for (const u of unsubs) u();
	};
	(fn as Unsubscriber)[Symbol.dispose] = fn;
	return fn as Unsubscriber;
}

/** Configuration for ECSuite */
export interface ECSuiteConfig {
	/** Initial context (customerId, sessionId) */
	context?: DomainContext;
	/** Adapters for server communication */
	adapters?: {
		cart?: CartAdapter;
		wishlist?: WishlistAdapter;
		order?: OrderAdapter;
		customer?: CustomerAdapter;
		payment?: PaymentAdapter;
		product?: ProductAdapter;
	};
	/** Storage configuration */
	storage?: {
		/** Cart storage key (default: "ecsuite:cart") */
		cartKey?: string;
		/** Wishlist storage key (default: "ecsuite:wishlist") */
		wishlistKey?: string;
		/** Storage type for persisted domains (default: "local") */
		type?: StorageType;
	};
	/** Product cache TTL in milliseconds (default: 5 minutes) */
	productCacheTtl?: number;
	/** Auto-initialize on creation (default: true) */
	autoInitialize?: boolean;
	/** Domains to initialize (default: all). Used by both autoInitialize and manual initialize(). */
	initializeDomains?: InitializableDomainName[];
	/**
	 * Reset and re-initialize all domains automatically when `setContext()`
	 * changes `customerId` (or transitions between guest and authenticated).
	 * Default: `true`. Set to `false` to manage identity transitions yourself
	 * via `switchIdentity()` or explicit `reset()` + `initialize()`.
	 */
	autoResetOnIdentityChange?: boolean;
}

/**
 * Main ECSuite class - orchestrates all e-commerce domain managers.
 *
 * Provides unified access to cart, wishlist, order, customer, payment, and product domains
 * with shared event system and context management.
 *
 * @example
 * ```typescript
 * const suite = createECSuite({
 *   context: { customerId: "user-123" },
 *   adapters: { cart: myCartAdapter },
 * });
 *
 * suite.cart.subscribe((state) => console.log(state));
 * await suite.cart.addItem({ product_id: "prod-1", quantity: 1 });
 * ```
 */
export class ECSuite {
	readonly #clog = createClog("ecsuite", { color: "auto" });
	readonly #pubsub: PubSub;
	#context: DomainContext;
	#initDomains: InitializableDomainName[] | undefined;
	#autoResetOnIdentityChange: boolean;

	/**
	 * Resolves when the most recent `initialize()` (auto or manual, including
	 * the one triggered by an identity switch) has settled. Always available;
	 * defaults to `Promise.resolve()` if `autoInitialize: false`.
	 *
	 * @example
	 * ```typescript
	 * const suite = createECSuite({ adapters: { cart } });
	 * await suite.ready;            // wait for initial fetches
	 * await suite.cart.addItem(...);
	 * ```
	 */
	ready: Promise<void> = Promise.resolve();

	/** Cart domain manager */
	readonly cart: CartManager;
	/** Wishlist domain manager */
	readonly wishlist: WishlistManager;
	/** Order domain manager */
	readonly order: OrderManager;
	/** Customer domain manager */
	readonly customer: CustomerManager;
	/** Payment domain manager */
	readonly payment: PaymentManager;
	/** Product domain manager (read-only with caching) */
	readonly product: ProductManager;

	constructor(config: ECSuiteConfig = {}) {
		this.#clog.debug("creating suite", {
			hasAdapters: !!config.adapters,
			autoInitialize: config.autoInitialize !== false,
		});
		this.#pubsub = createPubSub();
		this.#context = config.context ?? {};
		this.#initDomains = config.initializeDomains;
		this.#autoResetOnIdentityChange = config.autoResetOnIdentityChange !== false;

		const storageType = config.storage?.type ?? "local";

		// Initialize domain managers with shared pubsub
		this.cart = new CartManager({
			adapter: config.adapters?.cart,
			context: this.#context,
			pubsub: this.#pubsub,
			storageKey: config.storage?.cartKey ?? "ecsuite:cart",
			storageType,
		});

		this.wishlist = new WishlistManager({
			adapter: config.adapters?.wishlist,
			context: this.#context,
			pubsub: this.#pubsub,
			storageKey: config.storage?.wishlistKey ?? "ecsuite:wishlist",
			storageType,
		});

		this.order = new OrderManager({
			adapter: config.adapters?.order,
			context: this.#context,
			pubsub: this.#pubsub,
		});

		this.customer = new CustomerManager({
			adapter: config.adapters?.customer,
			context: this.#context,
			pubsub: this.#pubsub,
		});

		this.payment = new PaymentManager({
			adapter: config.adapters?.payment,
			context: this.#context,
			pubsub: this.#pubsub,
		});

		this.product = new ProductManager({
			adapter: config.adapters?.product,
			context: this.#context,
			pubsub: this.#pubsub,
			cacheTtl: config.productCacheTtl,
		});

		// Auto-initialize if configured. `ready` exposes the in-flight promise
		// so callers don't race the constructor.
		if (config.autoInitialize !== false) {
			this.ready = this.initialize(this.#initDomains);
		}
	}

	/** Initialize domains. When called without arguments, initializes all domains.
	 * Pass an array of domain names to selectively initialize specific domains.
	 *
	 * @param domains - Optional list of domains to initialize (default: all)
	 *
	 * @example
	 * ```typescript
	 * // Initialize all domains (default)
	 * await suite.initialize();
	 *
	 * // Initialize only cart and wishlist (skip auth-gated domains for guests)
	 * await suite.initialize(["cart", "wishlist"]);
	 *
	 * // Later, initialize order domain when user authenticates
	 * await suite.initialize(["order", "customer"]);
	 * ```
	 */
	async initialize(domains?: InitializableDomainName[]): Promise<void> {
		const all: InitializableDomainName[] = [
			"cart",
			"wishlist",
			"order",
			"customer",
			"payment",
			"product",
		];
		const toInit = domains ?? this.#initDomains ?? all;
		// Remember the most recently initialized set so identity switches
		// (and other re-inits) re-fetch the same domains.
		this.#initDomains = toInit;
		this.#clog.debug("initializing domains", toInit);
		await Promise.all(toInit.map((name) => this[name].initialize()));
		this.#clog.debug("domains initialized", toInit);
	}

	/**
	 * Update context across all domains.
	 *
	 * If `customerId` transitions (including to/from undefined) and
	 * `autoResetOnIdentityChange` is enabled (default), this also resets
	 * all domains and re-initializes them — assigning the new in-flight
	 * promise to `ready`. Callers that need to wait for the new identity's
	 * data should `await suite.ready` afterwards (or use `switchIdentity`).
	 */
	setContext(context: DomainContext): void {
		this.#clog.debug("setContext", context);
		const prevCustomerId = this.#context.customerId;
		this.#context = { ...this.#context, ...context };
		this.cart.setContext(context);
		this.wishlist.setContext(context);
		this.order.setContext(context);
		this.customer.setContext(context);
		this.payment.setContext(context);
		this.product.setContext(context);

		const newCustomerId = this.#context.customerId;
		if (
			this.#autoResetOnIdentityChange && prevCustomerId !== newCustomerId
		) {
			this.#clog.debug("identity changed; resetting domains", {
				from: prevCustomerId,
				to: newCustomerId,
			});
			this.reset();
			this.ready = this.initialize(this.#initDomains);
		}
	}

	/**
	 * Atomically switch to a new identity: merge context, reset all domains,
	 * and re-initialize. Returns a promise that settles when the re-init
	 * completes. Use this instead of `setContext` when you need to await
	 * the identity switch (also updates `suite.ready`).
	 *
	 * Works even when `autoResetOnIdentityChange: false`.
	 */
	async switchIdentity(context: DomainContext): Promise<void> {
		this.#clog.debug("switchIdentity", context);
		this.#context = { ...this.#context, ...context };
		this.cart.setContext(context);
		this.wishlist.setContext(context);
		this.order.setContext(context);
		this.customer.setContext(context);
		this.payment.setContext(context);
		this.product.setContext(context);

		this.reset();
		this.ready = this.initialize(this.#initDomains);
		await this.ready;
	}

	/** Get the current context */
	getContext(): DomainContext {
		return { ...this.#context };
	}

	/** Subscribe to specific event type */
	on(eventType: ECSuiteEventType, callback: Subscriber): Unsubscriber {
		return this.#pubsub.subscribe(eventType, callback);
	}

	/** Subscribe to all events (receives { event, data } envelope) */
	onAny(
		callback: (envelope: { event: string; data: ECSuiteEvent }) => void,
	): Unsubscriber {
		return this.#pubsub.subscribe("*", callback);
	}

	/** Subscribe once to an event */
	once(eventType: ECSuiteEventType, callback: Subscriber): Unsubscriber {
		return this.#pubsub.subscribeOnce(eventType, callback);
	}

	/**
	 * Register a callback for when any domain starts an operation.
	 * Fires on every state transition to "syncing".
	 *
	 * @param callback - Called with domain name and previous state
	 * @returns Unsubscribe function
	 */
	onBeforeSync(
		callback: (info: {
			domain: DomainName;
			previousState: DomainState;
		}) => void,
	): Unsubscriber {
		return this.#pubsub.subscribe(
			"domain:state:changed",
			(event: StateChangedEvent) => {
				if (event.newState === "syncing") {
					callback({
						domain: event.domain,
						previousState: event.previousState,
					});
				}
			},
		);
	}

	/**
	 * Register a callback for when any domain completes or fails
	 * an operation.
	 *
	 * @param callback - Called with operation result info
	 * @returns Unsubscribe function
	 */
	onAfterSync(
		callback: (info: {
			domain: DomainName;
			success: boolean;
			error?: DomainError;
		}) => void,
	): Unsubscriber {
		const unsub1 = this.#pubsub.subscribe(
			"domain:synced",
			(event: SyncedEvent) => {
				callback({ domain: event.domain, success: true });
			},
		);
		const unsub2 = this.#pubsub.subscribe(
			"domain:error",
			(event: ErrorEvent) => {
				callback({
					domain: event.domain,
					success: false,
					error: event.error,
				});
			},
		);
		return combineUnsubscribers(unsub1, unsub2);
	}

	/** Reset all domains to initial state */
	reset(): void {
		this.#clog.debug("reset all domains");
		this.cart.reset();
		this.wishlist.reset();
		this.order.reset();
		this.customer.reset();
		this.payment.reset();
		this.product.clearCache();
	}

	/**
	 * Tear down the suite: unsubscribe all listeners on the internal pubsub
	 * and clear the product cache. Use when the consumer (e.g., a SPA
	 * lifecycle hook) is done with the suite — long-lived apps that recreate
	 * suites otherwise leak subscribers across instances.
	 *
	 * Persisted storage is intentionally NOT cleared (cart/wishlist data
	 * should survive page reloads); call `reset()` first if you also want
	 * to wipe in-memory state.
	 */
	destroy(): void {
		this.#clog.debug("destroy");
		this.product.clearCache();
		this.#pubsub.unsubscribeAll();
	}
}

/**
 * Factory function to create an ECSuite instance.
 *
 * @param config - Optional configuration for the suite
 * @returns A new ECSuite instance
 *
 * @example
 * ```typescript
 * const suite = createECSuite({
 *   context: { customerId: "user-123" },
 *   adapters: {
 *     cart: myCartAdapter,
 *     wishlist: myWishlistAdapter,
 *   },
 *   storage: { type: "local" },
 * });
 * ```
 */
export function createECSuite(config?: ECSuiteConfig): ECSuite {
	return new ECSuite(config);
}
