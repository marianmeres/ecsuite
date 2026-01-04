/**
 * @module @marianmeres/ecsuite
 *
 * E-commerce frontend UI helper library with optimistic updates,
 * Svelte-compatible stores, and adapter-based server sync.
 *
 * @example Basic usage
 * ```typescript
 * import { createECSuite } from "@marianmeres/ecsuite";
 *
 * const suite = createECSuite({
 *   context: { customerId: "user-123" },
 *   adapters: { cart: myCartAdapter },
 * });
 *
 * // Subscribe to cart state (Svelte-compatible)
 * suite.cart.subscribe((state) => {
 *   console.log(state.state, state.data);
 * });
 *
 * // Add item with optimistic update
 * await suite.cart.addItem({ product_id: "prod-1", quantity: 2 });
 * ```
 */

// Main exports
export { ECSuite, createECSuite, type ECSuiteConfig } from "./suite.ts";

// Types
export * from "./types/mod.ts";

// Domain managers (for advanced usage)
export * from "./domains/mod.ts";

// Adapters (including mock adapters for testing)
export * from "./adapters/mod.ts";
