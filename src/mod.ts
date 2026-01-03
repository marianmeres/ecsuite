/**
 * @marianmeres/ecsuite
 *
 * E-commerce frontend UI helper library with optimistic updates,
 * Svelte-compatible stores, and adapter-based server sync.
 */

// Main exports
export { ECSuite, createECSuite, type ECSuiteConfig } from "./suite.ts";

// Types
export * from "./types/mod.ts";

// Domain managers (for advanced usage)
export * from "./domains/mod.ts";

// Adapters (including mock adapters for testing)
export * from "./adapters/mod.ts";
