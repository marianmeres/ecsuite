import { assertEquals, assertExists } from "@std/assert";
import { createClog } from "@marianmeres/clog";
import { createECSuite, ECSuite } from "../src/suite.ts";
import { createMockCartAdapter } from "../src/adapters/mock/cart.ts";
import { createMockWishlistAdapter } from "../src/adapters/mock/wishlist.ts";
import { createMockOrderAdapter } from "../src/adapters/mock/order.ts";
import { createMockCustomerAdapter } from "../src/adapters/mock/customer.ts";
import { createMockPaymentAdapter } from "../src/adapters/mock/payment.ts";
import type { ECSuiteEvent, ErrorEvent } from "../src/types/events.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.test.beforeEach(() => {
	createClog.global.debug = false;
});

Deno.test.afterEach(() => {
	createClog.reset();
});

Deno.test("createECSuite creates instance with defaults", () => {
	const suite = createECSuite({
		autoInitialize: false,
		storage: { type: "memory" },
	});

	assertExists(suite);
	assertExists(suite.cart);
	assertExists(suite.wishlist);
	assertExists(suite.order);
	assertExists(suite.customer);
	assertExists(suite.payment);
});

Deno.test("ECSuite initializes all domains", async () => {
	const suite = createECSuite({
		autoInitialize: false,
		storage: {
			type: "memory",
			cartKey: `test-cart-${Date.now()}`,
			wishlistKey: `test-wishlist-${Date.now()}`,
		},
	});

	await suite.initialize();

	assertEquals(suite.cart.get().state, "ready");
	assertEquals(suite.wishlist.get().state, "ready");
	assertEquals(suite.order.get().state, "ready");
	assertEquals(suite.customer.get().state, "ready");
	assertEquals(suite.payment.get().state, "ready");
});

Deno.test("ECSuite passes adapters to domains", async () => {
	const cartAdapter = createMockCartAdapter({
		initialData: { items: [{ product_id: "p1", quantity: 2 }] },
		delay: 10,
	});
	const wishlistAdapter = createMockWishlistAdapter({
		initialData: { items: [{ product_id: "p2", added_at: 1 }] },
		delay: 10,
	});

	const suite = createECSuite({
		autoInitialize: false,
		adapters: {
			cart: cartAdapter,
			wishlist: wishlistAdapter,
		},
		storage: {
			type: "memory",
			cartKey: `test-cart-${Date.now()}`,
			wishlistKey: `test-wishlist-${Date.now()}`,
		},
	});

	await suite.initialize();

	assertEquals(suite.cart.getItemCount(), 2);
	assertEquals(suite.wishlist.getItemCount(), 1);
});

Deno.test("ECSuite setContext updates all domains", async () => {
	const suite = createECSuite({
		autoInitialize: false,
		context: { customerId: "initial" },
		storage: {
			type: "memory",
			cartKey: `test-cart-${Date.now()}`,
			wishlistKey: `test-wishlist-${Date.now()}`,
		},
	});

	assertEquals(suite.getContext().customerId, "initial");

	suite.setContext({ customerId: "updated", sessionId: "sess-1" });

	assertEquals(suite.getContext().customerId, "updated");
	assertEquals(suite.getContext().sessionId, "sess-1");

	// Verify domains got the update
	assertEquals(suite.cart.getContext().customerId, "updated");
	assertEquals(suite.wishlist.getContext().customerId, "updated");
});

Deno.test("ECSuite on subscribes to events", async () => {
	const events: ECSuiteEvent[] = [];

	const cartAdapter = createMockCartAdapter({ delay: 10 });
	const suite = createECSuite({
		autoInitialize: false,
		adapters: { cart: cartAdapter },
		storage: {
			type: "memory",
			cartKey: `test-cart-${Date.now()}`,
			wishlistKey: `test-wishlist-${Date.now()}`,
		},
	});

	suite.on("cart:item:added", (event) => events.push(event));

	await suite.initialize();
	await suite.cart.addItem({ product_id: "p1", quantity: 1 });

	assertEquals(events.length, 1);
	assertEquals(events[0].type, "cart:item:added");
});

Deno.test("ECSuite onAny receives all events", async () => {
	const events: { event: string; data: ECSuiteEvent }[] = [];

	const cartAdapter = createMockCartAdapter({ delay: 10 });
	const suite = createECSuite({
		autoInitialize: false,
		adapters: { cart: cartAdapter },
		storage: {
			type: "memory",
			cartKey: `test-cart-${Date.now()}`,
			wishlistKey: `test-wishlist-${Date.now()}`,
		},
	});

	suite.onAny((envelope) => events.push(envelope));

	await suite.initialize();
	await suite.cart.addItem({ product_id: "p1", quantity: 1 });

	// Should have received multiple events (state changes, synced, item:added)
	const eventTypes = events.map((e) => e.event);
	assertEquals(eventTypes.includes("cart:item:added"), true);
});

Deno.test("ECSuite once subscribes only once", async () => {
	let callCount = 0;

	const cartAdapter = createMockCartAdapter({ delay: 10 });
	const suite = createECSuite({
		autoInitialize: false,
		adapters: { cart: cartAdapter },
		storage: {
			type: "memory",
			cartKey: `test-cart-${Date.now()}`,
			wishlistKey: `test-wishlist-${Date.now()}`,
		},
	});

	suite.once("cart:item:added", () => callCount++);

	await suite.initialize();
	await suite.cart.addItem({ product_id: "p1", quantity: 1 });
	await suite.cart.addItem({ product_id: "p2", quantity: 1 });

	assertEquals(callCount, 1); // Only called once
});

Deno.test("ECSuite reset clears all domains", async () => {
	const cartAdapter = createMockCartAdapter({
		initialData: { items: [{ product_id: "p1", quantity: 2 }] },
		delay: 10,
	});

	const suite = createECSuite({
		autoInitialize: false,
		adapters: { cart: cartAdapter },
		storage: {
			type: "memory",
			cartKey: `test-cart-${Date.now()}`,
			wishlistKey: `test-wishlist-${Date.now()}`,
		},
	});

	await suite.initialize();
	assertEquals(suite.cart.getItemCount(), 2);

	suite.reset();

	assertEquals(suite.cart.get().state, "initializing");
	assertEquals(suite.cart.get().data, null);
});

Deno.test("ECSuite handles errors from domains", async () => {
	const errors: ErrorEvent[] = [];

	const cartAdapter = createMockCartAdapter({
		delay: 10,
		forceError: { operation: "addItem", message: "Server error" },
	});

	const suite = createECSuite({
		autoInitialize: false,
		adapters: { cart: cartAdapter },
		storage: {
			type: "memory",
			cartKey: `test-cart-${Date.now()}`,
			wishlistKey: `test-wishlist-${Date.now()}`,
		},
	});

	suite.on("domain:error", (event) => errors.push(event as ErrorEvent));

	await suite.initialize();
	await suite.cart.addItem({ product_id: "p1", quantity: 1 });

	assertEquals(errors.length, 1);
	assertEquals(errors[0].domain, "cart");
	assertEquals(errors[0].error.operation, "addItem");
});

Deno.test("ECSuite full workflow", async () => {
	const cartAdapter = createMockCartAdapter({ delay: 10 });
	const wishlistAdapter = createMockWishlistAdapter({ delay: 10 });
	const orderAdapter = createMockOrderAdapter({ delay: 10 });
	const customerAdapter = createMockCustomerAdapter({
		initialData: {
			email: "test@example.com",
			first_name: "Test",
			last_name: "User",
			guest: false,
			accepts_marketing: true,
		},
		delay: 10,
	});

	const suite = createECSuite({
		autoInitialize: false,
		context: { customerId: "cust-1" },
		adapters: {
			cart: cartAdapter,
			wishlist: wishlistAdapter,
			order: orderAdapter,
			customer: customerAdapter,
		},
		storage: {
			type: "memory",
			cartKey: `test-cart-${Date.now()}`,
			wishlistKey: `test-wishlist-${Date.now()}`,
		},
	});

	// Initialize
	await suite.initialize();

	// Add to cart
	await suite.cart.addItem({ product_id: "prod-1", quantity: 2 });
	await suite.cart.addItem({ product_id: "prod-2", quantity: 1 });
	assertEquals(suite.cart.getItemCount(), 3);

	// Add to wishlist
	await suite.wishlist.addItem("prod-3");
	assertEquals(suite.wishlist.getItemCount(), 1);

	// Check customer loaded
	assertEquals(suite.customer.getEmail(), "test@example.com");

	// Create order
	const order = await suite.order.create({
		items: [
			{ product_id: "prod-1", name: "Product 1", price: 100, quantity: 2 },
			{ product_id: "prod-2", name: "Product 2", price: 50, quantity: 1 },
		],
		currency: "EUR",
		totals: { subtotal: 250, tax: 50, shipping: 10, discount: 0, total: 310 },
		shipping_address: {
			name: "Test User",
			street: "123 Main St",
			city: "Test City",
			postal_code: "12345",
			country: "US",
			is_default: true,
		},
		billing_address: {
			name: "Test User",
			street: "123 Main St",
			city: "Test City",
			postal_code: "12345",
			country: "US",
			is_default: true,
		},
	});

	assertExists(order);
	assertEquals(suite.order.getOrderCount(), 1);

	// All domains should be ready
	assertEquals(suite.cart.get().state, "ready");
	assertEquals(suite.wishlist.get().state, "ready");
	assertEquals(suite.order.get().state, "ready");
	assertEquals(suite.customer.get().state, "ready");
});
