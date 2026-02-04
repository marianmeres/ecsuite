import { assertEquals, assertExists } from "@std/assert";
import { createClog } from "@marianmeres/clog";
import type { CustomerData } from "@marianmeres/collection-types";
import { CustomerManager } from "../src/domains/customer.ts";
import { createMockCustomerAdapter } from "../src/adapters/mock/customer.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.test.beforeEach(() => {
	createClog.global.debug = false;
});

Deno.test.afterEach(() => {
	createClog.reset();
});

// Helper to create test customer data
const createTestCustomer = (overrides: Partial<CustomerData> = {}): CustomerData => ({
	email: "test@example.com",
	first_name: "John",
	last_name: "Doe",
	phone: "+1234567890",
	guest: false,
	accepts_marketing: true,
	...overrides,
});

Deno.test("CustomerManager initializes with no data when no adapter", async () => {
	const customer = new CustomerManager();
	await customer.initialize();

	const state = customer.get();
	assertEquals(state.state, "ready");
	assertEquals(state.data, null);
	assertEquals(customer.hasData(), false);
});

Deno.test("CustomerManager initializes with adapter data", async () => {
	const adapter = createMockCustomerAdapter({
		initialData: createTestCustomer(),
		delay: 10,
	});

	const customer = new CustomerManager({ adapter });
	await customer.initialize();

	const state = customer.get();
	assertEquals(state.state, "ready");
	assertExists(state.data);
	assertEquals(state.data.email, "test@example.com");
	assertEquals(customer.hasData(), true);
});

Deno.test("CustomerManager refresh reloads data", async () => {
	const adapter = createMockCustomerAdapter({
		initialData: createTestCustomer({ first_name: "Original", last_name: "" }),
		delay: 10,
	});

	const customer = new CustomerManager({ adapter });
	await customer.initialize();
	assertEquals(customer.getName(), "Original");

	// Simulate external change by recreating adapter
	// In real world, server data would change
	await customer.refresh();
	assertEquals(customer.getName(), "Original"); // Still same since mock doesn't change
});

Deno.test("CustomerManager update modifies data", async () => {
	const adapter = createMockCustomerAdapter({
		initialData: createTestCustomer({ first_name: "Original", last_name: "" }),
		delay: 10,
	});

	const customer = new CustomerManager({ adapter });
	await customer.initialize();
	assertEquals(customer.getName(), "Original");

	await customer.update({ first_name: "Updated" });

	assertEquals(customer.getName(), "Updated");
	assertEquals(customer.get().state, "ready");
});

Deno.test("CustomerManager update performs optimistic update", async () => {
	const adapter = createMockCustomerAdapter({
		initialData: createTestCustomer({ first_name: "Original", last_name: "" }),
		delay: 100,
	});

	const customer = new CustomerManager({ adapter });
	await customer.initialize();

	// Start update (don't await yet)
	const updatePromise = customer.update({ first_name: "Updated" });

	// Check optimistic update (immediate)
	await sleep(20);
	assertEquals(customer.get().state, "syncing");
	assertEquals(customer.getName(), "Updated"); // Optimistic!

	// Wait for completion
	await updatePromise;
	assertEquals(customer.get().state, "ready");
});

Deno.test("CustomerManager update rolls back on error", async () => {
	const adapter = createMockCustomerAdapter({
		initialData: createTestCustomer({ first_name: "Original", last_name: "" }),
		delay: 10,
		forceError: { operation: "update", message: "Update failed" },
	});

	const customer = new CustomerManager({ adapter });
	await customer.initialize();

	await customer.update({ first_name: "Updated" });

	const state = customer.get();
	assertEquals(state.state, "error");
	assertEquals(state.error?.operation, "update");
	assertEquals(customer.getName(), "Original"); // Rolled back
});

Deno.test("CustomerManager getEmail returns email", async () => {
	const adapter = createMockCustomerAdapter({
		initialData: createTestCustomer({ email: "user@test.com" }),
		delay: 10,
	});

	const customer = new CustomerManager({ adapter });
	await customer.initialize();

	assertEquals(customer.getEmail(), "user@test.com");
});

Deno.test("CustomerManager getName returns name", async () => {
	const adapter = createMockCustomerAdapter({
		initialData: createTestCustomer({ first_name: "Jane", last_name: "Doe" }),
		delay: 10,
	});

	const customer = new CustomerManager({ adapter });
	await customer.initialize();

	assertEquals(customer.getName(), "Jane Doe");
});

Deno.test("CustomerManager isGuest returns guest status", async () => {
	const guestAdapter = createMockCustomerAdapter({
		initialData: createTestCustomer({ guest: true }),
		delay: 10,
	});

	const guest = new CustomerManager({ adapter: guestAdapter });
	await guest.initialize();
	assertEquals(guest.isGuest(), true);

	const registeredAdapter = createMockCustomerAdapter({
		initialData: createTestCustomer({ guest: false }),
		delay: 10,
	});

	const registered = new CustomerManager({ adapter: registeredAdapter });
	await registered.initialize();
	assertEquals(registered.isGuest(), false);
});

Deno.test("CustomerManager hasData returns true when data loaded", async () => {
	const adapter = createMockCustomerAdapter({
		initialData: createTestCustomer(),
		delay: 10,
	});

	const customer = new CustomerManager({ adapter });
	assertEquals(customer.hasData(), false);

	await customer.initialize();
	assertEquals(customer.hasData(), true);
});

Deno.test("CustomerManager subscribe works like Svelte store", () => {
	const customer = new CustomerManager();
	const values: unknown[] = [];

	const unsub = customer.subscribe((v) => values.push(v));

	assertEquals(values.length, 1);
	assertExists(values[0]);

	unsub();
});

Deno.test("CustomerManager handles fetch error on initialize", async () => {
	const adapter = createMockCustomerAdapter({
		delay: 10,
		forceError: { operation: "fetch", message: "Network error" },
	});

	const customer = new CustomerManager({ adapter });
	await customer.initialize();

	const state = customer.get();
	assertEquals(state.state, "error");
	assertEquals(state.error?.operation, "initialize");
});
