# Ecsuite — Future Improvements

A design review of the current client-side data-flow model, with gaps to consider as usage grows. Not a commitment — a backlog for discussion.

Companion to `@marianmeres/ownsuite`'s `docs/future-improvements.md`. Both suites share `BaseDomainManager`, so most structural items transfer; this document highlights what applies, what doesn't, and what is ecsuite-specific.

## Context

Ecsuite is a **fixed-domain e-commerce state manager** (cart, wishlist, order, customer, payment, product). Unlike ownsuite's generic owner-scoped CRUD, each manager has domain-specific state shape, persistence, and operations. The design is intentionally closed — a known, curated set of domains — which makes "pluggability" a non-goal.

## Where the current design aligns with best practice

- Store-per-domain FSM exposed as a Svelte store.
- Optimistic updates with rollback on cart/wishlist/customer.
- Optimistic `create` for cart items with client-assigned temp id, swapped on server response (correct pattern).
- `localStorage` persistence for cart/wishlist survives reload without a round-trip.
- ProductManager uses a TTL cache to avoid redundant fetches.
- Transport-agnostic adapter boundary per domain; full mock coverage for tests.
- Typed pubsub event bus scoped per domain (`cart:*`, `order:*`, etc.).

## Gaps inherited from the shared base

### 1. No request deduplication or in-flight cancellation

Any domain's `refresh()` can be called twice quickly (route remount, focus event) and produce parallel fetches with a last-write-wins race.

**Possible direction:** track an in-flight promise per operation key; coalesce concurrent callers.

### 2. No `AbortSignal` plumbing through adapters

Component unmount cannot cancel in-flight fetches; results land in a detached store and may overwrite fresher data.

**Possible direction:** thread `AbortSignal` through adapter method signatures; abort on supersession and disposal.

### 3. No staleness / revalidation policy (except ProductManager)

`lastSyncedAt` is tracked but unused on cart/order/customer/payment. No focus/reconnect refetch, no cross-tab sync. ProductManager's TTL is a one-off — no shared cache primitive.

**Possible direction:** lift ProductManager's TTL approach into a reusable base-level option; add optional focus/reconnect listeners behind a flag.

### 4. No per-row pending state during optimistic updates — **acute here**

More important in ecsuite than ownsuite: cart UIs routinely need "this line item is updating" spinners. Currently, modifying one cart item flips the whole cart to `syncing`, so consumers can't show a per-line spinner without their own bookkeeping.

**Possible direction:** track pending item ids in state; expose as a `Set<itemId>` alongside `items`.

### 5. Error state couples to data availability

One failed `update` puts the whole domain in `error`, even though `data` is still valid. Consumers must remember to ignore `state === "error"` when `data` exists.

**Possible direction:** decouple — keep `state` at `ready`, surface the last error as a sibling signal (`lastError`).

### 6. `initialize()` swallows errors

Silent boot failure unless you subscribe to `*:error` events.

**Possible direction:** add `suite.hasErrors()` / `suite.getErrors()` helpers.

### 7. Whole-list rollback snapshot

Less critical than in ownsuite — carts/wishlists are small. Flag for later.

## Gaps that apply to specific domains only

### 8. Query-keyed cache — OrderManager (and partly ProductManager)

Order history is naturally filtered/paginated (status, date range). A single `orders` slot can't hold multiple views concurrently. Cart/wishlist/customer/payment are session-singletons and don't need this.

**Possible direction:** upgrade OrderManager to a `queries: Map<queryKey, {...}>` shape; leave singleton managers alone.

### 9. Pagination / infinite-scroll primitives — OrderManager, ProductManager

`meta` is opaque; cursor/offset merging is consumer-implemented. Needed for order history and product listings.

**Possible direction:** first-class `loadMore()` on those managers with a pluggable merge strategy.

## Ecsuite-specific concerns (no ownsuite analogue)

### 10. localStorage persistence — multiple latent issues

- **No cross-tab sync.** Two tabs mutating the cart diverge until one wins on reload. A `storage` event listener would mirror changes.
- **No schema versioning / migration.** If cart item shape changes between releases, old persisted carts will either crash deserialization or silently corrupt state. A `version` field + migration hook is standard.
- **No encryption or redaction.** Carts can contain semi-sensitive data (product ids a user browses privately, promo codes). Probably acceptable for e-commerce norms, but worth an explicit decision.
- **No quota handling.** `localStorage.setItem` can throw on quota-exceeded; currently unhandled.

### 11. Temp-id → real-id swap on optimistic cart `create`

Known-hazardous pattern. Risks:

- Events fired with the temp id before swap — subscribers caching by id see a ghost.
- Subsequent `update`/`delete` called on a temp id while the server response is in flight — needs either queuing or id remapping.
- External references (URLs, analytics) captured against a temp id become stale.

**Possible direction:** document the swap contract explicitly; consider buffering mutations until the real id arrives; emit a dedicated `cart:item:id-reconciled` event so subscribers can rekey.

### 12. ProductManager TTL cache is a one-off

Useful, but not reusable. CustomerManager and OrderManager could benefit from the same primitive. See #3.

## Items that do NOT apply

- **Pluggable manager types** — ecsuite is intentionally closed (fixed 6 domains). This is a design contract, not a flaw. (Applies to ownsuite only.)

## Prioritization sketch

Rough order if tackled:

1. **#4 per-row pending on CartManager** — highest user-visible value; UIs want it now.
2. **#2 AbortSignal** — cheap correctness win.
3. **#1 dedup** — cheap, removes a class of races.
4. **#5 decouple error from state** — small API change, big DX win.
5. **#10 localStorage cross-tab sync + versioning** — bite-sized, prevents real bugs.
6. **#11 temp-id swap hardening** — audit existing code; document or fix concretely.
7. **#3 shared TTL/staleness primitive** — lift from ProductManager.
8. **#8 + #9 query cache & pagination for OrderManager** — defer until a concrete consumer needs it; design together.
9. Remaining items — opportunistic.
