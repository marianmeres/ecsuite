/**
 * @module adapters/http/customer
 *
 * Built-in {@link CustomerAdapter} targeting the owner-scoped customer
 * REST surface:
 *
 *   GET {baseUrl}/me/col/customer/:customerId  → { model_id, data: CustomerData }
 *   PUT {baseUrl}/me/col/customer/:customerId  → { model_id, data: CustomerData }
 *
 * Both calls require `Authorization: Bearer <jwt>` + a `customerId` on the
 * context (typically resolved from the login subject claim).
 *
 * `fetchBySession` is intentionally not implemented — there is no clean
 * session-scoped read endpoint on the target REST surface; consumers who
 * need session-based bootstrapping should hydrate from the JWT instead.
 */

import type { CustomerData, UUID } from "@marianmeres/collection-types";
import type { CustomerAdapter } from "../../types/adapter.ts";
import type { DomainContext } from "../../types/state.ts";
import {
	type HttpAdapterOptions,
	join,
	requestJson,
	requireCustomerId,
	resolveFetch,
} from "./_http.ts";

/** Options for {@link createHttpCustomerAdapter}. */
export type HttpCustomerAdapterOptions = HttpAdapterOptions;

/** Build a customer adapter against the conventional owner-scoped REST surface. */
export function createHttpCustomerAdapter(
	opts: HttpCustomerAdapterOptions = {},
): CustomerAdapter {
	const base = opts.baseUrl ?? "/api/customer";
	const doFetch = resolveFetch(opts);

	const url = (customerId: string) =>
		join(base, `/me/col/customer/${encodeURIComponent(customerId)}`);

	return {
		async fetch(ctx: DomainContext): Promise<CustomerData> {
			const customerId = requireCustomerId(ctx, "customer.fetch");
			const r = await requestJson<{ model_id: UUID; data: CustomerData }>(
				doFetch,
				url(customerId),
				{ method: "GET" },
				ctx,
			);
			return r.data;
		},

		async update(
			data: Partial<CustomerData>,
			ctx: DomainContext,
		): Promise<CustomerData> {
			const customerId = requireCustomerId(ctx, "customer.update");
			const r = await requestJson<{ model_id: UUID; data: CustomerData }>(
				doFetch,
				url(customerId),
				{ method: "PUT", body: JSON.stringify(data) },
				ctx,
			);
			return r.data;
		},
	};
}
