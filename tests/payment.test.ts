import { assertEquals, assertExists } from "@std/assert";
import { createClog } from "@marianmeres/clog";
import type { PaymentData } from "@marianmeres/collection-types";
import { PaymentManager } from "../src/domains/payment.ts";
import { createMockPaymentAdapter } from "../src/adapters/mock/payment.ts";

Deno.test.beforeEach(() => {
	createClog.global.debug = false;
});

Deno.test.afterEach(() => {
	createClog.reset();
});

// Helper to create test payment data
const createTestPayment = (overrides: Partial<PaymentData> = {}): PaymentData => ({
	provider: "stripe",
	status: "completed",
	amount: 1000,
	currency: "EUR",
	provider_reference: `pay_${Math.random().toString(36).slice(2)}`,
	...overrides,
});

Deno.test("PaymentManager initializes with empty payments", async () => {
	const payment = new PaymentManager();
	await payment.initialize();

	const state = payment.get();
	assertEquals(state.state, "ready");
	assertEquals(state.data?.payments.length, 0);
});

Deno.test("PaymentManager fetchForOrder retrieves payments", async () => {
	const pay1 = createTestPayment({ provider_reference: "pay_1" });
	const pay2 = createTestPayment({ provider_reference: "pay_2" });

	const adapter = createMockPaymentAdapter({
		initialData: {
			"order-1": [pay1, pay2],
		},
		delay: 10,
	});

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	const payments = await payment.fetchForOrder("order-1");
	assertEquals(payments.length, 2);
	assertEquals(payment.getPaymentCount(), 2);
});

Deno.test("PaymentManager fetchForOrder returns empty for unknown order", async () => {
	const adapter = createMockPaymentAdapter({
		initialData: {},
		delay: 10,
	});

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	const payments = await payment.fetchForOrder("unknown-order");
	assertEquals(payments.length, 0);
	assertEquals(payment.get().state, "ready");
});

Deno.test("PaymentManager fetchOne retrieves single payment", async () => {
	const pay1 = createTestPayment({ provider_reference: "pay_1", amount: 500 });

	const adapter = createMockPaymentAdapter({
		initialData: {
			"order-1": [pay1],
		},
		delay: 10,
	});

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	const fetched = await payment.fetchOne("pay_1");
	assertExists(fetched);
	assertEquals(fetched.amount, 500);
	assertEquals(fetched.provider_reference, "pay_1");
});

Deno.test("PaymentManager fetchOne returns null for not found", async () => {
	const adapter = createMockPaymentAdapter({
		initialData: {},
		delay: 10,
	});

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	const fetched = await payment.fetchOne("non-existent");
	assertEquals(fetched, null);

	const state = payment.get();
	assertEquals(state.state, "error");
	assertEquals(state.error?.code, "NOT_FOUND");
});

Deno.test("PaymentManager merges payments without duplicates", async () => {
	const pay1 = createTestPayment({ provider_reference: "pay_1" });
	const pay2 = createTestPayment({ provider_reference: "pay_2" });
	const pay3 = createTestPayment({ provider_reference: "pay_1" }); // Duplicate ref

	const adapter = createMockPaymentAdapter({
		initialData: {
			"order-1": [pay1],
			"order-2": [pay2, pay3], // pay3 has same ref as pay1
		},
		delay: 10,
	});

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	await payment.fetchForOrder("order-1");
	assertEquals(payment.getPaymentCount(), 1);

	await payment.fetchForOrder("order-2");
	// pay3 should be filtered out as duplicate
	assertEquals(payment.getPaymentCount(), 2);
});

Deno.test("PaymentManager getPayments returns all fetched payments", async () => {
	const pay1 = createTestPayment({ provider_reference: "pay_1" });
	const pay2 = createTestPayment({ provider_reference: "pay_2" });

	const adapter = createMockPaymentAdapter({
		initialData: {
			"order-1": [pay1, pay2],
		},
		delay: 10,
	});

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	await payment.fetchForOrder("order-1");
	const all = payment.getPayments();
	assertEquals(all.length, 2);
});

Deno.test("PaymentManager getPaymentByRef finds payment", async () => {
	const pay1 = createTestPayment({ provider_reference: "pay_1", amount: 100 });
	const pay2 = createTestPayment({ provider_reference: "pay_2", amount: 200 });

	const adapter = createMockPaymentAdapter({
		initialData: {
			"order-1": [pay1, pay2],
		},
		delay: 10,
	});

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	await payment.fetchForOrder("order-1");

	const found = payment.getPaymentByRef("pay_2");
	assertExists(found);
	assertEquals(found.amount, 200);

	const notFound = payment.getPaymentByRef("pay_999");
	assertEquals(notFound, undefined);
});

Deno.test("PaymentManager clearCache clears local data", async () => {
	const pay1 = createTestPayment({ provider_reference: "pay_1" });

	const adapter = createMockPaymentAdapter({
		initialData: {
			"order-1": [pay1],
		},
		delay: 10,
	});

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	await payment.fetchForOrder("order-1");
	assertEquals(payment.getPaymentCount(), 1);

	payment.clearCache();
	assertEquals(payment.getPaymentCount(), 0);
});

Deno.test("PaymentManager subscribe works like Svelte store", () => {
	const payment = new PaymentManager();
	const values: unknown[] = [];

	const unsub = payment.subscribe((v) => values.push(v));

	assertEquals(values.length, 1);
	assertExists(values[0]);

	unsub();
});

Deno.test("PaymentManager handles fetch error", async () => {
	const adapter = createMockPaymentAdapter({
		delay: 10,
		forceError: { operation: "fetchForOrder", message: "Network error" },
	});

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	const payments = await payment.fetchForOrder("order-1");
	assertEquals(payments.length, 0);

	const state = payment.get();
	assertEquals(state.state, "error");
	assertEquals(state.error?.operation, "fetchForOrder");
});

Deno.test("PaymentManager works without adapter", async () => {
	const payment = new PaymentManager();
	await payment.initialize();

	const payments = await payment.fetchForOrder("order-1");
	assertEquals(payments.length, 0);
	assertEquals(payment.get().state, "ready");
});

// --- initiate / capture tests ---

Deno.test("PaymentManager initiate creates payment intent", async () => {
	const adapter = createMockPaymentAdapter({ delay: 10 });

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	const intent = await payment.initiate("order-1", {
		provider: "stripe",
		amount: 1000,
		currency: "EUR",
	});

	assertExists(intent);
	assertExists(intent.id);
	assertExists(intent.redirect_url);
	assertEquals(payment.get().state, "ready");
});

Deno.test("PaymentManager initiate returns null when adapter lacks method", async () => {
	// Adapter without initiate method
	const adapter = createMockPaymentAdapter({ delay: 10 });
	delete (adapter as unknown as Record<string, unknown>).initiate;

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	const intent = await payment.initiate("order-1", {
		provider: "stripe",
		amount: 1000,
		currency: "EUR",
	});

	assertEquals(intent, null);
});

Deno.test("PaymentManager initiate handles error", async () => {
	const adapter = createMockPaymentAdapter({
		delay: 10,
		forceError: { operation: "initiate", message: "Payment error" },
	});

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	const intent = await payment.initiate("order-1", {
		provider: "stripe",
		amount: 1000,
		currency: "EUR",
	});

	assertEquals(intent, null);
	assertEquals(payment.get().state, "error");
	assertEquals(payment.get().error?.operation, "initiate");
});

Deno.test("PaymentManager capture completes payment", async () => {
	const adapter = createMockPaymentAdapter({ delay: 10 });

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	const captured = await payment.capture("pay_123");

	assertExists(captured);
	assertEquals(captured.status, "completed");
	assertEquals(captured.provider_reference, "pay_123");
	assertEquals(payment.getPaymentCount(), 1);
	assertEquals(payment.get().state, "ready");
});

Deno.test("PaymentManager capture returns null when adapter lacks method", async () => {
	const adapter = createMockPaymentAdapter({ delay: 10 });
	delete (adapter as unknown as Record<string, unknown>).capture;

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	const captured = await payment.capture("pay_123");
	assertEquals(captured, null);
});

Deno.test("PaymentManager capture handles error", async () => {
	const adapter = createMockPaymentAdapter({
		delay: 10,
		forceError: { operation: "capture", message: "Capture error" },
	});

	const payment = new PaymentManager({ adapter });
	await payment.initialize();

	const captured = await payment.capture("pay_123");

	assertEquals(captured, null);
	assertEquals(payment.get().state, "error");
	assertEquals(payment.get().error?.operation, "capture");
});
