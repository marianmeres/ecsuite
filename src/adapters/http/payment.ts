/**
 * @module adapters/http/payment
 *
 * Built-in {@link PaymentAdapter} targeting a REST surface of the shape:
 *
 *   GET  {baseUrl}/by-order/:orderId    → { data: [{ model_id, data: PaymentData }, ...] }
 *   GET  {baseUrl}/col/payment/:id      → { model_id, data: PaymentData }
 *   POST {baseUrl}/initiate             → { payment_id, redirect_url }
 *
 * All calls require `X-Session-ID`; read endpoints additionally take a JWT
 * if present.
 *
 * `initiate` targets a domain-scoped entry point that shares a service seam
 * with the order-checkout payment step. The server derives `amount` and
 * `currency` from the order record (not from the client) and only accepts
 * an initiation once the order has passed checkout validation (addresses +
 * delivery set). Callers must supply `provider`, `return_url`, and
 * `cancel_url` through `PaymentInitConfig` — `return_url` is typed on the
 * canonical config; `cancel_url` is read off the open index signature.
 *
 * `capture()` is intentionally not wired — the target REST surface does not
 * expose a client-facing capture endpoint (capture is driven server-side by
 * provider webhooks + the checkout/complete flow). The returned adapter
 * omits `capture`, so `PaymentManager.capture()` surfaces a NOT_IMPLEMENTED
 * error as designed.
 */

import type {
	PaymentData,
	PaymentInitConfig,
	PaymentIntent,
	UUID,
} from "@marianmeres/collection-types";
import type { PaymentAdapter } from "../../types/adapter.ts";
import type { DomainContext } from "../../types/state.ts";
import {
	type HttpAdapterOptions,
	join,
	requestJson,
	requireSessionId,
	resolveFetch,
} from "./_http.ts";

/** Options for {@link createHttpPaymentAdapter}. */
export type HttpPaymentAdapterOptions = HttpAdapterOptions;

interface PaymentEnvelope {
	model_id?: UUID;
	data?: PaymentData;
}

function unwrapPayment(envelope: PaymentEnvelope | PaymentData): PaymentData {
	const e = envelope as PaymentEnvelope;
	if (e && typeof e === "object" && e.data && "provider" in e.data) {
		return e.data;
	}
	return envelope as PaymentData;
}

/** Build a payment adapter against the conventional `/api/payment` REST surface. */
export function createHttpPaymentAdapter(
	opts: HttpPaymentAdapterOptions = {},
): PaymentAdapter {
	const base = opts.baseUrl ?? "/api/payment";
	const doFetch = resolveFetch(opts);

	return {
		async fetchForOrder(
			orderId: UUID,
			ctx: DomainContext,
		): Promise<PaymentData[]> {
			requireSessionId(ctx, "payment.fetchForOrder");
			const r = await requestJson<{ data: PaymentEnvelope[] }>(
				doFetch,
				join(base, `/by-order/${encodeURIComponent(String(orderId))}`),
				{ method: "GET" },
				ctx,
			);
			return (r.data ?? []).map(unwrapPayment);
		},

		async fetchOne(
			paymentId: UUID,
			ctx: DomainContext,
		): Promise<PaymentData> {
			const r = await requestJson<PaymentEnvelope>(
				doFetch,
				join(base, `/col/payment/${encodeURIComponent(String(paymentId))}`),
				{ method: "GET" },
				ctx,
			);
			return unwrapPayment(r);
		},

		async initiate(
			orderId: UUID,
			config: PaymentInitConfig,
			ctx: DomainContext,
		): Promise<PaymentIntent> {
			requireSessionId(ctx, "payment.initiate");
			const returnUrl = config.return_url;
			const cancelUrl = (config as { cancel_url?: unknown }).cancel_url;
			if (typeof returnUrl !== "string" || !returnUrl) {
				throw Object.assign(new Error("return_url required for payment.initiate"), {
					status: 400,
					body: "return_url required for payment.initiate",
				});
			}
			if (typeof cancelUrl !== "string" || !cancelUrl) {
				throw Object.assign(new Error("cancel_url required for payment.initiate"), {
					status: 400,
					body: "cancel_url required for payment.initiate",
				});
			}
			const r = await requestJson<{ payment_id: UUID; redirect_url: string }>(
				doFetch,
				join(base, "/initiate"),
				{
					method: "POST",
					body: JSON.stringify({
						order_id: orderId,
						provider: config.provider,
						return_url: returnUrl,
						cancel_url: cancelUrl,
					}),
				},
				ctx,
			);
			return { id: r.payment_id, redirect_url: r.redirect_url };
		},
	};
}
