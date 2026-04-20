/**
 * @module adapters/http
 *
 * Built-in HTTP adapters targeting a conventional REST surface.
 *
 * Each factory takes `{ baseUrl?, fetch? }` and returns an adapter that
 * conforms to the matching interface from `../../types/adapter.ts`.
 * Adapters throw raw HTTP errors (`Error` with `.status` + `.body`);
 * domain managers normalize them to `DomainError`.
 *
 * Authentication is carried on the context passed to each call:
 *   - `ctx.sessionId` → emitted as `X-Session-ID`
 *   - `ctx.jwt`       → emitted as `Authorization: Bearer <jwt>`
 */

export {
	type HttpAdapterOptions,
} from "./_http.ts";

export { createHttpCartAdapter, type HttpCartAdapterOptions } from "./cart.ts";
export {
	createHttpWishlistAdapter,
	type HttpWishlistAdapterOptions,
} from "./wishlist.ts";
export { createHttpOrderAdapter, type HttpOrderAdapterOptions } from "./order.ts";
export {
	createHttpCustomerAdapter,
	type HttpCustomerAdapterOptions,
} from "./customer.ts";
export {
	createHttpPaymentAdapter,
	type HttpPaymentAdapterOptions,
} from "./payment.ts";
export {
	createHttpProductAdapter,
	type HttpProductAdapterOptions,
} from "./product.ts";
