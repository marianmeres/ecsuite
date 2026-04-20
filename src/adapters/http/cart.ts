/**
 * @module adapters/http/cart
 *
 * Built-in {@link CartAdapter} targeting a REST surface of the shape:
 *
 *   GET    {baseUrl}/cart                 → { data: CartData }
 *   POST   {baseUrl}/cart                 → { data: CartData }   body: CartItem
 *   PUT    {baseUrl}/cart                 → { data: CartData }   body: { product_id, quantity }
 *   DELETE {baseUrl}/cart?product_id=...  → { data: CartData }   (remove single item)
 *   DELETE {baseUrl}/cart                 → { data: CartData }   (clear)
 *
 * All mutations require `X-Session-ID` on the request. The adapter reads
 * `ctx.sessionId` and throws a client-side error if missing so failures
 * surface before the network round-trip.
 */

import type { CartData, CartItem, UUID } from "@marianmeres/collection-types";
import type { CartAdapter } from "../../types/adapter.ts";
import type { DomainContext } from "../../types/state.ts";
import {
	type HttpAdapterOptions,
	join,
	requestJson,
	requireSessionId,
	resolveFetch,
} from "./_http.ts";

/** Options for {@link createHttpCartAdapter}. */
export type HttpCartAdapterOptions = HttpAdapterOptions;

/** Build a cart adapter against the conventional `/cart` REST surface. */
export function createHttpCartAdapter(
	opts: HttpCartAdapterOptions = {},
): CartAdapter {
	const base = opts.baseUrl ?? "/api/session";
	const doFetch = resolveFetch(opts);
	const url = () => join(base, "/cart");

	return {
		async fetch(ctx: DomainContext): Promise<CartData> {
			const r = await requestJson<{ data: CartData }>(
				doFetch,
				url(),
				{ method: "GET" },
				ctx,
			);
			return r.data;
		},

		async addItem(item: CartItem, ctx: DomainContext): Promise<CartData> {
			requireSessionId(ctx, "cart.addItem");
			const r = await requestJson<{ data: CartData }>(
				doFetch,
				url(),
				{ method: "POST", body: JSON.stringify(item) },
				ctx,
			);
			return r.data;
		},

		async updateItem(
			productId: UUID,
			quantity: number,
			ctx: DomainContext,
		): Promise<CartData> {
			requireSessionId(ctx, "cart.updateItem");
			const r = await requestJson<{ data: CartData }>(
				doFetch,
				url(),
				{
					method: "PUT",
					body: JSON.stringify({ product_id: productId, quantity }),
				},
				ctx,
			);
			return r.data;
		},

		async removeItem(productId: UUID, ctx: DomainContext): Promise<CartData> {
			requireSessionId(ctx, "cart.removeItem");
			const qs = new URLSearchParams({ product_id: String(productId) });
			const r = await requestJson<{ data: CartData }>(
				doFetch,
				`${url()}?${qs}`,
				{ method: "DELETE" },
				ctx,
			);
			return r.data;
		},

		async clear(ctx: DomainContext): Promise<CartData> {
			requireSessionId(ctx, "cart.clear");
			const r = await requestJson<{ data: CartData }>(
				doFetch,
				url(),
				{ method: "DELETE" },
				ctx,
			);
			return r.data;
		},
	};
}
