import { assertEquals, assertExists } from "@std/assert";
import { createClog } from "@marianmeres/clog";
import type { ProductData, UUID } from "@marianmeres/collection-types";
import { ProductManager } from "../src/domains/product.ts";
import { createMockProductAdapter } from "../src/adapters/mock/product.ts";

Deno.test.beforeEach(() => {
	createClog.global.debug = false;
});

Deno.test.afterEach(() => {
	createClog.reset();
});

// Helper to create test product data with model_id
const createTestProduct = (
	id: UUID,
	overrides: Partial<ProductData> = {},
): ProductData & { model_id: UUID } => ({
	model_id: id,
	name: `Product ${id}`,
	price: 1000,
	sku: `SKU-${id}`,
	...overrides,
});

Deno.test("ProductManager initializes with empty cache", () => {
	const product = new ProductManager();
	assertEquals(product.getCacheSize(), 0);
});

Deno.test("ProductManager getById fetches from adapter", async () => {
	const prod1 = createTestProduct("prod-1", { name: "Widget", price: 500 });

	const adapter = createMockProductAdapter({
		products: [prod1],
		delay: 10,
	});

	const product = new ProductManager({ adapter });
	const fetched = await product.getById("prod-1");

	assertExists(fetched);
	assertEquals(fetched.name, "Widget");
	assertEquals(fetched.price, 500);
	assertEquals(product.getCacheSize(), 1);
});

Deno.test("ProductManager getById returns from cache on second call", async () => {
	const prod1 = createTestProduct("prod-1");
	let fetchCount = 0;

	const adapter = createMockProductAdapter({
		products: [prod1],
		delay: 10,
	});

	// Wrap adapter to count calls
	const originalFetchOne = adapter.fetchOne;
	adapter.fetchOne = async (...args) => {
		fetchCount++;
		return originalFetchOne(...args);
	};

	const product = new ProductManager({ adapter });

	// First call - should hit adapter
	await product.getById("prod-1");
	assertEquals(fetchCount, 1);

	// Second call - should hit cache
	await product.getById("prod-1");
	assertEquals(fetchCount, 1); // Still 1, not 2
});

Deno.test("ProductManager getById returns null for not found", async () => {
	const adapter = createMockProductAdapter({
		products: [],
		delay: 10,
	});

	const product = new ProductManager({ adapter });
	const fetched = await product.getById("non-existent");
	assertEquals(fetched, null);
});

Deno.test("ProductManager getById returns null without adapter", async () => {
	const product = new ProductManager();
	const fetched = await product.getById("any-id");
	assertEquals(fetched, null);
});

Deno.test("ProductManager getByIds fetches multiple products", async () => {
	const prod1 = createTestProduct("prod-1", { name: "Widget" });
	const prod2 = createTestProduct("prod-2", { name: "Gadget" });
	const prod3 = createTestProduct("prod-3", { name: "Gizmo" });

	const adapter = createMockProductAdapter({
		products: [prod1, prod2, prod3],
		delay: 10,
	});

	const product = new ProductManager({ adapter });
	const result = await product.getByIds(["prod-1", "prod-3"]);

	assertEquals(result.size, 2);
	assertEquals(result.get("prod-1")?.name, "Widget");
	assertEquals(result.get("prod-3")?.name, "Gizmo");
	assertEquals(result.has("prod-2"), false);
});

Deno.test("ProductManager getByIds uses cache for already fetched items", async () => {
	const prod1 = createTestProduct("prod-1");
	const prod2 = createTestProduct("prod-2");
	let fetchManyCount = 0;

	const adapter = createMockProductAdapter({
		products: [prod1, prod2],
		delay: 10,
	});

	const originalFetchMany = adapter.fetchMany;
	adapter.fetchMany = async (...args) => {
		fetchManyCount++;
		return originalFetchMany(...args);
	};

	const product = new ProductManager({ adapter });

	// First call - fetches both
	await product.getByIds(["prod-1", "prod-2"]);
	assertEquals(fetchManyCount, 1);

	// Second call for same IDs - should use cache
	await product.getByIds(["prod-1", "prod-2"]);
	assertEquals(fetchManyCount, 1); // Still 1
});

Deno.test("ProductManager getByIds returns empty map without adapter", async () => {
	const product = new ProductManager();
	const result = await product.getByIds(["prod-1", "prod-2"]);
	assertEquals(result.size, 0);
});

Deno.test("ProductManager prefetch populates cache", async () => {
	const prod1 = createTestProduct("prod-1");
	const prod2 = createTestProduct("prod-2");

	const adapter = createMockProductAdapter({
		products: [prod1, prod2],
		delay: 10,
	});

	const product = new ProductManager({ adapter });

	assertEquals(product.isCached("prod-1"), false);
	assertEquals(product.isCached("prod-2"), false);

	await product.prefetch(["prod-1", "prod-2"]);

	assertEquals(product.isCached("prod-1"), true);
	assertEquals(product.isCached("prod-2"), true);
});

Deno.test("ProductManager clearCache clears specific product", async () => {
	const prod1 = createTestProduct("prod-1");
	const prod2 = createTestProduct("prod-2");

	const adapter = createMockProductAdapter({
		products: [prod1, prod2],
		delay: 10,
	});

	const product = new ProductManager({ adapter });

	await product.prefetch(["prod-1", "prod-2"]);
	assertEquals(product.getCacheSize(), 2);

	product.clearCache("prod-1");
	assertEquals(product.getCacheSize(), 1);
	assertEquals(product.isCached("prod-1"), false);
	assertEquals(product.isCached("prod-2"), true);
});

Deno.test("ProductManager clearCache clears all products", async () => {
	const prod1 = createTestProduct("prod-1");
	const prod2 = createTestProduct("prod-2");

	const adapter = createMockProductAdapter({
		products: [prod1, prod2],
		delay: 10,
	});

	const product = new ProductManager({ adapter });

	await product.prefetch(["prod-1", "prod-2"]);
	assertEquals(product.getCacheSize(), 2);

	product.clearCache();
	assertEquals(product.getCacheSize(), 0);
});

Deno.test("ProductManager cache expires after TTL", async () => {
	const prod1 = createTestProduct("prod-1");

	const adapter = createMockProductAdapter({
		products: [prod1],
		delay: 10,
	});

	const product = new ProductManager({
		adapter,
		cacheTtl: 50, // 50ms TTL
	});

	await product.getById("prod-1");
	assertEquals(product.isCached("prod-1"), true);

	// Wait for TTL to expire
	await new Promise((r) => setTimeout(r, 60));
	assertEquals(product.isCached("prod-1"), false);
});

Deno.test("ProductManager handles fetch error gracefully", async () => {
	const adapter = createMockProductAdapter({
		products: [],
		delay: 10,
		forceError: { operation: "fetchOne", message: "Network error" },
	});

	const product = new ProductManager({ adapter });
	const fetched = await product.getById("prod-1");

	assertEquals(fetched, null);
	assertEquals(product.getCacheSize(), 0);
});

Deno.test("ProductManager setContext updates context", () => {
	const product = new ProductManager();
	product.setContext({ customerId: "cust-123" });

	const ctx = product.getContext();
	assertEquals(ctx.customerId, "cust-123");
});

Deno.test("ProductManager setAdapter sets adapter", async () => {
	const prod1 = createTestProduct("prod-1");

	const adapter = createMockProductAdapter({
		products: [prod1],
		delay: 10,
	});

	const product = new ProductManager();
	assertEquals(await product.getById("prod-1"), null);

	product.setAdapter(adapter);
	assertExists(await product.getById("prod-1"));
});
