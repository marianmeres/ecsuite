/**
 * @module adapters/http/order
 *
 * Built-in {@link OrderAdapter} targeting a REST surface of the shape:
 *
 *   GET  {baseUrl}/col/order/mod         → { data: [{ model_id, data }, ...] }
 *   GET  {baseUrl}/col/order/mod/:id     → { model_id, data: OrderData }
 *   POST {baseUrl}/checkout/start    → { order_id, order: OrderData, ... }
 *
 * `create()` only starts checkout — it calls `POST /checkout/start` and
 * returns the freshly-created pending order. The multi-step completion
 * flow (addresses → delivery → payment → complete) is not wrapped by this
 * adapter; callers drive it via their own HTTP calls until ecsuite grows
 * dedicated verbs.
 *
 * Read endpoints require `Authorization: Bearer <jwt>`; checkout/start
 * additionally requires `X-Session-ID`.
 */

import type {
	OrderCreateResult,
	OrderData,
	UUID,
} from "@marianmeres/collection-types";
import type { OrderAdapter, OrderCreatePayload } from "../../types/adapter.ts";
import type { DomainContext } from "../../types/state.ts";
import {
	type HttpAdapterOptions,
	join,
	requestJson,
	requireSessionId,
	resolveFetch,
} from "./_http.ts";

/** Options for {@link createHttpOrderAdapter}. */
export type HttpOrderAdapterOptions = HttpAdapterOptions;

interface CheckoutStartResponse {
	order_id: UUID;
	customer_id?: UUID;
	is_new_customer?: boolean;
	order: OrderData;
}

/** Build an order adapter against the conventional `/api/order` REST surface. */
export function createHttpOrderAdapter(
	opts: HttpOrderAdapterOptions = {},
): OrderAdapter {
	const base = opts.baseUrl ?? "/api/order";
	const doFetch = resolveFetch(opts);

	return {
		async fetchAll(ctx: DomainContext): Promise<OrderCreateResult[]> {
			const r = await requestJson<{ data: OrderCreateResult[] }>(
				doFetch,
				join(base, "/col/order/mod"),
				{ method: "GET" },
				ctx,
			);
			return r.data ?? [];
		},

		async fetchOne(
			orderId: UUID,
			ctx: DomainContext,
		): Promise<OrderCreateResult> {
			return await requestJson<OrderCreateResult>(
				doFetch,
				join(base, `/col/order/mod/${encodeURIComponent(String(orderId))}`),
				{ method: "GET" },
				ctx,
			);
		},

		async create(
			order: OrderCreatePayload,
			ctx: DomainContext,
		): Promise<OrderCreateResult> {
			requireSessionId(ctx, "order.create");
			const body: Record<string, unknown> = {
				email: order.customer_email,
			};
			if (ctx.customerId) body.customer_id = ctx.customerId;
			const r = await requestJson<CheckoutStartResponse>(
				doFetch,
				join(base, "/checkout/start"),
				{ method: "POST", body: JSON.stringify(body) },
				ctx,
			);
			return { model_id: r.order_id, data: r.order };
		},
	};
}
