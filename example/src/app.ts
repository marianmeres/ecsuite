/// <reference lib="dom" />
/**
 * Vanilla-JS reference harness for the ecsuite commerce managers.
 *
 * Intentionally unstyled — the point is to see every verb wired against the
 * public API surface, not to demonstrate UI.
 */

import {
	createECSuite,
	createHttpCartAdapter,
	createHttpCustomerAdapter,
	createHttpOrderAdapter,
	createHttpPaymentAdapter,
	createHttpProductAdapter,
	createHttpWishlistAdapter,
	createMockCartAdapter,
	createMockCustomerAdapter,
	createMockOrderAdapter,
	createMockPaymentAdapter,
	createMockProductAdapter,
	createMockWishlistAdapter,
	type DomainStateWrapper,
	type ECSuite,
} from "../../src/mod.ts";

const KEY_URL = "ecsuite-example:baseUrl";
const KEY_JWT = "ecsuite-example:jwt";
const KEY_SESSION = "ecsuite-example:sessionId";
const KEY_CUSTOMER = "ecsuite-example:customerId";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
	const el = document.getElementById(id);
	if (!el) throw new Error(`element #${id} not found`);
	return el as T;
};

// ─── DOM ──────────────────────────────────────────────────────────────────

const baseUrlEl = $<HTMLInputElement>("baseUrl");
const jwtEl = $<HTMLInputElement>("jwt");
const sessionIdEl = $<HTMLInputElement>("sessionId");
const customerIdEl = $<HTMLInputElement>("customerId");
const cartProductEl = $<HTMLInputElement>("cartProduct");
const cartQtyEl = $<HTMLInputElement>("cartQty");
const wishProductEl = $<HTMLInputElement>("wishProduct");
const orderEmailEl = $<HTMLInputElement>("orderEmail");
const orderIdEl = $<HTMLInputElement>("orderId");
const custEmailEl = $<HTMLInputElement>("custEmail");
const custFirstEl = $<HTMLInputElement>("custFirst");
const custLastEl = $<HTMLInputElement>("custLast");
const payOrderIdEl = $<HTMLInputElement>("payOrderId");
const payIdEl = $<HTMLInputElement>("payId");
const prodIdEl = $<HTMLInputElement>("prodId");
const prodIdsEl = $<HTMLInputElement>("prodIds");
const latencyEl = $<HTMLInputElement>("latency");
const failTogglesEl = $<HTMLDivElement>("failToggles");
const logEl = $<HTMLDivElement>("log");

// ─── logging ──────────────────────────────────────────────────────────────

function ts(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${
		String(d.getMilliseconds()).padStart(3, "0")
	}`;
}

function safe(v: unknown): string {
	try {
		return typeof v === "string" ? v : JSON.stringify(v);
	} catch {
		return String(v);
	}
}

function log(kind: string, data: unknown): void {
	const line = document.createElement("div");
	line.textContent = `[${ts()}] ${kind} — ${safe(data)}`;
	logEl.appendChild(line);
	logEl.scrollTop = logEl.scrollHeight;
}

async function run<T>(label: string, fn: () => Promise<T> | T): Promise<void> {
	log(`action:${label}`, "started");
	try {
		const result = await fn();
		log(`action:${label}`, result ?? "ok");
	} catch (err) {
		const e = err as { message?: string; status?: number; body?: string };
		log(
			`action:${label}:ERROR`,
			e.status
				? `${e.status} ${e.message ?? ""} ${e.body ?? ""}`.trim()
				: e.message ?? String(err),
		);
	}
}

// ─── failure injection decorator ──────────────────────────────────────────

type DomainKey = "cart" | "wishlist" | "order" | "customer" | "payment" | "product";

const FAILABLE: Record<DomainKey, string[]> = {
	cart: ["fetch", "addItem", "updateItem", "removeItem", "clear"],
	wishlist: ["fetch", "addItem", "removeItem", "clear"],
	order: ["fetchAll", "fetchOne", "create"],
	customer: ["fetch", "update"],
	payment: ["fetchForOrder", "fetchOne", "initiate", "capture"],
	product: ["fetchOne", "fetchMany"],
};

const failConfig: { fails: Record<string, boolean>; latencyMs: number } = {
	fails: {},
	latencyMs: 0,
};

function failKey(domain: DomainKey, method: string): string {
	return `${domain}.${method}`;
}

function withFailureInjection<A extends object>(domain: DomainKey, adapter: A): A {
	return new Proxy(adapter, {
		get(target, prop, receiver) {
			const real = Reflect.get(target, prop, receiver);
			if (typeof real !== "function") return real;
			const method = String(prop);
			return async (...args: unknown[]) => {
				if (failConfig.latencyMs > 0) {
					await new Promise((r) => setTimeout(r, failConfig.latencyMs));
				}
				if (failConfig.fails[failKey(domain, method)]) {
					throw Object.assign(
						new Error(`injected failure: ${domain}.${method}`),
						{ status: 500, body: `injected failure: ${domain}.${method}` },
					);
				}
				return (real as (...a: unknown[]) => unknown).apply(target, args);
			};
		},
	});
}

function buildFailToggles(): void {
	failTogglesEl.innerHTML = "";
	for (const [domain, methods] of Object.entries(FAILABLE) as [DomainKey, string[]][]) {
		for (const method of methods) {
			const k = failKey(domain, method);
			const id = `fail-${k.replace(".", "-")}`;
			const wrap = document.createElement("label");
			const cb = document.createElement("input");
			cb.type = "checkbox";
			cb.id = id;
			cb.addEventListener("change", () => {
				failConfig.fails[k] = cb.checked;
				log("failureConfig", { [k]: cb.checked });
			});
			wrap.appendChild(cb);
			wrap.append(` ${k}`);
			failTogglesEl.appendChild(wrap);
		}
	}
}

latencyEl.addEventListener("change", () => {
	failConfig.latencyMs = Number(latencyEl.value) || 0;
	log("failureConfig", { latencyMs: failConfig.latencyMs });
});

// ─── suite lifecycle ──────────────────────────────────────────────────────

let suite: ECSuite | null = null;
const stateUnsubs: Array<() => void> = [];
let lastMode: "mock" | "http" | null = null;

function stateClass(state: string): string {
	return `state-${state}`;
}

function teardown(): void {
	for (const u of stateUnsubs.splice(0)) u();
	if (suite) {
		suite.destroy();
		suite = null;
	}
}

function currentContext() {
	const ctx: Record<string, unknown> = {};
	if (sessionIdEl.value.trim()) ctx.sessionId = sessionIdEl.value.trim();
	if (jwtEl.value.trim()) ctx.jwt = jwtEl.value.trim();
	if (customerIdEl.value.trim()) ctx.customerId = customerIdEl.value.trim();
	return ctx;
}

function persist(): void {
	localStorage.setItem(KEY_URL, baseUrlEl.value);
	localStorage.setItem(KEY_JWT, jwtEl.value);
	localStorage.setItem(KEY_SESSION, sessionIdEl.value);
	localStorage.setItem(KEY_CUSTOMER, customerIdEl.value);
}

function buildMockAdapters() {
	// Seed 3 hardcoded products so product fetches produce something visible.
	const products = [
		{ model_id: "p-widget", name: "Widget", price: 100, sku: "WID" },
		{ model_id: "p-gadget", name: "Gadget", price: 250, sku: "GAD" },
		{ model_id: "p-sprocket", name: "Sprocket", price: 50, sku: "SPR" },
	];
	return {
		cart: withFailureInjection("cart", createMockCartAdapter({})),
		wishlist: withFailureInjection("wishlist", createMockWishlistAdapter({})),
		order: withFailureInjection("order", createMockOrderAdapter({})),
		customer: withFailureInjection(
			"customer",
			createMockCustomerAdapter({
				initialData: {
					email: "demo@example.com",
					first_name: "Demo",
					last_name: "User",
					guest: false,
					accepts_marketing: false,
				},
			}),
		),
		payment: withFailureInjection("payment", createMockPaymentAdapter({})),
		product: withFailureInjection(
			"product",
			createMockProductAdapter({ products }),
		),
	};
}

function buildHttpAdapters() {
	const baseUrl = baseUrlEl.value.trim() || "http://localhost:8888";
	const b = (path: string) => `${baseUrl.replace(/\/$/, "")}${path}`;
	return {
		cart: withFailureInjection("cart", createHttpCartAdapter({ baseUrl: b("/api/session") })),
		wishlist: withFailureInjection(
			"wishlist",
			createHttpWishlistAdapter({ baseUrl: b("/api/session") }),
		),
		order: withFailureInjection("order", createHttpOrderAdapter({ baseUrl: b("/api/order") })),
		customer: withFailureInjection(
			"customer",
			createHttpCustomerAdapter({ baseUrl: b("/api/customer") }),
		),
		payment: withFailureInjection(
			"payment",
			createHttpPaymentAdapter({ baseUrl: b("/api/payment") }),
		),
		product: withFailureInjection(
			"product",
			createHttpProductAdapter({ baseUrl: b("/api/product") }),
		),
	};
}

function buildSuite(mode: "mock" | "http"): void {
	persist();
	teardown();
	lastMode = mode;

	const adapters = mode === "mock" ? buildMockAdapters() : buildHttpAdapters();
	suite = createECSuite({
		adapters,
		context: currentContext(),
		autoInitialize: false,
		storage: { type: "memory" },
	});

	suite.onAny(({ event, data }) => log(`event:${event}`, data));

	const domains: DomainKey[] = [
		"cart",
		"wishlist",
		"order",
		"customer",
		"payment",
		"product",
	];
	for (const d of domains) {
		const pre = $<HTMLPreElement>(`state-${d}`);
		const render = (w: DomainStateWrapper<unknown>) => {
			pre.className = stateClass(w.state);
			const extra = d === "product"
				? { cacheSize: suite?.product.getCacheSize() }
				: {};
			pre.textContent = JSON.stringify({ ...w, ...extra }, null, 2);
		};
		stateUnsubs.push(suite[d].subscribe(render));
	}

	log("info", `suite built (${mode})`);
}

function requireSuite(): ECSuite | null {
	if (!suite) {
		log("error", "click 'use mocks' or 'connect (http)' first");
		return null;
	}
	return suite;
}

// ─── connect controls ─────────────────────────────────────────────────────

$("useMocks").addEventListener("click", () => buildSuite("mock"));
$("useHttp").addEventListener("click", () => buildSuite("http"));
$("destroy").addEventListener("click", () => {
	teardown();
	log("info", "suite destroyed");
});
$("rebuild").addEventListener("click", () => {
	if (lastMode) buildSuite(lastMode);
	else log("error", "no previous mode to rebuild");
});
$("errors").addEventListener("click", () => {
	const s = requireSuite();
	if (!s) return;
	const errs: Record<string, unknown> = {};
	for (const d of ["cart", "wishlist", "order", "customer", "payment", "product"] as const) {
		const state = s[d].get();
		if (state.error) errs[d] = state.error;
	}
	log("errors", Object.keys(errs).length ? errs : "none");
});

// ─── cross-domain ─────────────────────────────────────────────────────────

$("initAll").addEventListener("click", () => {
	const s = requireSuite();
	if (!s) return;
	run("initialize(all)", () => s.initialize());
});
$("initCart").addEventListener("click", () => {
	const s = requireSuite();
	if (!s) return;
	run("initialize([cart])", () => s.initialize(["cart"]));
});
$("setContext").addEventListener("click", () => {
	const s = requireSuite();
	if (!s) return;
	const ctx = currentContext();
	run("setContext", () => {
		s.setContext(ctx);
		return ctx;
	});
});

// ─── per-domain buttons (wired by data- attributes) ───────────────────────

function productId(): string {
	return cartProductEl.value.trim() || "p-widget";
}

function wireDomainButtons(): void {
	document.querySelectorAll<HTMLButtonElement>("button[data-cart]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const s = requireSuite();
			if (!s) return;
			const method = btn.dataset.cart!;
			const qty = Number(cartQtyEl.value) || 1;
			switch (method) {
				case "initialize":
					return run("cart.initialize", () => s.cart.initialize());
				case "addItem":
					return run("cart.addItem", () =>
						s.cart.addItem({ product_id: productId(), quantity: qty }));
				case "updateItemQuantity":
					return run("cart.updateItemQuantity", () =>
						s.cart.updateItemQuantity(productId(), qty));
				case "removeItem":
					return run("cart.removeItem", () => s.cart.removeItem(productId()));
				case "clear":
					return run("cart.clear", () => s.cart.clear());
				case "getEnrichedItems":
					return run("cart.getEnrichedItems", () =>
						s.cart.getEnrichedItems(s.product));
			}
		});
	});

	document.querySelectorAll<HTMLButtonElement>("button[data-wishlist]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const s = requireSuite();
			if (!s) return;
			const method = btn.dataset.wishlist!;
			const id = wishProductEl.value.trim() || "p-widget";
			switch (method) {
				case "initialize":
					return run("wishlist.initialize", () => s.wishlist.initialize());
				case "addItem":
					return run("wishlist.addItem", () => s.wishlist.addItem(id));
				case "removeItem":
					return run("wishlist.removeItem", () => s.wishlist.removeItem(id));
				case "toggleItem":
					return run("wishlist.toggleItem", () => s.wishlist.toggleItem(id));
				case "clear":
					return run("wishlist.clear", () => s.wishlist.clear());
				case "getEnrichedItems":
					return run("wishlist.getEnrichedItems", () =>
						s.wishlist.getEnrichedItems(s.product));
			}
		});
	});

	document.querySelectorAll<HTMLButtonElement>("button[data-order]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const s = requireSuite();
			if (!s) return;
			const method = btn.dataset.order!;
			switch (method) {
				case "initialize":
					return run("order.initialize", () => s.order.initialize());
				case "fetchAll":
					return run("order.fetchAll", () => s.order.fetchAll());
				case "fetchOne":
					return run("order.fetchOne", () => s.order.fetchOne(orderIdEl.value.trim()));
				case "create":
					return run("order.create", () =>
						s.order.create({
							items: [],
							currency: "EUR",
							totals: { subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 0 },
							customer_email: orderEmailEl.value.trim() || "demo@example.com",
						}));
			}
		});
	});

	document.querySelectorAll<HTMLButtonElement>("button[data-customer]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const s = requireSuite();
			if (!s) return;
			const method = btn.dataset.customer!;
			switch (method) {
				case "initialize":
					return run("customer.initialize", () => s.customer.initialize());
				case "refresh":
					return run("customer.refresh", () => s.customer.refresh());
				case "update":
					return run("customer.update", () =>
						s.customer.update({
							email: custEmailEl.value.trim() || undefined,
							first_name: custFirstEl.value.trim() || undefined,
							last_name: custLastEl.value.trim() || undefined,
						}));
			}
		});
	});

	document.querySelectorAll<HTMLButtonElement>("button[data-payment]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const s = requireSuite();
			if (!s) return;
			const method = btn.dataset.payment!;
			switch (method) {
				case "initialize":
					return run("payment.initialize", () => s.payment.initialize());
				case "fetchForOrder":
					return run("payment.fetchForOrder", () =>
						s.payment.fetchForOrder(payOrderIdEl.value.trim()));
				case "fetchOne":
					return run("payment.fetchOne", () =>
						s.payment.fetchOne(payIdEl.value.trim()));
				case "initiate":
					return run("payment.initiate", () =>
						s.payment.initiate(payOrderIdEl.value.trim(), {
							provider: "mock",
							amount: 0, // mock adapter uses this; HTTP adapter drops it (server derives from order)
							currency: "EUR",
							return_url: `${location.origin}/example/return`,
							cancel_url: `${location.origin}/example/cancel`,
						}));
				case "capture":
					return run("payment.capture", () =>
						s.payment.capture(payIdEl.value.trim()));
			}
		});
	});

	document.querySelectorAll<HTMLButtonElement>("button[data-product]").forEach((btn) => {
		btn.addEventListener("click", async () => {
			const s = requireSuite();
			if (!s) return;
			const method = btn.dataset.product!;
			switch (method) {
				case "getById":
					return run("product.getById", () =>
						s.product.getById(prodIdEl.value.trim() || "p-widget"));
				case "getByIds": {
					const ids = prodIdsEl.value.split(",").map((x) => x.trim()).filter(Boolean);
					return run("product.getByIds", async () => {
						const map = await s.product.getByIds(ids);
						return Array.from(map.entries());
					});
				}
				case "prefetch": {
					const ids = prodIdsEl.value.split(",").map((x) => x.trim()).filter(Boolean);
					return run("product.prefetch", () => s.product.prefetch(ids));
				}
				case "clearCache":
					return run("product.clearCache", () => {
						s.product.clearCache();
						return { cacheSize: s.product.getCacheSize() };
					});
				case "listServer": {
					if (lastMode !== "http") {
						log("error", "listServer only works in http mode");
						return;
					}
					const baseUrl = baseUrlEl.value.trim().replace(/\/$/, "");
					return run("product.listServer (direct fetch)", async () => {
						const res = await fetch(`${baseUrl}/api/product/col/product?limit=5`);
						if (!res.ok) {
							throw Object.assign(new Error(await res.text()), { status: res.status });
						}
						return res.json();
					});
				}
			}
		});
	});
}

// ─── hydrate ──────────────────────────────────────────────────────────────

function hydrate(): void {
	baseUrlEl.value = localStorage.getItem(KEY_URL) ?? "http://localhost:8888";
	jwtEl.value = localStorage.getItem(KEY_JWT) ?? "";
	let sid = localStorage.getItem(KEY_SESSION);
	if (!sid) {
		sid = crypto.randomUUID();
		localStorage.setItem(KEY_SESSION, sid);
	}
	sessionIdEl.value = sid;
	customerIdEl.value = localStorage.getItem(KEY_CUSTOMER) ?? "";
}

hydrate();
buildFailToggles();
wireDomainButtons();
log("info", "harness loaded — click 'use mocks' to start");
