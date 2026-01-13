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

## License

MIT
