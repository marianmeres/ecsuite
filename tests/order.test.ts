import { assertEquals, assertExists } from "@std/assert";
import { createClog } from "@marianmeres/clog";
import type { OrderData } from "@marianmeres/collection-types";
import { OrderManager } from "../src/domains/order.ts";
import { createMockOrderAdapter } from "../src/adapters/mock/order.ts";

Deno.test.beforeEach(() => {
	createClog.global.debug = false;
});

Deno.test.afterEach(() => {
	createClog.reset();
});

// Helper to create test order data
const createTestOrder = (overrides: Partial<OrderData> = {}): OrderData => ({
	status: "pending",
	items: [{ product_id: "p1", name: "Test Product", price: 100, quantity: 1 }],
	currency: "EUR",
	totals: { subtotal: 100, tax: 20, shipping: 10, discount: 0, total: 130 },
	shipping_address: {
		name: "John Doe",
		street: "123 Main St",
		city: "Test City",
		postal_code: "12345",
		country: "US",
		is_default: true,
	},
	billing_address: {
		name: "John Doe",
		street: "123 Main St",
		city: "Test City",
		postal_code: "12345",
		country: "US",
		is_default: true,
	},
	...overrides,
});

Deno.test("OrderManager initializes with empty orders when no adapter", async () => {
	const orders = new OrderManager();
	await orders.initialize();

	const state = orders.get();
	assertEquals(state.state, "ready");
	assertEquals(state.data?.orders.length, 0);
});

Deno.test("OrderManager initializes with adapter data", async () => {
	const adapter = createMockOrderAdapter({
		initialData: [createTestOrder(), createTestOrder({ status: "paid" })],
		delay: 10,
	});

	const orders = new OrderManager({ adapter });
	await orders.initialize();

	const state = orders.get();
	assertEquals(state.state, "ready");
	assertEquals(state.data?.orders.length, 2);
	assertEquals(state.data?.orders[0].status, "pending");
	assertEquals(state.data?.orders[1].status, "paid");
});

Deno.test("OrderManager fetchAll refreshes orders", async () => {
	const adapter = createMockOrderAdapter({
		initialData: [createTestOrder()],
		delay: 10,
	});

	const orders = new OrderManager({ adapter });
	await orders.initialize();
	assertEquals(orders.getOrderCount(), 1);

	// Fetch again should still work
	await orders.fetchAll();
	assertEquals(orders.getOrderCount(), 1);
});

Deno.test("OrderManager fetchOne retrieves single order", async () => {
	const adapter = createMockOrderAdapter({
		initialData: [createTestOrder()],
		delay: 10,
	});

	const orders = new OrderManager({ adapter });
	await orders.initialize();

	const order = await orders.fetchOne("order-1");
	assertExists(order);
	assertEquals(order.status, "pending");
});

Deno.test("OrderManager fetchOne returns null for not found", async () => {
	const adapter = createMockOrderAdapter({
		initialData: [createTestOrder()],
		delay: 10,
	});

	const orders = new OrderManager({ adapter });
	await orders.initialize();

	const order = await orders.fetchOne("non-existent");
	assertEquals(order, null);

	// Should have error state
	const state = orders.get();
	assertEquals(state.state, "error");
	assertEquals(state.error?.code, "NOT_FOUND");
});

Deno.test("OrderManager create adds new order", async () => {
	const adapter = createMockOrderAdapter({ delay: 10 });

	const orders = new OrderManager({ adapter });
	await orders.initialize();
	assertEquals(orders.getOrderCount(), 0);

	const newOrder = await orders.create(createTestOrder());
	assertExists(newOrder);
	assertEquals(newOrder.status, "pending"); // Server sets status
	assertEquals(orders.getOrderCount(), 1);
});

Deno.test("OrderManager create handles error", async () => {
	const adapter = createMockOrderAdapter({
		delay: 10,
		forceError: { operation: "create", message: "Create failed" },
	});

	const orders = new OrderManager({ adapter });
	await orders.initialize();

	const newOrder = await orders.create(createTestOrder());
	assertEquals(newOrder, null);

	const state = orders.get();
	assertEquals(state.state, "error");
	assertEquals(state.error?.operation, "create");
});

Deno.test("OrderManager getOrderCount returns count", async () => {
	const adapter = createMockOrderAdapter({
		initialData: [createTestOrder(), createTestOrder(), createTestOrder()],
		delay: 10,
	});

	const orders = new OrderManager({ adapter });
	await orders.initialize();

	assertEquals(orders.getOrderCount(), 3);
});

Deno.test("OrderManager getOrders returns all orders", async () => {
	const adapter = createMockOrderAdapter({
		initialData: [createTestOrder({ status: "pending" }), createTestOrder({ status: "paid" })],
		delay: 10,
	});

	const orders = new OrderManager({ adapter });
	await orders.initialize();

	const allOrders = orders.getOrders();
	assertEquals(allOrders.length, 2);
	assertEquals(allOrders[0].status, "pending");
	assertEquals(allOrders[1].status, "paid");
});

Deno.test("OrderManager getOrderByIndex returns order at index", async () => {
	const adapter = createMockOrderAdapter({
		initialData: [createTestOrder({ status: "pending" }), createTestOrder({ status: "paid" })],
		delay: 10,
	});

	const orders = new OrderManager({ adapter });
	await orders.initialize();

	const first = orders.getOrderByIndex(0);
	assertExists(first);
	assertEquals(first.status, "pending");

	const second = orders.getOrderByIndex(1);
	assertExists(second);
	assertEquals(second.status, "paid");

	const missing = orders.getOrderByIndex(99);
	assertEquals(missing, undefined);
});

Deno.test("OrderManager subscribe works like Svelte store", () => {
	const orders = new OrderManager();
	const values: unknown[] = [];

	const unsub = orders.subscribe((v) => values.push(v));

	assertEquals(values.length, 1);
	assertExists(values[0]);

	unsub();
});

Deno.test("OrderManager handles fetch error on initialize", async () => {
	const adapter = createMockOrderAdapter({
		delay: 10,
		forceError: { operation: "fetchAll", message: "Network error" },
	});

	const orders = new OrderManager({ adapter });
	await orders.initialize();

	const state = orders.get();
	assertEquals(state.state, "error");
	assertEquals(state.error?.operation, "initialize");
});
