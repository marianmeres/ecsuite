# CLAUDE.md

Quick context for Claude when working with this codebase.

## What is this?

`@marianmeres/ecsuite` is an e-commerce frontend UI helper library for Deno/npm. It provides state management for cart, wishlist, orders, customer, payment, and product domains with:

- **Optimistic updates** - UI updates immediately, rolls back on server error
- **Svelte-compatible stores** - All domains have `subscribe()` method
- **Adapter pattern** - Implement adapters to connect to your backend
- **Event system** - Pub/sub for domain events

## Quick Commands

```bash
deno test              # Run tests (93 tests)
deno task npm:build    # Build for npm
deno publish           # Publish to JSR
```

## Key Files

- `src/mod.ts` - Main entry point
- `src/suite.ts` - ECSuite orchestrator class
- `src/domains/base.ts` - BaseDomainManager abstract class
- `src/domains/*.ts` - Domain managers (cart, wishlist, order, customer, payment, product)
- `src/types/*.ts` - Type definitions
- `src/adapters/mock/*.ts` - Mock adapters for testing

## Architecture

```
ECSuite
├── CartManager      [localStorage, optimistic]
├── WishlistManager  [localStorage, optimistic]
├── OrderManager     [server-only]
├── CustomerManager  [server-only]
├── PaymentManager   [server-only, read-only]
└── ProductManager   [in-memory cache]
```

## State Machine

All domains (except ProductManager) follow:
```
initializing → ready ↔ syncing → error
```

## Common Tasks

**Add new domain**: Create manager in `src/domains/`, add adapter interface in `src/types/adapter.ts`, export from `mod.ts`

**Add new event**: Add to `ECSuiteEventType` and create interface in `src/types/events.ts`

**Test with mocks**: Use `createMock*Adapter()` with `storage: { type: "memory" }`

## Dependencies

- `@marianmeres/store` - Reactive stores with persistence
- `@marianmeres/pubsub` - Event system
- `@marianmeres/clog` - Logging
- `@marianmeres/collection-types` - Type definitions for e-commerce entities
