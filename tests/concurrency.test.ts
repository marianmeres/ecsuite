/**
 * Tests covering scenarios that previously broke due to:
 * - B3: race between concurrent optimistic updates
 * - B2: null-data rollback skipped, leaving stale optimistic state
 * - B4: autoInitialize race (mutation hits before init fetch settles)
 * - B5: identity switch not invalidating data
 *
 * These would not have been caught by the prior suite (no Promise.all, no
 * identity-transition tests, no null-rollback assertions).
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { createClog } from "@marianmeres/clog";
import { CartManager } from "../src/domains/cart.ts";
import { createMockCartAdapter } from "../src/adapters/mock/cart.ts";
import { createECSuite } from "../src/suite.ts";
import { createMockCustomerAdapter } from "../src/adapters/mock/customer.ts";

Deno.test.beforeEach(() => {
	createClog.global.debug = false;
});

Deno.test.afterEach(() => {
	createClog.reset();
});

let _keyCounter = 0;
const uniqueKey = (prefix: string) =>
	`${prefix}-${Date.now()}-${++_keyCounter}`;

// --- B3: concurrent mutations ---

Deno.test("B3: concurrent addItem calls converge to server truth", async () => {
	const adapter = createMockCartAdapter({ delay: 20 });
	const cart = new CartManager({
		adapter,
		storageType: "memory",
		storageKey: uniqueKey("test-cart"),
	});
	await cart.initialize();

	// Fire three mutations concurrently. Without serialization, the third's
	// snapshot would include the first's optimistic state, and a failure on
	// any of them would restore an optimistic-state-as-truth.
	await Promise.all([
		cart.addItem({ product_id: "p1", quantity: 1 }),
		cart.addItem({ product_id: "p2", quantity: 1 }),
		cart.addItem({ product_id: "p3", quantity: 1 }),
	]);

	const items = cart.get().data?.items ?? [];
	assertEquals(items.length, 3);
	assertEquals(cart.get().state, "ready");
});

Deno.test("B3: failed mutation in middle of queue does not poison subsequent ones", async () => {
	let callCount = 0;
	const adapter = createMockCartAdapter({ delay: 5 });
	const realAdd = adapter.addItem;
	adapter.addItem = (item, ctx) => {
		callCount++;
		if (callCount === 2) {
			return Promise.reject(new Error("Simulated server error"));
		}
		return realAdd.call(adapter, item, ctx);
	};

	const cart = new CartManager({
		adapter,
		storageType: "memory",
		storageKey: uniqueKey("test-cart"),
	});
	await cart.initialize();

	const results = await Promise.allSettled([
		cart.addItem({ product_id: "p1", quantity: 1 }),
		cart.addItem({ product_id: "p2", quantity: 1 }),
		cart.addItem({ product_id: "p3", quantity: 1 }),
	]);

	assertEquals(results[0].status, "fulfilled");
	assertEquals(results[1].status, "fulfilled"); // op resolves; rollback emits domain:error
	assertEquals(results[2].status, "fulfilled");

	// p2 was rolled back (server rejected); p1 and p3 made it through.
	const ids = (cart.get().data?.items ?? []).map((i) => i.product_id).sort();
	assertEquals(ids, ["p1", "p3"]);
});

// --- B2: null-data rollback ---

Deno.test("B2: rollback restores null when previous data was null", async () => {
	// Start with no persisted data and force initialize to fail so data stays null.
	const adapter = createMockCartAdapter({
		delay: 5,
		forceError: { operation: "fetch" },
	});
	const cart = new CartManager({
		adapter,
		storageType: "memory",
		storageKey: uniqueKey("test-cart-null"),
	});
	await cart.initialize();
	assertEquals(cart.get().data, null);
	assertEquals(cart.get().state, "error");

	// Now also fail addItem; previous data is null so rollback must restore null.
	const failAdapter = createMockCartAdapter({
		delay: 5,
		forceError: { operation: "addItem" },
	});
	cart.setAdapter(failAdapter);
	await cart.addItem({ product_id: "p1", quantity: 1 });

	assertEquals(cart.get().state, "error");
	// Critical: must NOT have stale optimistic items.
	assertEquals(cart.get().data, null);
});

// --- B4: autoInitialize race ---

Deno.test("B4: suite.ready resolves before consumer mutations are safe", async () => {
	const adapter = createMockCartAdapter({ delay: 30 });
	const suite = createECSuite({
		adapters: { cart: adapter },
		storage: {
			type: "memory",
			cartKey: uniqueKey("test-cart"),
			wishlistKey: uniqueKey("test-wishlist"),
		},
	});

	// `await suite.ready` is the new contract. Without it, a concurrent
	// addItem races the in-flight initialize() fetch.
	await suite.ready;
	await suite.cart.addItem({ product_id: "p1", quantity: 2 });

	assertEquals(suite.cart.getItemCount(), 2);
	assertEquals(suite.cart.get().state, "ready");
});

// --- B5: identity switch ---

Deno.test("B5: setContext with new customerId resets and re-initializes", async () => {
	const customerAdapter = createMockCustomerAdapter({
		initialData: {
			email: "alice@example.com",
			first_name: "Alice",
			last_name: "Smith",
			phone: "",
			guest: false,
			accepts_marketing: false,
		},
		delay: 5,
	});
	const suite = createECSuite({
		context: { customerId: "alice" },
		adapters: { customer: customerAdapter },
		autoInitialize: false,
		storage: {
			type: "memory",
			cartKey: uniqueKey("test-cart"),
			wishlistKey: uniqueKey("test-wishlist"),
		},
	});
	await suite.initialize();
	assertEquals(suite.customer.getEmail(), "alice@example.com");

	// Switch identity; the auto-reset path should clear stale customer data
	// and re-initialize.
	suite.setContext({ customerId: "bob" });
	// `ready` is updated by setContext when identity changes.
	await suite.ready;

	assertEquals(suite.customer.getContext().customerId, "bob");
	assertEquals(suite.customer.get().state, "ready");
});

Deno.test("B5: switchIdentity returns a promise that settles after re-init", async () => {
	const customerAdapter = createMockCustomerAdapter({
		initialData: {
			email: "alice@example.com",
			first_name: "Alice",
			last_name: "Smith",
			phone: "",
			guest: false,
			accepts_marketing: false,
		},
		delay: 5,
	});
	const suite = createECSuite({
		context: { customerId: "alice" },
		adapters: { customer: customerAdapter },
		autoResetOnIdentityChange: false, // explicit-only mode
		storage: {
			type: "memory",
			cartKey: uniqueKey("test-cart"),
			wishlistKey: uniqueKey("test-wishlist"),
		},
	});
	await suite.ready;
	const before = suite.customer.getEmail();
	assertNotEquals(before, null);

	await suite.switchIdentity({ customerId: "bob" });

	assertEquals(suite.customer.getContext().customerId, "bob");
	assertEquals(suite.customer.get().state, "ready");
});

// --- B1: order de-duplication via model_id ---

Deno.test("B1: fetchOne does not duplicate; updates by model_id", async () => {
	const { OrderManager } = await import("../src/domains/order.ts");
	const { createMockOrderAdapter } = await import(
		"../src/adapters/mock/order.ts"
	);

	const adapter = createMockOrderAdapter({
		initialData: [
			{
				status: "pending",
				items: [],
				currency: "EUR",
				totals: { subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 0 },
			},
		],
		delay: 5,
	});
	const orders = new OrderManager({ adapter });
	await orders.initialize();
	assertEquals(orders.getOrderCount(), 1);

	// Fetch the same order twice — must NOT append duplicates.
	await orders.fetchOne("order-1");
	await orders.fetchOne("order-1");
	assertEquals(orders.getOrderCount(), 1);

	const fetched = orders.getOrderById("order-1");
	assertEquals(fetched?.model_id, "order-1");
});
