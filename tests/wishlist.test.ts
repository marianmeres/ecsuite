import { assertEquals, assertExists } from "@std/assert";
import { createClog } from "@marianmeres/clog";
import { WishlistManager } from "../src/domains/wishlist.ts";
import { createMockWishlistAdapter } from "../src/adapters/mock/wishlist.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.test.beforeEach(() => {
	createClog.global.debug = false;
});

Deno.test.afterEach(() => {
	createClog.reset();
});

Deno.test("WishlistManager initializes with empty wishlist when no adapter", async () => {
	const wishlist = new WishlistManager({ storageType: "memory" });
	await wishlist.initialize();

	const state = wishlist.get();
	assertEquals(state.state, "ready");
	assertEquals(state.data?.items.length, 0);
});

Deno.test("WishlistManager initializes with adapter data", async () => {
	const adapter = createMockWishlistAdapter({
		initialData: { items: [{ product_id: "p1", added_at: 12345 }] },
		delay: 10,
	});

	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	const state = wishlist.get();
	assertEquals(state.state, "ready");
	assertEquals(state.data?.items.length, 1);
	assertEquals(state.data?.items[0].product_id, "p1");
});

Deno.test("WishlistManager addItem adds new item", async () => {
	const adapter = createMockWishlistAdapter({ delay: 10 });
	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	await wishlist.addItem("p1");

	const state = wishlist.get();
	assertEquals(state.state, "ready");
	assertEquals(state.data?.items.length, 1);
	assertEquals(state.data?.items[0].product_id, "p1");
	assertExists(state.data?.items[0].added_at);
});

Deno.test("WishlistManager addItem is no-op for existing item", async () => {
	const adapter = createMockWishlistAdapter({
		initialData: { items: [{ product_id: "p1", added_at: 12345 }] },
		delay: 10,
	});
	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	await wishlist.addItem("p1");

	const state = wishlist.get();
	assertEquals(state.data?.items.length, 1);
	// Timestamp should not change
	assertEquals(state.data?.items[0].added_at, 12345);
});

Deno.test("WishlistManager addItem performs optimistic update", async () => {
	const adapter = createMockWishlistAdapter({ delay: 100 });
	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	// Start add operation (don't await yet)
	const addPromise = wishlist.addItem("p1");

	// Check optimistic update (immediate)
	await sleep(20);
	let state = wishlist.get();
	assertEquals(state.state, "syncing");
	assertEquals(state.data?.items.length, 1);

	// Wait for completion
	await addPromise;
	state = wishlist.get();
	assertEquals(state.state, "ready");
});

Deno.test("WishlistManager rolls back on addItem error", async () => {
	const adapter = createMockWishlistAdapter({
		initialData: { items: [] },
		delay: 10,
		forceError: { operation: "addItem", message: "Server error" },
	});
	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	await wishlist.addItem("p1");

	const state = wishlist.get();
	assertEquals(state.state, "error");
	assertEquals(state.error?.operation, "addItem");
	// Rollback: wishlist should be empty
	assertEquals(state.data?.items.length, 0);
});

Deno.test("WishlistManager removeItem removes item", async () => {
	const adapter = createMockWishlistAdapter({
		initialData: {
			items: [
				{ product_id: "p1", added_at: 1 },
				{ product_id: "p2", added_at: 2 },
			],
		},
		delay: 10,
	});
	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	await wishlist.removeItem("p1");

	const state = wishlist.get();
	assertEquals(state.data?.items.length, 1);
	assertEquals(state.data?.items[0].product_id, "p2");
});

Deno.test("WishlistManager toggleItem adds if not present", async () => {
	const adapter = createMockWishlistAdapter({ delay: 10 });
	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	const result = await wishlist.toggleItem("p1");

	assertEquals(result, true);
	assertEquals(wishlist.hasProduct("p1"), true);
});

Deno.test("WishlistManager toggleItem removes if present", async () => {
	const adapter = createMockWishlistAdapter({
		initialData: { items: [{ product_id: "p1", added_at: 1 }] },
		delay: 10,
	});
	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	const result = await wishlist.toggleItem("p1");

	assertEquals(result, false);
	assertEquals(wishlist.hasProduct("p1"), false);
});

Deno.test("WishlistManager clear removes all items", async () => {
	const adapter = createMockWishlistAdapter({
		initialData: {
			items: [
				{ product_id: "p1", added_at: 1 },
				{ product_id: "p2", added_at: 2 },
			],
		},
		delay: 10,
	});
	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	await wishlist.clear();

	const state = wishlist.get();
	assertEquals(state.data?.items.length, 0);
});

Deno.test("WishlistManager getItemCount returns count", async () => {
	const adapter = createMockWishlistAdapter({
		initialData: {
			items: [
				{ product_id: "p1", added_at: 1 },
				{ product_id: "p2", added_at: 2 },
			],
		},
		delay: 10,
	});
	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	assertEquals(wishlist.getItemCount(), 2);
});

Deno.test("WishlistManager hasProduct checks if product exists", async () => {
	const adapter = createMockWishlistAdapter({
		initialData: { items: [{ product_id: "p1", added_at: 1 }] },
		delay: 10,
	});
	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	assertEquals(wishlist.hasProduct("p1"), true);
	assertEquals(wishlist.hasProduct("p2"), false);
});

Deno.test("WishlistManager getItem returns item by product ID", async () => {
	const adapter = createMockWishlistAdapter({
		initialData: { items: [{ product_id: "p1", added_at: 12345 }] },
		delay: 10,
	});
	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	const item = wishlist.getItem("p1");
	assertExists(item);
	assertEquals(item.product_id, "p1");
	assertEquals(item.added_at, 12345);

	const missing = wishlist.getItem("p2");
	assertEquals(missing, undefined);
});

Deno.test("WishlistManager getProductIds returns all product IDs", async () => {
	const adapter = createMockWishlistAdapter({
		initialData: {
			items: [
				{ product_id: "p1", added_at: 1 },
				{ product_id: "p2", added_at: 2 },
			],
		},
		delay: 10,
	});
	const wishlist = new WishlistManager({ adapter, storageType: "memory" });
	await wishlist.initialize();

	const ids = wishlist.getProductIds();
	assertEquals(ids, ["p1", "p2"]);
});

Deno.test("WishlistManager subscribe works like Svelte store", () => {
	const wishlist = new WishlistManager({ storageType: "memory" });
	const values: unknown[] = [];

	const unsub = wishlist.subscribe((v) => values.push(v));

	assertEquals(values.length, 1);
	assertExists(values[0]);

	unsub();
});

Deno.test("WishlistManager works without adapter", async () => {
	// Use unique storage key to isolate from other tests
	const wishlist = new WishlistManager({
		storageType: "memory",
		storageKey: `test-no-adapter-${Date.now()}`,
	});
	await wishlist.initialize();

	await wishlist.addItem("p1");
	assertEquals(wishlist.getItemCount(), 1);

	await wishlist.removeItem("p1");
	assertEquals(wishlist.getItemCount(), 0);
});
