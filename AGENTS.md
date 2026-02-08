# AGENTS.md - @marianmeres/ecsuite

Machine-readable documentation for AI coding assistants.

## Package Overview

```yaml
name: "@marianmeres/ecsuite"
version: "1.1.4"
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
├── CartManager      [localStorage, optimistic updates]
├── WishlistManager  [localStorage, optimistic updates]
├── OrderManager     [server-only, read + create (returns model_id)]
├── CustomerManager  [server-only, read + update + fetchBySession]
├── PaymentManager   [server-only, read + initiate + capture]
└── ProductManager   [in-memory cache with TTL]
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
});
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

1. **Optimistic Updates**: `_withOptimisticUpdate()` in BaseDomainManager captures previous state before mutation, rolls back on server error.

2. **Persistence**: Cart and Wishlist use `@marianmeres/store` with `createStoragePersistor()` for localStorage/sessionStorage.

3. **ProductManager**: Does NOT extend BaseDomainManager. Uses simple Map cache with TTL instead of state machine.

4. **Event System**: Shared PubSub instance passed through ECSuite constructor. Events typed with discriminated union.

5. **Context**: DomainContext (customerId, sessionId, + arbitrary properties via index signature) passed to all adapter methods for server-side identification.

6. **OrderCreateResult**: `OrderAdapter.create()` returns `{ model_id, data }` so consumers always get the server-assigned model ID.

7. **Payment Write Ops**: `PaymentAdapter.initiate?()` and `capture?()` are optional methods. `PaymentManager` null-checks before calling, returns null when unavailable.

8. **Guest Checkout**: `CustomerAdapter.fetchBySession?()` is optional. `CustomerManager` uses it when `customerId` is absent in context, falls back to `fetch()` when unavailable.

9. **Operation Hooks**: `ECSuite.onBeforeSync()` and `onAfterSync()` are convenience wrappers over the existing event system (no changes to BaseDomainManager).
