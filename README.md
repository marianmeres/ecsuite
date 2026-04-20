# @marianmeres/ecsuite

[![NPM Version](https://img.shields.io/npm/v/@marianmeres/ecsuite)](https://www.npmjs.com/package/@marianmeres/ecsuite)
[![JSR Version](https://img.shields.io/jsr/v/@marianmeres/ecsuite)](https://jsr.io/@marianmeres/ecsuite)
[![License](https://img.shields.io/github/license/marianmeres/ecsuite)](LICENSE)

E-commerce frontend UI helper library with optimistic updates, Svelte-compatible stores,
and adapter-based server sync.

## Features

- **Optimistic Updates**: UI updates immediately, syncs with server asynchronously
- **Svelte-Compatible Stores**: All domains expose a `subscribe()` method
- **Adapter Pattern**: Pluggable server communication (REST, WebSocket, mock)
- **Event System**: Subscribe to domain events for error handling and UI feedback
- **Local Persistence**: Cart and wishlist are saved to localStorage

## Installation

```bash
# Deno
deno add @marianmeres/ecsuite

# npm
npm install @marianmeres/ecsuite
```

## Quick Start

```typescript
import { createECSuite } from "@marianmeres/ecsuite";

// Create suite with your adapters
const suite = createECSuite({
	context: { customerId: "user-123" },
	adapters: {
		cart: myCartAdapter,
		wishlist: myWishlistAdapter,
		order: myOrderAdapter,
		customer: myCustomerAdapter,
	},
});

// `autoInitialize` is true by default; await `suite.ready` so consumer
// mutations don't race the in-flight initial fetches.
await suite.ready;

// Subscribe to cart state (Svelte-compatible)
suite.cart.subscribe((state) => {
	console.log(state.state, state.data);
	// state.state: "initializing" | "ready" | "syncing" | "error"
	// state.data: CartData | null
});

// Listen for errors
suite.on("domain:error", (event) => {
	showToast(event.error.message);
});

// Add item (optimistic update)
await suite.cart.addItem({ product_id: "prod-1", quantity: 2 });
```

### Identity switches (login / logout)

When the user signs in or out, use `switchIdentity()` (or just call
`setContext()` with a different `customerId` — auto-reset is on by default):

```typescript
await suite.switchIdentity({ customerId: "another-user" });
// All domains reset, re-initialized for the new identity, and `suite.ready`
// resolves once the new fetches settle.
```

### Teardown

```typescript
suite.destroy(); // unsubscribes every internal event listener
```

## Domains

| Domain   | Persistence  | Operations                          |
| -------- | ------------ | ----------------------------------- |
| Cart     | localStorage | add, update, remove, clear          |
| Wishlist | localStorage | add, remove, toggle, clear          |
| Order    | none         | fetchAll, fetchOne, create          |
| Customer | none         | fetch, refresh, update              |
| Payment  | none         | fetchForOrder, fetchOne (read-only) |
| Product  | cache only   | getById, getByIds, prefetch         |

## State Machine

Each domain follows this state progression:

```
initializing → ready ↔ syncing → error
```

- **initializing**: Fetching initial data
- **ready**: Data loaded, idle
- **syncing**: Operation in progress
- **error**: Last operation failed (includes rollback)

## Creating Adapters

Implement the adapter interface for your backend:

```typescript
import type { CartAdapter } from "@marianmeres/ecsuite";
import { HTTP_ERROR } from "@marianmeres/http-utils";

const myCartAdapter: CartAdapter = {
	async fetch(ctx) {
		const res = await fetch(`/api/cart?customerId=${ctx.customerId}`);
		if (!res.ok) throw new HTTP_ERROR.BadRequest("Failed to fetch cart");
		return await res.json();
	},
	async addItem(item, ctx) {
		const res = await fetch("/api/cart/items", {
			method: "POST",
			body: JSON.stringify(item),
		});
		if (!res.ok) throw new HTTP_ERROR.BadRequest("Failed to add item");
		return await res.json();
	},
	// ... other methods
};
```

## Testing with Mock Adapters

```typescript
import { createECSuite, createMockCartAdapter } from "@marianmeres/ecsuite";

const suite = createECSuite({
	adapters: {
		cart: createMockCartAdapter({
			initialData: { items: [{ product_id: "p1", quantity: 2 }] },
			delay: 100,
		}),
	},
	storage: { type: "memory" },
});
```

## Built-in HTTP Adapters

For consumers whose backend exposes the conventional commerce REST surface,
ecsuite ships ready-to-use HTTP adapters for every domain. Each factory
takes `{ baseUrl?, fetch? }`; authentication is carried on the context
passed into each call (`ctx.sessionId` → `X-Session-ID`; `ctx.jwt` →
`Authorization: Bearer <jwt>`).

```typescript
import {
	createECSuite,
	createHttpCartAdapter,
	createHttpCustomerAdapter,
	createHttpOrderAdapter,
	createHttpPaymentAdapter,
	createHttpProductAdapter,
	createHttpWishlistAdapter,
} from "@marianmeres/ecsuite";

const suite = createECSuite({
	context: { sessionId: mySessionId, jwt: myJwt, customerId: myCustomerId },
	adapters: {
		cart: createHttpCartAdapter({ baseUrl: "/api/session" }),
		wishlist: createHttpWishlistAdapter({ baseUrl: "/api/session" }),
		order: createHttpOrderAdapter({ baseUrl: "/api/order" }),
		customer: createHttpCustomerAdapter({ baseUrl: "/api/customer" }),
		payment: createHttpPaymentAdapter({ baseUrl: "/api/payment" }),
		product: createHttpProductAdapter({ baseUrl: "/api/product" }),
	},
});
```

Expected endpoints per adapter (all mutations require `X-Session-ID`, all
owner-scoped reads require a JWT):

| Adapter  | Endpoints                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------- |
| cart     | `GET/POST/PUT/DELETE {baseUrl}/cart` (DELETE with optional `?product_id=` for single-item remove)   |
| wishlist | `GET/POST/DELETE {baseUrl}/wishlist` (DELETE with optional `?product_id=` for single-item remove)   |
| order    | `GET {baseUrl}/col/order`, `GET {baseUrl}/col/order/:id`, `POST {baseUrl}/checkout/start`           |
| customer | `GET/PUT {baseUrl}/me/col/customer/:customerId`                                                     |
| payment  | `GET {baseUrl}/by-order/:orderId`, `GET {baseUrl}/col/payment/:id`, `POST {baseUrl}/initiate` (body: `{ order_id, provider, return_url, cancel_url }` — server derives amount/currency from the order record) |
| product  | `GET {baseUrl}/col/product/:id` (`fetchMany` = parallel single fetches — no batch endpoint assumed) |

Adapters throw raw HTTP errors (`Error` with `.status` and `.body`
attached); the domain manager normalizes them to `DomainError`. Responses
may use `{ model_id, data }` model envelopes — adapters unwrap them
transparently.

`PaymentAdapter.capture` is intentionally omitted from
`createHttpPaymentAdapter`; capture is typically driven server-side by
provider webhooks + checkout completion. Calls to `suite.payment.capture()`
will surface as `NOT_IMPLEMENTED`.

See [`example/`](./example/) for a vanilla-JS reference harness exercising
every public verb against either the HTTP adapters or the mock adapters.

## Events

Subscribe to domain events:

```typescript
suite.on("cart:item:added", (event) => {
	console.log(`Added ${event.quantity} of ${event.productId}`);
});

suite.onAny(({ event, data }) => {
	console.log(event, data);
});

suite.once("order:created", (event) => {
	redirectToConfirmation(event.orderId);
});
```

## API Reference

For complete API documentation, see [API.md](API.md).

## Migration to next major

This release tightens correctness in several places. Breaking changes:

- **`OrderAdapter` returns `OrderCreateResult`** for both `fetchAll` and
  `fetchOne` (`{ model_id, data }`) so orders are uniquely identifiable.
  `OrderListData.orders` is now `OrderCreateResult[]`. Use the new
  `orders.getOrderById(modelId)` / `getOrderDataById(modelId)` helpers, or
  read `result.data.<field>` on returned envelopes.
- **`CartAdapter.sync()` and `WishlistAdapter.sync()` removed** — they were
  never called by the manager.
- **`PaymentManager.initiate()` / `capture()` throw `NOT_IMPLEMENTED`** when
  the adapter doesn't implement the optional method (previously returned
  `null` silently). `domain:error` is also emitted.
- **`CustomerManager.update()` throws `NOT_IMPLEMENTED`** when no adapter is
  configured (previously silent no-op).
- **`CustomerManager` no longer falls through to `fetch()`** when both
  `customerId` is missing AND `adapter.fetchBySession` is undefined; it
  now warns and stays in `ready` with `data: null`. Pass `customerId` in
  context, or implement `fetchBySession`.
- **`CartManager.addItem` / `updateItemQuantity`** validate the quantity
  (must be a finite, non-negative integer); invalid values throw at the
  call site instead of being persisted optimistically.
- **`ProductManager` now extends `BaseDomainManager`** — exposes `subscribe`,
  emits `domain:error`, and gains an `initialize()` no-op. `setAdapter` /
  `getAdapter` / `setContext` / `getContext` keep the same signatures.
- **`InitializableDomainName`** now includes `"product"` for parity with
  the other domains.

New additions:

- `suite.ready: Promise<void>` — resolves when the most recent (auto or
  manual) `initialize()` settles.
- `suite.switchIdentity(context)` — atomic identity switch (merge context,
  reset domains, re-initialize). Returns a promise.
- `suite.destroy()` — unsubscribes all internal pubsub listeners.
- `ECSuiteConfig.autoResetOnIdentityChange` (default `true`) — opt out of
  the auto-reset path on `setContext()` if you manage identity transitions
  yourself.
- `OrderManager.getOrderById(modelId)` / `getOrderDataById(modelId)` lookup
  helpers.
- Per-domain mutation queue (`withOptimisticUpdate` is serialized per
  manager) — concurrent `cart.addItem(...)` calls no longer race their
  rollback snapshots.
- Cache stampede dedup in `ProductManager.getById` — concurrent callers
  for the same id share a single in-flight request.
- Mock adapters now dispatch `forceError.code` (any name from `HTTP_ERROR`)
  so tests can simulate `NotFound`, `Conflict`, etc., not just `BadRequest`.

## License

MIT
