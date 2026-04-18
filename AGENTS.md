# AGENTS.md - @marianmeres/ecsuite

Machine-readable documentation for AI coding assistants.

## Package Overview

```yaml
name: "@marianmeres/ecsuite"
version: "1.3.2"
type: "library"
language: "typescript"
runtime: "deno"
npm_compatible: true
license: "MIT"
```

## Purpose

E-commerce frontend UI state management library providing:

- Optimistic updates with automatic rollback
- Svelte-compatible reactive stores
- Pluggable adapter pattern for server communication
- Pub/sub event system
- Local persistence for cart/wishlist

## Architecture

```
ECSuite (orchestrator)
├── CartManager      [localStorage, optimistic updates, per-domain mutation queue]
├── WishlistManager  [localStorage, optimistic updates, per-domain mutation queue]
├── OrderManager     [server-only, read + create — list of {model_id, data}]
├── CustomerManager  [server-only, read + update + fetchBySession]
├── PaymentManager   [server-only, read + initiate + capture (throw NOT_IMPL)]
└── ProductManager   [in-memory TTL cache; extends BaseDomainManager;
                      in-flight dedup; emits domain:error]
```

## Directory Structure

```
src/
├── mod.ts                    # Main entry point
├── suite.ts                  # ECSuite orchestrator
├── types/
│   ├── mod.ts                # Type re-exports
│   ├── adapter.ts            # Adapter interfaces
│   ├── events.ts             # Event types
│   └── state.ts              # State types
├── domains/
│   ├── mod.ts                # Domain re-exports
│   ├── base.ts               # BaseDomainManager abstract class
│   ├── cart.ts               # CartManager
│   ├── wishlist.ts           # WishlistManager
│   ├── order.ts              # OrderManager
│   ├── customer.ts           # CustomerManager
│   ├── payment.ts            # PaymentManager
│   └── product.ts            # ProductManager
└── adapters/
    ├── mod.ts                # Adapter exports
    └── mock/                 # Mock adapters for testing
        ├── mod.ts
        ├── cart.ts
        ├── wishlist.ts
        ├── order.ts
        ├── customer.ts
        ├── payment.ts
        └── product.ts
tests/
├── cart.test.ts
├── wishlist.test.ts
├── order.test.ts
├── customer.test.ts
├── payment.test.ts
├── product.test.ts
└── ecsuite.test.ts
```

## Key Exports

```typescript
// Main
export { createECSuite, ECSuite, ECSuiteConfig } from "./suite.ts";

// Types
export {
	CartAdapter,
	CustomerAdapter,
	DomainContext,
	DomainError,
	DomainName,
	DomainState,
	DomainStateWrapper,
	ECSuiteEvent, /* ...event interfaces */
	ECSuiteEventType,
	EnrichedCartItem,
	EnrichedWishlistItem,
	OrderAdapter,
	OrderCreatePayload,
	OrderCreateResult,
	PaymentAdapter,
	PaymentInitConfig,
	ProductAdapter,
	WishlistAdapter,
	WishlistData,
	WishlistItem,
} from "./types/mod.ts";

// Domain Managers
export {
	BaseDomainManager,
	BaseDomainOptions,
	CartManager,
	CartManagerOptions,
	CustomerManager,
	CustomerManagerOptions,
	OrderListData,
	OrderManager,
	OrderManagerOptions,
	PaymentListData,
	PaymentManager,
	PaymentManagerOptions,
	ProductManager,
	ProductManagerOptions,
	StorageType,
	WishlistManager,
	WishlistManagerOptions,
} from "./domains/mod.ts";

// Mock Adapters
export {
	createMockCartAdapter,
	createMockCustomerAdapter,
	createMockOrderAdapter,
	createMockPaymentAdapter,
	createMockProductAdapter,
	createMockWishlistAdapter,
	MockCartAdapterOptions,
	MockCustomerAdapterOptions,
	MockOrderAdapterOptions,
	MockPaymentAdapterOptions,
	MockProductAdapterOptions,
	MockWishlistAdapterOptions,
} from "./adapters/mod.ts";
```

## State Machine

```
State transitions:
  initializing -> ready
  ready -> syncing
  syncing -> ready (success)
  syncing -> error (failure with rollback)
  error -> syncing (retry)
```

## Common Patterns

### Creating Suite

```typescript
const suite = createECSuite({
	context: { customerId: "uuid" },
	adapters: { cart: myCartAdapter },
	storage: { type: "local" },
	productCacheTtl: 300000,
	autoInitialize: true,
	autoResetOnIdentityChange: true, // default: reset on customerId transition
});

// Avoid the auto-init race: callers should await the suite's readiness
// before issuing mutations.
await suite.ready;
```

### Identity Switch

```typescript
// Atomic: merge context, reset all domains, re-initialize.
await suite.switchIdentity({ customerId: "another" });

// Or via setContext when autoResetOnIdentityChange is enabled.
suite.setContext({ customerId: "another" });
await suite.ready;
```

### Teardown

```typescript
suite.destroy(); // unsubscribes all internal pubsub listeners
```

### Selective Initialization

```typescript
// Skip auth-gated domains for guest users
const suite = createECSuite({
	adapters: { cart: myCartAdapter, order: myOrderAdapter },
	initializeDomains: ["cart", "wishlist", "payment"],
});

// Later, when user authenticates
await suite.initialize(["order", "customer"]);
```

### Subscribing to Store (Svelte-compatible)

```typescript
suite.cart.subscribe((state) => {
	// state: { state, data, error, lastSyncedAt }
});
```

### Event Handling

```typescript
suite.on("cart:item:added", (event) => {/* ... */});
suite.onAny(({ event, data }) => {/* ... */});
suite.once("order:created", (event) => {/* ... */});
```

### Operation Hooks

```typescript
// Fire when any domain starts syncing
const unsub1 = suite.onBeforeSync(({ domain, previousState }) => {/* ... */});

// Fire when any domain completes or fails an operation
const unsub2 = suite.onAfterSync(({ domain, success, error }) => {/* ... */});
```

### Implementing Adapter

```typescript
import { HTTP_ERROR } from "@marianmeres/http-utils";

const myAdapter: CartAdapter = {
	async fetch(ctx) {
		const res = await fetch(`/api/cart`);
		if (!res.ok) throw new HTTP_ERROR.BadRequest("Failed to fetch");
		return await res.json(); // returns CartData directly
	},
	// ... other methods throw HTTP_ERROR on failure
};
```

## Common Tasks

### Add New Domain

1. Create manager in `src/domains/`
2. Add adapter interface in `src/types/adapter.ts`
3. Export from `mod.ts`

### Add New Event

1. Add to `ECSuiteEventType` in `src/types/events.ts`
2. Create interface in `src/types/events.ts`

## Dependencies

```yaml
runtime:
    "@marianmeres/clog": "^3.15.0"
    "@marianmeres/collection-types": "^1.9.0"
    "@marianmeres/http-utils": "^2.5.1"
    "@marianmeres/pubsub": "^2.4.5"
    "@marianmeres/store": "^2.4.2"
dev:
    "@std/assert": "^1.0.16"
    "@std/fs": "^1.0.20"
    "@std/path": "^1.1.3"
```

## Testing

```bash
deno test           # Run all tests (109 tests)
deno test --watch   # Watch mode
```

Test utilities:

- Mock adapters with configurable delay and error injection
- Memory storage type for isolated tests

## Build

```bash
deno task npm:build    # Build for npm
deno task npm:publish  # Build and publish to npm
deno publish           # Publish to JSR
```

## Code Style

- Tabs for indentation
- 90 character line width
- TypeScript strict mode
- JSDoc for all public API

## Important Implementation Details

1. **Optimistic Updates**: `withOptimisticUpdate()` in BaseDomainManager captures previous state before mutation, rolls back to it (including `null`) on server error. Mutations are **serialized per domain** through an internal mutation queue so concurrent callers can't race their rollback snapshots.

2. **Persistence**: Cart and Wishlist use `@marianmeres/store` with `createStoragePersistor()` for localStorage/sessionStorage. (Cross-tab `storage` event sync is NOT yet implemented.)

3. **ProductManager**: Extends BaseDomainManager with `data: null` (cache lives in a private Map). Exposes `subscribe`, emits `domain:error` (without changing state — a single failed product fetch shouldn't blanket the whole domain in error). Uses an in-flight Map to dedup concurrent `getById` callers (prevents stampede on TTL expiry).

4. **Event System**: Shared PubSub instance passed through ECSuite constructor. Events typed with discriminated union.

5. **Context**: DomainContext (customerId, sessionId, + arbitrary properties via index signature) passed to all adapter methods for server-side identification.

6. **OrderListData**: Stores `OrderCreateResult[]` (`{ model_id, data }`). `fetchAll`/`fetchOne`/`create` all return this envelope so orders are uniquely identifiable. Use `getOrderById(modelId)` / `getOrderDataById(modelId)`.

7. **Payment Write Ops**: `PaymentAdapter.initiate?()` and `capture?()` are optional adapter methods. `PaymentManager` **throws** `NOT_IMPLEMENTED` (and emits `domain:error`) when called without an implementation — callers must catch or feature-detect (`adapter.initiate !== undefined`).

8. **Guest Checkout**: `CustomerAdapter.fetchBySession?()` is optional. When `customerId` is absent in context AND `fetchBySession` isn't implemented, `CustomerManager` warns and stays in `ready` with `data: null` — it does NOT silently call `fetch()` anymore (real adapters typically need a `customerId`).

9. **Operation Hooks**: `ECSuite.onBeforeSync()` and `onAfterSync()` are convenience wrappers over the existing event system (no changes to BaseDomainManager).

10. **Identity Switches**: `setContext({ customerId })` auto-resets all domains and re-initializes when the id transitions (default; opt out via `autoResetOnIdentityChange: false`). Awaitable via `suite.ready` or use `suite.switchIdentity()` directly.

11. **Auto-init race**: Constructor with `autoInitialize: true` (default) starts initialize() but cannot await it; consumers should `await suite.ready` before issuing mutations.

12. **Cart Quantity Validation**: `addItem` and `updateItemQuantity` throw `TypeError`/`RangeError` for `NaN`, `Infinity`, fractional, or negative values at the call site (never persisted optimistically).

## Known limitations (not yet fixed)

- **Payment grouping by orderId**: `PaymentManager.getPayments()` returns a flat list. There is no `getPaymentsForOrder(orderId)` helper because `PaymentData` does not carry the order id; consumers fetching for multiple orders must keep their own index.
- **Pagination**: `OrderAdapter.fetchAll` and `PaymentAdapter.fetchForOrder` have no `limit/offset/cursor` params.
- **Cross-tab sync**: localStorage edits in one tab don't propagate to other tabs' stores.
