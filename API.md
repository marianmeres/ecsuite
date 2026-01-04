# @marianmeres/ecsuite API Reference

Complete API documentation for the e-commerce frontend UI helper library.

## Table of Contents

- [ECSuite](#ecsuite)
- [Domain Managers](#domain-managers)
  - [CartManager](#cartmanager)
  - [WishlistManager](#wishlistmanager)
  - [OrderManager](#ordermanager)
  - [CustomerManager](#customermanager)
  - [PaymentManager](#paymentmanager)
  - [ProductManager](#productmanager)
- [Adapter Interfaces](#adapter-interfaces)
- [Types](#types)
- [Events](#events)
- [Mock Adapters](#mock-adapters)

---

## ECSuite

Main orchestrator class that coordinates all domain managers.

### createECSuite(config?)

Factory function to create an ECSuite instance.

```typescript
function createECSuite(config?: ECSuiteConfig): ECSuite
```

### ECSuiteConfig

```typescript
interface ECSuiteConfig {
  /** Initial context (customerId, sessionId) */
  context?: DomainContext;
  /** Adapters for server communication */
  adapters?: {
    cart?: CartAdapter;
    wishlist?: WishlistAdapter;
    order?: OrderAdapter;
    customer?: CustomerAdapter;
    payment?: PaymentAdapter;
    product?: ProductAdapter;
  };
  /** Storage configuration */
  storage?: {
    /** Cart storage key (default: "ecsuite:cart") */
    cartKey?: string;
    /** Wishlist storage key (default: "ecsuite:wishlist") */
    wishlistKey?: string;
    /** Storage type for persisted domains (default: "local") */
    type?: StorageType;
  };
  /** Product cache TTL in milliseconds (default: 5 minutes) */
  productCacheTtl?: number;
  /** Auto-initialize on creation (default: true) */
  autoInitialize?: boolean;
}
```

### ECSuite Class

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `cart` | `CartManager` | Cart domain manager |
| `wishlist` | `WishlistManager` | Wishlist domain manager |
| `order` | `OrderManager` | Order domain manager |
| `customer` | `CustomerManager` | Customer domain manager |
| `payment` | `PaymentManager` | Payment domain manager |
| `product` | `ProductManager` | Product domain manager |

#### Methods

##### initialize()

Initialize all domains. Called automatically if `autoInitialize` is true.

```typescript
async initialize(): Promise<void>
```

##### setContext(context)

Update context across all domains.

```typescript
setContext(context: DomainContext): void
```

##### getContext()

Get the current context.

```typescript
getContext(): DomainContext
```

##### on(eventType, callback)

Subscribe to a specific event type.

```typescript
on(eventType: ECSuiteEventType, callback: Subscriber): Unsubscriber
```

##### onAny(callback)

Subscribe to all events.

```typescript
onAny(callback: (envelope: { event: string; data: ECSuiteEvent }) => void): Unsubscriber
```

##### once(eventType, callback)

Subscribe once to an event.

```typescript
once(eventType: ECSuiteEventType, callback: Subscriber): Unsubscriber
```

##### reset()

Reset all domains to initial state.

```typescript
reset(): void
```

---

## Domain Managers

All domain managers share a common interface:

- `subscribe(callback)` - Svelte-compatible store subscription
- `get()` - Get current state synchronously
- `setAdapter(adapter)` - Set the adapter
- `getAdapter()` - Get the adapter (may be null)
- `setContext(context)` - Update context
- `getContext()` - Get current context
- `initialize()` - Initialize the domain
- `reset()` - Reset to initial state

### State Wrapper

All domains wrap their data in `DomainStateWrapper<T>`:

```typescript
interface DomainStateWrapper<T> {
  state: DomainState;        // "initializing" | "ready" | "syncing" | "error"
  data: T | null;            // Domain data
  error: DomainError | null; // Error info when state is "error"
  lastSyncedAt: number | null; // Timestamp of last sync
}
```

---

### CartManager

Manages shopping cart with localStorage persistence and optimistic updates.

#### Constructor Options

```typescript
interface CartManagerOptions {
  adapter?: CartAdapter;
  storageKey?: string;      // default: "ecsuite:cart"
  storageType?: StorageType; // default: "local"
  context?: DomainContext;
  pubsub?: PubSub;
}
```

#### Methods

##### addItem(item)

Add item to cart. Increments quantity if product already exists.

```typescript
async addItem(item: CartItem): Promise<void>
```

**Emits:** `cart:item:added`

##### updateItemQuantity(productId, quantity)

Update item quantity. Removes item if quantity <= 0.

```typescript
async updateItemQuantity(productId: UUID, quantity: number): Promise<void>
```

**Emits:** `cart:item:updated`

##### removeItem(productId)

Remove item from cart.

```typescript
async removeItem(productId: UUID): Promise<void>
```

**Emits:** `cart:item:removed`

##### clear()

Clear all items from cart.

```typescript
async clear(): Promise<void>
```

**Emits:** `cart:cleared`

##### getItemCount()

Get total item count (sum of all quantities).

```typescript
getItemCount(): number
```

##### hasProduct(productId)

Check if product is in cart.

```typescript
hasProduct(productId: UUID): boolean
```

##### getItem(productId)

Get cart item by product ID.

```typescript
getItem(productId: UUID): CartItem | undefined
```

##### getEnrichedItems(productManager)

Get cart items with product data and line totals.

```typescript
async getEnrichedItems(productManager: ProductManager): Promise<EnrichedCartItem[]>
```

---

### WishlistManager

Manages wishlist with localStorage persistence and optimistic updates.

#### Constructor Options

```typescript
interface WishlistManagerOptions {
  adapter?: WishlistAdapter;
  storageKey?: string;      // default: "ecsuite:wishlist"
  storageType?: StorageType; // default: "local"
  context?: DomainContext;
  pubsub?: PubSub;
}
```

#### Methods

##### addItem(productId)

Add product to wishlist. No-op if already present.

```typescript
async addItem(productId: UUID): Promise<void>
```

**Emits:** `wishlist:item:added`

##### removeItem(productId)

Remove product from wishlist.

```typescript
async removeItem(productId: UUID): Promise<void>
```

**Emits:** `wishlist:item:removed`

##### toggleItem(productId)

Toggle product in wishlist. Returns true if added, false if removed.

```typescript
async toggleItem(productId: UUID): Promise<boolean>
```

##### clear()

Clear all items from wishlist.

```typescript
async clear(): Promise<void>
```

**Emits:** `wishlist:cleared`

##### getItemCount()

Get number of items in wishlist.

```typescript
getItemCount(): number
```

##### hasProduct(productId)

Check if product is in wishlist.

```typescript
hasProduct(productId: UUID): boolean
```

##### getItem(productId)

Get wishlist item by product ID.

```typescript
getItem(productId: UUID): WishlistItem | undefined
```

##### getProductIds()

Get all product IDs in wishlist.

```typescript
getProductIds(): UUID[]
```

##### getEnrichedItems(productManager)

Get wishlist items with product data.

```typescript
async getEnrichedItems(productManager: ProductManager): Promise<EnrichedWishlistItem[]>
```

---

### OrderManager

Manages orders with server-side data source (no local persistence).

#### Constructor Options

```typescript
interface OrderManagerOptions {
  adapter?: OrderAdapter;
  context?: DomainContext;
  pubsub?: PubSub;
}
```

#### Methods

##### fetchAll()

Fetch all orders from server.

```typescript
async fetchAll(): Promise<void>
```

**Emits:** `order:fetched`

##### fetchOne(orderId)

Fetch single order by ID.

```typescript
async fetchOne(orderId: UUID): Promise<OrderData | null>
```

##### create(orderData)

Create a new order.

```typescript
async create(orderData: OrderCreatePayload): Promise<OrderData | null>
```

**Emits:** `order:created`

##### getOrderCount()

Get total number of orders.

```typescript
getOrderCount(): number
```

##### getOrders()

Get all orders.

```typescript
getOrders(): OrderData[]
```

##### getOrderByIndex(index)

Get order by index.

```typescript
getOrderByIndex(index: number): OrderData | undefined
```

---

### CustomerManager

Manages customer profile with server-side data source.

#### Constructor Options

```typescript
interface CustomerManagerOptions {
  adapter?: CustomerAdapter;
  context?: DomainContext;
  pubsub?: PubSub;
}
```

#### Methods

##### refresh()

Refresh customer data from server.

```typescript
async refresh(): Promise<void>
```

**Emits:** `customer:fetched`

##### update(data)

Update customer data with optimistic update.

```typescript
async update(data: Partial<CustomerData>): Promise<void>
```

**Emits:** `customer:updated`

##### getEmail()

Get customer email.

```typescript
getEmail(): string | null
```

##### getName()

Get customer name.

```typescript
getName(): string | null
```

##### isGuest()

Check if customer is a guest.

```typescript
isGuest(): boolean
```

##### hasData()

Check if customer data is loaded.

```typescript
hasData(): boolean
```

---

### PaymentManager

Manages payment data with server-side source (read-only).

#### Constructor Options

```typescript
interface PaymentManagerOptions {
  adapter?: PaymentAdapter;
  context?: DomainContext;
  pubsub?: PubSub;
}
```

#### Methods

##### fetchForOrder(orderId)

Fetch payments for a specific order.

```typescript
async fetchForOrder(orderId: UUID): Promise<PaymentData[]>
```

**Emits:** `payment:fetched`

##### fetchOne(paymentId)

Fetch single payment by ID.

```typescript
async fetchOne(paymentId: UUID): Promise<PaymentData | null>
```

##### getPaymentCount()

Get number of fetched payments.

```typescript
getPaymentCount(): number
```

##### getPayments()

Get all fetched payments.

```typescript
getPayments(): PaymentData[]
```

##### getPaymentByRef(providerReference)

Get payment by provider reference.

```typescript
getPaymentByRef(providerReference: string): PaymentData | undefined
```

##### clearCache()

Clear local payment cache.

```typescript
clearCache(): void
```

---

### ProductManager

Manages product data with in-memory caching. Unlike other managers, uses a simple cache layer instead of state machine.

#### Constructor Options

```typescript
interface ProductManagerOptions {
  adapter?: ProductAdapter;
  context?: DomainContext;
  pubsub?: PubSub;
  cacheTtl?: number; // default: 5 minutes
}
```

#### Methods

##### getById(productId)

Get single product by ID. Returns from cache if valid.

```typescript
async getById(productId: UUID): Promise<ProductData | null>
```

**Emits:** `product:fetched` (on server fetch)

##### getByIds(productIds)

Get multiple products by IDs. Uses batch fetch for missing items.

```typescript
async getByIds(productIds: UUID[]): Promise<Map<UUID, ProductData>>
```

**Emits:** `product:fetched` (for each server fetch)

##### prefetch(productIds)

Prefetch products into cache.

```typescript
async prefetch(productIds: UUID[]): Promise<void>
```

##### isCached(productId)

Check if product is in cache and not expired.

```typescript
isCached(productId: UUID): boolean
```

##### getCacheSize()

Get number of cached products.

```typescript
getCacheSize(): number
```

##### clearCache(productId?)

Clear cache entirely or for specific product.

```typescript
clearCache(productId?: UUID): void
```

---

## Adapter Interfaces

### AdapterResult<T>

All adapter methods return this result type:

```typescript
interface AdapterResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
```

### CartAdapter

```typescript
interface CartAdapter {
  fetch(ctx: DomainContext): Promise<AdapterResult<CartData>>;
  addItem(item: CartItem, ctx: DomainContext): Promise<AdapterResult<CartData>>;
  updateItem(productId: UUID, quantity: number, ctx: DomainContext): Promise<AdapterResult<CartData>>;
  removeItem(productId: UUID, ctx: DomainContext): Promise<AdapterResult<CartData>>;
  clear(ctx: DomainContext): Promise<AdapterResult<CartData>>;
  sync(cart: CartData, ctx: DomainContext): Promise<AdapterResult<CartData>>;
}
```

### WishlistAdapter

```typescript
interface WishlistAdapter {
  fetch(ctx: DomainContext): Promise<AdapterResult<WishlistData>>;
  addItem(productId: UUID, ctx: DomainContext): Promise<AdapterResult<WishlistData>>;
  removeItem(productId: UUID, ctx: DomainContext): Promise<AdapterResult<WishlistData>>;
  clear(ctx: DomainContext): Promise<AdapterResult<WishlistData>>;
  sync(wishlist: WishlistData, ctx: DomainContext): Promise<AdapterResult<WishlistData>>;
}
```

### OrderAdapter

```typescript
interface OrderAdapter {
  fetchAll(ctx: DomainContext): Promise<AdapterResult<OrderData[]>>;
  fetchOne(orderId: UUID, ctx: DomainContext): Promise<AdapterResult<OrderData>>;
  create(order: OrderCreatePayload, ctx: DomainContext): Promise<AdapterResult<OrderData>>;
}
```

### CustomerAdapter

```typescript
interface CustomerAdapter {
  fetch(ctx: DomainContext): Promise<AdapterResult<CustomerData>>;
  update(data: Partial<CustomerData>, ctx: DomainContext): Promise<AdapterResult<CustomerData>>;
}
```

### PaymentAdapter

```typescript
interface PaymentAdapter {
  fetchForOrder(orderId: UUID, ctx: DomainContext): Promise<AdapterResult<PaymentData[]>>;
  fetchOne(paymentId: UUID, ctx: DomainContext): Promise<AdapterResult<PaymentData>>;
}
```

### ProductAdapter

```typescript
interface ProductAdapter {
  fetchOne(productId: UUID, ctx: DomainContext): Promise<AdapterResult<ProductData>>;
  fetchMany(productIds: UUID[], ctx: DomainContext): Promise<AdapterResult<ProductData[]>>;
}
```

---

## Types

### DomainState

```typescript
type DomainState = "initializing" | "ready" | "syncing" | "error";
```

### DomainContext

```typescript
interface DomainContext {
  customerId?: UUID;
  sessionId?: UUID;
}
```

### DomainError

```typescript
interface DomainError {
  code: string;
  message: string;
  operation: string;
  originalError?: unknown;
}
```

### StorageType

```typescript
type StorageType = "local" | "session" | "memory" | null;
```

### WishlistItem

```typescript
interface WishlistItem {
  product_id: UUID;
  added_at?: number;
}
```

### WishlistData

```typescript
interface WishlistData {
  items: WishlistItem[];
}
```

### EnrichedCartItem

```typescript
interface EnrichedCartItem extends CartItem {
  product: ProductData | null;
  lineTotal: number;
}
```

### EnrichedWishlistItem

```typescript
interface EnrichedWishlistItem extends WishlistItem {
  product: ProductData | null;
}
```

---

## Events

### Event Types

| Event | Description |
|-------|-------------|
| `domain:state:changed` | Domain state transitioned |
| `domain:error` | Domain operation failed |
| `domain:synced` | Domain successfully synced |
| `cart:item:added` | Cart item added |
| `cart:item:updated` | Cart item quantity updated |
| `cart:item:removed` | Cart item removed |
| `cart:cleared` | Cart cleared |
| `wishlist:item:added` | Wishlist item added |
| `wishlist:item:removed` | Wishlist item removed |
| `wishlist:cleared` | Wishlist cleared |
| `order:created` | Order created |
| `order:fetched` | Orders fetched |
| `customer:updated` | Customer updated |
| `customer:fetched` | Customer fetched |
| `payment:fetched` | Payments fetched |
| `product:fetched` | Product fetched |

### Event Interfaces

All events extend `ECSuiteEventBase`:

```typescript
interface ECSuiteEventBase {
  timestamp: number;
  domain: DomainName;
}
```

---

## Mock Adapters

Mock adapters are provided for testing:

```typescript
import {
  createMockCartAdapter,
  createMockWishlistAdapter,
  createMockOrderAdapter,
  createMockCustomerAdapter,
  createMockPaymentAdapter,
  createMockProductAdapter,
} from "@marianmeres/ecsuite";
```

### Mock Adapter Options

All mock adapters support:

```typescript
interface MockAdapterOptions {
  initialData?: T;        // Initial data
  delay?: number;         // Network delay in ms (default: 50)
  forceError?: {          // Force errors for testing
    operation?: string;
    code?: string;
    message?: string;
  };
}
```

### Example

```typescript
const suite = createECSuite({
  adapters: {
    cart: createMockCartAdapter({
      initialData: { items: [{ product_id: "p1", quantity: 2 }] },
      delay: 100,
    }),
  },
  storage: { type: "memory" },
});
```
