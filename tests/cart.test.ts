import { assertEquals, assertExists } from "@std/assert";
import { CartManager } from "../src/domains/cart.ts";
import { createMockCartAdapter } from "../src/adapters/mock/cart.ts";
import { createClog } from "@marianmeres/clog";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.test.beforeEach(() => {
	createClog.global.debug = false;
});

Deno.test.afterEach(() => {
	createClog.reset();
});

Deno.test(
	"CartManager initializes with empty cart when no adapter",
	async () => {
		const cart = new CartManager({ storageType: "memory" });
		await cart.initialize();

		const state = cart.get();
		assertEquals(state.state, "ready");
		assertEquals(state.data?.items.length, 0);
	},
);

Deno.test("CartManager initializes with adapter data", async () => {
	const adapter = createMockCartAdapter({
		initialData: { items: [{ product_id: "p1", quantity: 2 }] },
		delay: 10,
	});

	const cart = new CartManager({ adapter, storageType: "memory" });
	await cart.initialize();

	const state = cart.get();
	assertEquals(state.state, "ready");
	assertEquals(state.data?.items.length, 1);
	assertEquals(state.data?.items[0].product_id, "p1");
	assertEquals(state.data?.items[0].quantity, 2);
});

Deno.test("CartManager addItem adds new item", async () => {
	const adapter = createMockCartAdapter({ delay: 10 });
	const cart = new CartManager({ adapter, storageType: "memory" });
	await cart.initialize();

	await cart.addItem({ product_id: "p1", quantity: 1 });

	const state = cart.get();
	assertEquals(state.state, "ready");
	assertEquals(state.data?.items.length, 1);
	assertEquals(state.data?.items[0].product_id, "p1");
	assertEquals(state.data?.items[0].quantity, 1);
});

Deno.test(
	"CartManager addItem increments quantity for existing item",
	async () => {
		const adapter = createMockCartAdapter({
			initialData: { items: [{ product_id: "p1", quantity: 2 }] },
			delay: 10,
		});
		const cart = new CartManager({ adapter, storageType: "memory" });
		await cart.initialize();

		await cart.addItem({ product_id: "p1", quantity: 3 });

		const state = cart.get();
		assertEquals(state.data?.items.length, 1);
		assertEquals(state.data?.items[0].quantity, 5);
	},
);

Deno.test("CartManager addItem performs optimistic update", async () => {
	const adapter = createMockCartAdapter({ delay: 100 });
	const cart = new CartManager({ adapter, storageType: "memory" });
	await cart.initialize();

	// Start add operation (don't await yet)
	const addPromise = cart.addItem({ product_id: "p1", quantity: 1 });

	// Check optimistic update (immediate)
	await sleep(20);
	let state = cart.get();
	assertEquals(state.state, "syncing");
	assertEquals(state.data?.items.length, 1);

	// Wait for completion
	await addPromise;
	state = cart.get();
	assertEquals(state.state, "ready");
	assertEquals(state.data?.items.length, 1);
});

Deno.test("CartManager rolls back on addItem error", async () => {
	const adapter = createMockCartAdapter({
		initialData: { items: [] },
		delay: 10,
		forceError: { operation: "addItem", message: "Server error" },
	});
	const cart = new CartManager({ adapter, storageType: "memory" });
	await cart.initialize();

	await cart.addItem({ product_id: "p1", quantity: 1 });

	const state = cart.get();
	assertEquals(state.state, "error");
	assertEquals(state.error?.operation, "addItem");
	// Rollback: cart should be empty
	assertEquals(state.data?.items.length, 0);
});

Deno.test("CartManager updateItemQuantity updates quantity", async () => {
	const adapter = createMockCartAdapter({
		initialData: { items: [{ product_id: "p1", quantity: 2 }] },
		delay: 10,
	});
	const cart = new CartManager({ adapter, storageType: "memory" });
	await cart.initialize();

	await cart.updateItemQuantity("p1", 5);

	const state = cart.get();
	assertEquals(state.data?.items[0].quantity, 5);
});

Deno.test("CartManager updateItemQuantity with 0 removes item", async () => {
	const adapter = createMockCartAdapter({
		initialData: { items: [{ product_id: "p1", quantity: 2 }] },
		delay: 10,
	});
	const cart = new CartManager({ adapter, storageType: "memory" });
	await cart.initialize();

	await cart.updateItemQuantity("p1", 0);

	const state = cart.get();
	assertEquals(state.data?.items.length, 0);
});

Deno.test("CartManager removeItem removes item", async () => {
	const adapter = createMockCartAdapter({
		initialData: {
			items: [
				{ product_id: "p1", quantity: 2 },
				{ product_id: "p2", quantity: 1 },
			],
		},
		delay: 10,
	});
	const cart = new CartManager({ adapter, storageType: "memory" });
	await cart.initialize();

	await cart.removeItem("p1");

	const state = cart.get();
	assertEquals(state.data?.items.length, 1);
	assertEquals(state.data?.items[0].product_id, "p2");
});

Deno.test("CartManager clear removes all items", async () => {
	const adapter = createMockCartAdapter({
		initialData: {
			items: [
				{ product_id: "p1", quantity: 2 },
				{ product_id: "p2", quantity: 1 },
			],
		},
		delay: 10,
	});
	const cart = new CartManager({ adapter, storageType: "memory" });
	await cart.initialize();

	await cart.clear();

	const state = cart.get();
	assertEquals(state.data?.items.length, 0);
});

Deno.test("CartManager getItemCount returns total quantity", async () => {
	const adapter = createMockCartAdapter({
		initialData: {
			items: [
				{ product_id: "p1", quantity: 2 },
				{ product_id: "p2", quantity: 3 },
			],
		},
		delay: 10,
	});
	const cart = new CartManager({ adapter, storageType: "memory" });
	await cart.initialize();

	assertEquals(cart.getItemCount(), 5);
});

Deno.test("CartManager hasProduct checks if product exists", async () => {
	const adapter = createMockCartAdapter({
		initialData: { items: [{ product_id: "p1", quantity: 2 }] },
		delay: 10,
	});
	const cart = new CartManager({ adapter, storageType: "memory" });
	await cart.initialize();

	assertEquals(cart.hasProduct("p1"), true);
	assertEquals(cart.hasProduct("p2"), false);
});

Deno.test("CartManager getItem returns item by product ID", async () => {
	const adapter = createMockCartAdapter({
		initialData: { items: [{ product_id: "p1", quantity: 2 }] },
		delay: 10,
	});
	const cart = new CartManager({ adapter, storageType: "memory" });
	await cart.initialize();

	const item = cart.getItem("p1");
	assertExists(item);
	assertEquals(item.product_id, "p1");
	assertEquals(item.quantity, 2);

	const missing = cart.getItem("p2");
	assertEquals(missing, undefined);
});

Deno.test("CartManager subscribe works like Svelte store", () => {
	const cart = new CartManager({ storageType: "memory" });
	const values: unknown[] = [];

	// Subscribe immediately receives current value
	const unsub = cart.subscribe((v) => values.push(v));

	assertEquals(values.length, 1);
	assertExists(values[0]);

	unsub();
});

Deno.test("CartManager reset clears state", async () => {
	const adapter = createMockCartAdapter({
		initialData: { items: [{ product_id: "p1", quantity: 2 }] },
		delay: 10,
	});
	const cart = new CartManager({ adapter, storageType: "memory" });
	await cart.initialize();

	assertEquals(cart.get().data?.items.length, 1);

	cart.reset();

	const state = cart.get();
	assertEquals(state.state, "initializing");
	assertEquals(state.data, null);
});

Deno.test("CartManager works without adapter", async () => {
	const cart = new CartManager({ storageType: "memory" });
	await cart.initialize();

	await cart.addItem({ product_id: "p1", quantity: 1 });
	assertEquals(cart.getItemCount(), 1);

	await cart.updateItemQuantity("p1", 3);
	assertEquals(cart.getItem("p1")?.quantity, 3);

	await cart.removeItem("p1");
	assertEquals(cart.getItemCount(), 0);
});
