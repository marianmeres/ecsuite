/**
 * @module adapters/http/product
 *
 * Built-in {@link ProductAdapter} targeting a generic collection REST surface:
 *
 *   GET {baseUrl}/col/product/:id → { model_id, data: ProductData, ... }
 *
 * The `{ model_id, data }` model envelope is unwrapped; the adapter returns
 * bare `ProductData` / `ProductData[]` to conform to the interface.
 *
 * There is no batch endpoint — `fetchMany` issues parallel GETs.
 */

import type { ProductData, UUID } from "@marianmeres/collection-types";
import type { ProductAdapter } from "../../types/adapter.ts";
import type { DomainContext } from "../../types/state.ts";
import {
	type HttpAdapterOptions,
	join,
	requestJson,
	resolveFetch,
} from "./_http.ts";

/** Options for {@link createHttpProductAdapter}. */
export type HttpProductAdapterOptions = HttpAdapterOptions;

/** Build a product adapter against the conventional `/col/product` REST surface. */
export function createHttpProductAdapter(
	opts: HttpProductAdapterOptions = {},
): ProductAdapter {
	const base = opts.baseUrl ?? "/api/product";
	const doFetch = resolveFetch(opts);

	async function fetchOne(
		productId: UUID,
		ctx: DomainContext,
	): Promise<ProductData> {
		const r = await requestJson<{ model_id: UUID; data: ProductData }>(
			doFetch,
			join(base, `/col/product/${encodeURIComponent(String(productId))}`),
			{ method: "GET" },
			ctx,
		);
		return r.data;
	}

	return {
		fetchOne,

		async fetchMany(
			productIds: UUID[],
			ctx: DomainContext,
		): Promise<ProductData[]> {
			if (productIds.length === 0) return [];
			return Promise.all(productIds.map((id) => fetchOne(id, ctx)));
		},
	};
}
