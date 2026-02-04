# AGENTS.md - @marianmeres/ecsuite

Machine-readable documentation for AI coding assistants.

## Package Overview

```yaml
name: "@marianmeres/ecsuite"
version: "1.1.1"
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
├── OrderManager     [server-only, read + create]
├── CustomerManager  [server-only, read + update]
├── PaymentManager   [server-only, read-only]
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
export { ECSuite, createECSuite, ECSuiteConfig } from "./suite.ts";

// Types
export {
  DomainState, DomainError, DomainStateWrapper, DomainContext,
  WishlistItem, WishlistData, EnrichedCartItem, EnrichedWishlistItem,
  CartAdapter, WishlistAdapter, OrderAdapter,
  CustomerAdapter, PaymentAdapter, ProductAdapter, OrderCreatePayload,
  DomainName, ECSuiteEventType, ECSuiteEvent, /* ...event interfaces */
} from "./types/mod.ts";

// Domain Managers
export {
  BaseDomainManager, BaseDomainOptions, StorageType,
  CartManager, CartManagerOptions,
  WishlistManager, WishlistManagerOptions,
  OrderManager, OrderManagerOptions, OrderListData,
  CustomerManager, CustomerManagerOptions,
  PaymentManager, PaymentManagerOptions, PaymentListData,
  ProductManager, ProductManagerOptions,
} from "./domains/mod.ts";

// Mock Adapters
export {
  createMockCartAdapter, MockCartAdapterOptions,
  createMockWishlistAdapter, MockWishlistAdapterOptions,
  createMockOrderAdapter, MockOrderAdapterOptions,
  createMockCustomerAdapter, MockCustomerAdapterOptions,
  createMockPaymentAdapter, MockPaymentAdapterOptions,
  createMockProductAdapter, MockProductAdapterOptions,
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

### Subscribing to Store (Svelte-compatible)

```typescript
suite.cart.subscribe((state) => {
  // state: { state, data, error, lastSyncedAt }
});
```

### Event Handling

```typescript
suite.on("cart:item:added", (event) => { /* ... */ });
suite.onAny(({ event, data }) => { /* ... */ });
suite.once("order:created", (event) => { /* ... */ });
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
deno test           # Run all tests (93 tests)
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

5. **Context**: DomainContext (customerId, sessionId) passed to all adapter methods for server-side identification.
