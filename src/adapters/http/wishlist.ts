/**
 * @module adapters/http/wishlist
 *
 * Built-in {@link WishlistAdapter} targeting a REST surface of the shape:
 *
 *   GET    {baseUrl}/wishlist                 → { data: WishlistData }
 *   POST   {baseUrl}/wishlist                 → { data: WishlistData, added?: boolean }
 *   DELETE {baseUrl}/wishlist?product_id=...  → { data: WishlistData }
 *   DELETE {baseUrl}/wishlist                 → { data: WishlistData } (clear)
 *
 * Mutations require `X-Session-ID`. Add/toggle is idempotent on the server
 * side — adding a product already present is a no-op for the wishlist state.
 */

import type { UUID, WishlistData } from "@marianmeres/collection-types";
import type { WishlistAdapter } from "../../types/adapter.ts";
import type { DomainContext } from "../../types/state.ts";
import {
	type HttpAdapterOptions,
	join,
	requestJson,
	requireSessionId,
	resolveFetch,
} from "./_http.ts";

/** Options for {@link createHttpWishlistAdapter}. */
export type HttpWishlistAdapterOptions = HttpAdapterOptions;

/** Build a wishlist adapter against the conventional `/wishlist` REST surface. */
export function createHttpWishlistAdapter(
	opts: HttpWishlistAdapterOptions = {},
): WishlistAdapter {
	const base = opts.baseUrl ?? "/api/session";
	const doFetch = resolveFetch(opts);
	const url = () => join(base, "/wishlist");

	return {
		async fetch(ctx: DomainContext): Promise<WishlistData> {
			const r = await requestJson<{ data: WishlistData }>(
				doFetch,
				url(),
				{ method: "GET" },
				ctx,
			);
			return r.data;
		},

		async addItem(productId: UUID, ctx: DomainContext): Promise<WishlistData> {
			requireSessionId(ctx, "wishlist.addItem");
			const r = await requestJson<{ data: WishlistData }>(
				doFetch,
				url(),
				{ method: "POST", body: JSON.stringify({ product_id: productId }) },
				ctx,
			);
			return r.data;
		},

		async removeItem(
			productId: UUID,
			ctx: DomainContext,
		): Promise<WishlistData> {
			requireSessionId(ctx, "wishlist.removeItem");
			const qs = new URLSearchParams({ product_id: String(productId) });
			const r = await requestJson<{ data: WishlistData }>(
				doFetch,
				`${url()}?${qs}`,
				{ method: "DELETE" },
				ctx,
			);
			return r.data;
		},

		async clear(ctx: DomainContext): Promise<WishlistData> {
			requireSessionId(ctx, "wishlist.clear");
			const r = await requestJson<{ data: WishlistData }>(
				doFetch,
				url(),
				{ method: "DELETE" },
				ctx,
			);
			return r.data;
		},
	};
}
