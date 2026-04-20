import { assert, assertEquals, assertRejects } from "@std/assert";
import {
	createHttpCartAdapter,
	createHttpCustomerAdapter,
	createHttpOrderAdapter,
	createHttpPaymentAdapter,
	createHttpProductAdapter,
	createHttpWishlistAdapter,
} from "../src/adapters/http/mod.ts";
import type { DomainContext } from "../src/types/state.ts";

interface Captured {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | null;
}

function makeFetch(
	respond: (req: Captured) => { status?: number; body?: unknown; text?: string },
): { fetch: typeof fetch; calls: Captured[] } {
	const calls: Captured[] = [];
	const fetch: typeof globalThis.fetch = async (input, rawInit) => {
		const init = rawInit as RequestInit | undefined;
		const url = typeof input === "string" ? input : (input as URL | Request).toString();
		const headers: Record<string, string> = {};
		const hdrs = new Headers(init?.headers);
		hdrs.forEach((v, k) => {
			headers[k.toLowerCase()] = v;
		});
		const body = typeof init?.body === "string" ? init.body : null;
		const captured: Captured = {
			url,
			method: init?.method ?? "GET",
			headers,
			body,
		};
		calls.push(captured);

		const r = respond(captured);
		const status = r.status ?? 200;
		const text = r.text ?? (r.body === undefined ? "" : JSON.stringify(r.body));
		return new Response(text, {
			status,
			headers: { "Content-Type": "application/json" },
		});
	};
	return { fetch, calls };
}

const ctx: DomainContext = { sessionId: "s-1", jwt: "tok", customerId: "c-1" };

// ─── cart ────────────────────────────────────────────────────────────────

Deno.test("http cart: fetch issues GET /cart with session + jwt headers", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: { data: { items: [] } } }));
	const adapter = createHttpCartAdapter({ baseUrl: "/api/session", fetch });
	const data = await adapter.fetch(ctx);

	assertEquals(calls[0].method, "GET");
	assertEquals(calls[0].url, "/api/session/cart");
	assertEquals(calls[0].headers["x-session-id"], "s-1");
	assertEquals(calls[0].headers["authorization"], "Bearer tok");
	assertEquals(data.items.length, 0);
});

Deno.test("http cart: addItem POSTs body", async () => {
	const { fetch, calls } = makeFetch(() => ({
		body: { data: { items: [{ product_id: "p1", quantity: 2 }] } },
	}));
	const adapter = createHttpCartAdapter({ fetch });
	await adapter.addItem({ product_id: "p1", quantity: 2 }, ctx);

	assertEquals(calls[0].method, "POST");
	assertEquals(calls[0].url, "/api/session/cart");
	assertEquals(calls[0].headers["content-type"], "application/json");
	assertEquals(calls[0].body, '{"product_id":"p1","quantity":2}');
});

Deno.test("http cart: updateItem PUTs { product_id, quantity }", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: { data: { items: [] } } }));
	const adapter = createHttpCartAdapter({ fetch });
	await adapter.updateItem("p1", 5, ctx);

	assertEquals(calls[0].method, "PUT");
	assertEquals(calls[0].body, '{"product_id":"p1","quantity":5}');
});

Deno.test("http cart: removeItem DELETEs with product_id query", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: { data: { items: [] } } }));
	const adapter = createHttpCartAdapter({ fetch });
	await adapter.removeItem("p1", ctx);

	assertEquals(calls[0].method, "DELETE");
	assertEquals(calls[0].url, "/api/session/cart?product_id=p1");
});

Deno.test("http cart: clear DELETEs with no query", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: { data: { items: [] } } }));
	const adapter = createHttpCartAdapter({ fetch });
	await adapter.clear(ctx);

	assertEquals(calls[0].method, "DELETE");
	assertEquals(calls[0].url, "/api/session/cart");
});

Deno.test("http cart: addItem without sessionId throws client-side", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: { data: { items: [] } } }));
	const adapter = createHttpCartAdapter({ fetch });

	await assertRejects(
		() => adapter.addItem({ product_id: "p1", quantity: 1 }, {}),
		Error,
		"sessionId required",
	);
	assertEquals(calls.length, 0);
});

Deno.test("http cart: non-OK response throws Error with status + body", async () => {
	const { fetch } = makeFetch(() => ({ status: 500, text: "boom" }));
	const adapter = createHttpCartAdapter({ fetch });

	const err = await adapter.fetch(ctx).catch((e) => e);
	assert(err instanceof Error);
	assertEquals((err as Error & { status: number }).status, 500);
	assertEquals((err as Error & { body: string }).body, "boom");
});

// ─── wishlist ────────────────────────────────────────────────────────────

Deno.test("http wishlist: addItem POSTs { product_id }", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: { data: { items: [] } } }));
	const adapter = createHttpWishlistAdapter({ fetch });
	await adapter.addItem("p1", ctx);

	assertEquals(calls[0].method, "POST");
	assertEquals(calls[0].url, "/api/session/wishlist");
	assertEquals(calls[0].body, '{"product_id":"p1"}');
});

Deno.test("http wishlist: removeItem DELETEs with product_id query", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: { data: { items: [] } } }));
	const adapter = createHttpWishlistAdapter({ fetch });
	await adapter.removeItem("p1", ctx);

	assertEquals(calls[0].method, "DELETE");
	assertEquals(calls[0].url, "/api/session/wishlist?product_id=p1");
});

// ─── product ─────────────────────────────────────────────────────────────

Deno.test("http product: fetchOne unwraps { model_id, data }", async () => {
	const { fetch, calls } = makeFetch(() => ({
		body: { model_id: "p1", data: { name: "Widget", price: 100 } },
	}));
	const adapter = createHttpProductAdapter({ fetch });
	const data = await adapter.fetchOne("p1", {});

	assertEquals(calls[0].url, "/api/product/col/product/mod/p1");
	assertEquals((data as { name: string }).name, "Widget");
});

Deno.test("http product: fetchMany parallel-fetches each id", async () => {
	const { fetch, calls } = makeFetch((req) => {
		const id = req.url.split("/").pop();
		return { body: { model_id: id, data: { name: `P-${id}` } } };
	});
	const adapter = createHttpProductAdapter({ fetch });
	const data = await adapter.fetchMany(["a", "b", "c"], {});

	assertEquals(calls.length, 3);
	assertEquals(data.length, 3);
});

Deno.test("http product: fetchMany with empty list makes zero calls", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: {} }));
	const adapter = createHttpProductAdapter({ fetch });
	const data = await adapter.fetchMany([], {});
	assertEquals(calls.length, 0);
	assertEquals(data.length, 0);
});

// ─── order ───────────────────────────────────────────────────────────────

Deno.test("http order: fetchAll GETs /col/order/mod", async () => {
	const { fetch, calls } = makeFetch(() => ({
		body: { data: [{ model_id: "o1", data: { status: "pending", items: [] } }] },
	}));
	const adapter = createHttpOrderAdapter({ fetch });
	const orders = await adapter.fetchAll(ctx);

	assertEquals(calls[0].url, "/api/order/col/order/mod");
	assertEquals(orders.length, 1);
	assertEquals(orders[0].model_id, "o1");
});

Deno.test("http order: fetchOne GETs /col/order/mod/:id", async () => {
	const { fetch, calls } = makeFetch(() => ({
		body: { model_id: "o1", data: { status: "pending", items: [] } },
	}));
	const adapter = createHttpOrderAdapter({ fetch });
	const order = await adapter.fetchOne("o1", ctx);

	assertEquals(calls[0].url, "/api/order/col/order/mod/o1");
	assertEquals(order.model_id, "o1");
});

Deno.test("http order: create POSTs /checkout/start and returns { model_id, data }", async () => {
	const { fetch, calls } = makeFetch(() => ({
		body: {
			order_id: "o1",
			customer_id: "c-1",
			is_new_customer: false,
			order: { status: "pending", items: [], currency: "EUR", totals: {} },
		},
	}));
	const adapter = createHttpOrderAdapter({ fetch });
	const r = await adapter.create(
		{
			items: [],
			currency: "EUR",
			totals: { subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 0 },
			customer_email: "buyer@example.com",
		},
		ctx,
	);

	assertEquals(calls[0].method, "POST");
	assertEquals(calls[0].url, "/api/order/checkout/start");
	assertEquals(r.model_id, "o1");
	assert(calls[0].body!.includes("buyer@example.com"));
});

Deno.test("http order: create without sessionId throws client-side", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: {} }));
	const adapter = createHttpOrderAdapter({ fetch });

	await assertRejects(
		() =>
			adapter.create(
				{
					items: [],
					currency: "EUR",
					totals: { subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 0 },
				},
				{ jwt: "tok" },
			),
		Error,
		"sessionId required",
	);
	assertEquals(calls.length, 0);
});

// ─── customer ────────────────────────────────────────────────────────────

Deno.test("http customer: fetch GETs /me/col/customer/mod/:customerId", async () => {
	const { fetch, calls } = makeFetch(() => ({
		body: {
			model_id: "c-1",
			data: { email: "x@y.z", first_name: "X", last_name: "Y" },
		},
	}));
	const adapter = createHttpCustomerAdapter({ fetch });
	const data = await adapter.fetch(ctx);

	assertEquals(calls[0].url, "/api/customer/me/col/customer/mod/c-1");
	assertEquals(data.email, "x@y.z");
});

Deno.test("http customer: update PUTs partial body to same URL", async () => {
	const { fetch, calls } = makeFetch(() => ({
		body: { model_id: "c-1", data: { email: "x@y.z", first_name: "X", last_name: "Z" } },
	}));
	const adapter = createHttpCustomerAdapter({ fetch });
	await adapter.update({ last_name: "Z" }, ctx);

	assertEquals(calls[0].method, "PUT");
	assertEquals(calls[0].body, '{"last_name":"Z"}');
});

Deno.test("http customer: fetch without customerId throws client-side", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: {} }));
	const adapter = createHttpCustomerAdapter({ fetch });

	await assertRejects(
		() => adapter.fetch({ jwt: "tok" }),
		Error,
		"customerId required",
	);
	assertEquals(calls.length, 0);
});

// ─── payment ─────────────────────────────────────────────────────────────

Deno.test("http payment: fetchForOrder GETs /by-order/:orderId and unwraps envelopes", async () => {
	const { fetch, calls } = makeFetch(() => ({
		body: {
			data: [
				{
					model_id: "pay1",
					data: {
						provider: "mock",
						status: "completed",
						amount: 100,
						currency: "EUR",
						provider_reference: "ref1",
					},
				},
			],
		},
	}));
	const adapter = createHttpPaymentAdapter({ fetch });
	const payments = await adapter.fetchForOrder("o1", ctx);

	assertEquals(calls[0].url, "/api/payment/by-order/o1");
	assertEquals(payments.length, 1);
	assertEquals(payments[0].provider_reference, "ref1");
});

Deno.test("http payment: initiate POSTs /initiate with order_id + provider + return_url + cancel_url", async () => {
	const { fetch, calls } = makeFetch(() => ({
		body: { payment_id: "pi-1", redirect_url: "https://pay/go" },
	}));
	const adapter = createHttpPaymentAdapter({ fetch });
	const intent = await adapter.initiate!(
		"o1",
		{
			provider: "mock",
			amount: 100, // server ignores; adapter drops
			currency: "EUR",
			return_url: "https://app.test/return",
			cancel_url: "https://app.test/cancel",
		},
		ctx,
	);

	assertEquals(calls[0].method, "POST");
	assertEquals(calls[0].url, "/api/payment/initiate");
	const parsed = JSON.parse(calls[0].body!);
	assertEquals(parsed.order_id, "o1");
	assertEquals(parsed.provider, "mock");
	assertEquals(parsed.return_url, "https://app.test/return");
	assertEquals(parsed.cancel_url, "https://app.test/cancel");
	// amount + currency must not leak — the server derives them from the order
	assertEquals(parsed.amount, undefined);
	assertEquals(parsed.currency, undefined);
	// response maps payment_id → id on the PaymentIntent shape
	assertEquals(intent.id, "pi-1");
	assertEquals(intent.redirect_url, "https://pay/go");
});

Deno.test("http payment: initiate without return_url throws client-side", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: {} }));
	const adapter = createHttpPaymentAdapter({ fetch });

	await assertRejects(
		() =>
			adapter.initiate!(
				"o1",
				{
					provider: "mock",
					amount: 0,
					currency: "EUR",
					cancel_url: "https://x/c",
				},
				ctx,
			),
		Error,
		"return_url required",
	);
	assertEquals(calls.length, 0);
});

Deno.test("http payment: initiate without cancel_url throws client-side", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: {} }));
	const adapter = createHttpPaymentAdapter({ fetch });

	await assertRejects(
		() =>
			adapter.initiate!(
				"o1",
				{
					provider: "mock",
					amount: 0,
					currency: "EUR",
					return_url: "https://x/r",
				},
				ctx,
			),
		Error,
		"cancel_url required",
	);
	assertEquals(calls.length, 0);
});

Deno.test("http payment: initiate without sessionId throws client-side", async () => {
	const { fetch, calls } = makeFetch(() => ({ body: {} }));
	const adapter = createHttpPaymentAdapter({ fetch });

	await assertRejects(
		() =>
			adapter.initiate!(
				"o1",
				{
					provider: "mock",
					amount: 0,
					currency: "EUR",
					return_url: "https://x/r",
					cancel_url: "https://x/c",
				},
				{ jwt: "tok" },
			),
		Error,
		"sessionId required",
	);
	assertEquals(calls.length, 0);
});

Deno.test("http payment: capture is not present on the adapter", () => {
	const adapter = createHttpPaymentAdapter();
	assertEquals(adapter.capture, undefined);
});
