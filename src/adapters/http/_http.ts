/**
 * @module adapters/http/_http
 *
 * Shared primitives for the built-in HTTP adapters.
 *
 * Adapters throw raw HTTP errors (`Error` with `.status` and `.body`
 * attached). `BaseDomainManager` catches and normalizes them to
 * `DomainError` at the call site — adapters don't normalize themselves.
 */

import type { DomainContext } from "../../types/state.ts";

/** Options shared by every built-in HTTP adapter factory. */
export interface HttpAdapterOptions {
	/** Base URL of the mounted REST app. Each adapter has its own default. */
	baseUrl?: string;
	/** Override the `fetch` implementation (useful for tests / SSR). */
	fetch?: typeof fetch;
}

export function resolveFetch(opts?: HttpAdapterOptions): typeof fetch {
	return opts?.fetch ?? globalThis.fetch.bind(globalThis);
}

/** Trailing-slash-safe path joining. */
export function join(base: string, path: string): string {
	if (!base) return path;
	if (base.endsWith("/")) return `${base.slice(0, -1)}${path}`;
	return `${base}${path}`;
}

export function authHeaders(ctx: DomainContext): HeadersInit {
	return ctx.jwt ? { Authorization: `Bearer ${ctx.jwt}` } : {};
}

export function sessionHeader(ctx: DomainContext): HeadersInit {
	return ctx.sessionId ? { "X-Session-ID": String(ctx.sessionId) } : {};
}

/**
 * Wrap `fetch`, merge auth + session + content-type headers, and throw a raw
 * HTTP error (with `.status` and `.body`) on non-OK. Returns `undefined` on
 * 204 No Content, otherwise the parsed JSON body.
 */
export async function requestJson<T>(
	doFetch: typeof fetch,
	url: string,
	init: RequestInit,
	ctx: DomainContext,
): Promise<T> {
	const hasBody = init.body !== undefined && init.body !== null;
	const res = await doFetch(url, {
		...init,
		headers: {
			...(hasBody ? { "Content-Type": "application/json" } : {}),
			...(init.headers ?? {}),
			...authHeaders(ctx),
			...sessionHeader(ctx),
		},
		signal: ctx.signal as AbortSignal | undefined,
	});
	if (!res.ok) {
		const text = await res.text();
		throw Object.assign(new Error(text || res.statusText), {
			status: res.status,
			body: text,
		});
	}
	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
}

/** Require `ctx.sessionId`; throw a client-side Error if missing. */
export function requireSessionId(ctx: DomainContext, operation: string): string {
	if (!ctx.sessionId) {
		throw Object.assign(
			new Error(`sessionId required for ${operation}`),
			{ status: 400, body: `sessionId required for ${operation}` },
		);
	}
	return String(ctx.sessionId);
}

/** Require `ctx.jwt`; throw a client-side Error if missing. */
export function requireJwt(ctx: DomainContext, operation: string): string {
	if (!ctx.jwt) {
		throw Object.assign(
			new Error(`jwt required for ${operation}`),
			{ status: 401, body: `jwt required for ${operation}` },
		);
	}
	return ctx.jwt;
}

/** Require `ctx.customerId`; throw a client-side Error if missing. */
export function requireCustomerId(ctx: DomainContext, operation: string): string {
	if (!ctx.customerId) {
		throw Object.assign(
			new Error(`customerId required for ${operation}`),
			{ status: 400, body: `customerId required for ${operation}` },
		);
	}
	return String(ctx.customerId);
}
