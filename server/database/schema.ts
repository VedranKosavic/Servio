/**
 * The database, as TypeScript. `drizzle-kit generate` turns this file into a
 * .sql migration in `migrations/`; that file is committed and replayed by
 * `drizzle-kit migrate`. The schema here is the source of truth for the shape;
 * the migrations are the source of truth for what a live database has already
 * been through.
 *
 * House rules (PLAN.md §6), enforced by hand because SQLite cannot enforce them:
 *   - `id` is a TEXT uuid.
 *   - every business table carries `venue_id`; a second café is an insert.
 *   - money is INTEGER feninga in `*_fen` columns; quantities are REAL in the
 *     item's own base unit (kom / g / ml).
 *   - timestamps are ISO-8601 UTC strings written by the server, never by a phone.
 *   - rows born on a phone carry a `client_id` uuid with UNIQUE(venue_id, client_id),
 *     so replaying the same request twice cannot create two rows.
 *
 * This is the "Korak 1" subset: venue, people, catalog, orders, stock. Shifts,
 * cash, chat, roster and the log come in later phases.
 */
import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------------------
// Venue & people
// ---------------------------------------------------------------------------

export const venues = sqliteTable('venues', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('venues_slug_uq').on(t.slug)])

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  name: text('name').notNull(),
  /** "AM", "LJ" — what fits on an avatar circle. */
  initials: text('initials').notNull(),
  role: text('role', { enum: ['waiter', 'bartender', 'owner'] }).notNull(),
  /** SQLite has no boolean: 1 / 0. */
  active: integer('active').notNull().default(1),
}, t => [index('users_venue_idx').on(t.venueId)])

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * `col` / `row` place the table on its zone's bird's-eye schematic — the floor
 * plan the waiter taps, not a list. `grp='vip'` is the VIP box inside Unutra.
 */
export const tables = sqliteTable('tables', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  name: text('name').notNull(),
  zone: text('zone', { enum: ['unutra', 'basta'] }).notNull(),
  col: integer('col').notNull(),
  row: integer('row').notNull(),
  grp: text('grp'),
  sort: integer('sort').notNull().default(0),
  active: integer('active').notNull().default(1),
}, t => [index('tables_venue_zone_idx').on(t.venueId, t.zone, t.sort)])

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
}, t => [index('categories_venue_idx').on(t.venueId, t.sort)])

/**
 * A `product` is what the waiter taps. A `stock_item` is what sits on the shelf.
 * The two are connected either 1:1 (`sells_stock_item_id`, most of the menu) or
 * through `recipe_lines` (kafa = 7 g kafa + 5 g šećer).
 *
 * `kind='shisha'` products resolve their stock at order time instead: their
 * `shisha_grams` are split across the flavours the guest chose, and `coal_pcs`
 * come off the coal item.
 */
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  categoryId: text('category_id').notNull().references(() => categories.id),
  name: text('name').notNull(),
  priceFen: integer('price_fen').notNull(),
  kind: text('kind', { enum: ['simple', 'shisha'] }).notNull().default('simple'),
  sellsStockItemId: text('sells_stock_item_id').references(() => stockItems.id),
  shishaGrams: real('shisha_grams'),
  coalPcs: integer('coal_pcs'),
  isFavourite: integer('is_favourite').notNull().default(0),
  sort: integer('sort').notNull().default(0),
  active: integer('active').notNull().default(1),
}, t => [index('products_venue_cat_idx').on(t.venueId, t.categoryId, t.sort)])

export const stockItems = sqliteTable('stock_items', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['pice', 'duhan', 'zar', 'potrosni'] }).notNull(),
  baseUnit: text('base_unit', { enum: ['kom', 'g', 'ml'] }).notNull(),
  /** "gajba", "tin", "kutija" — how it arrives; `pack_qty` converts to base units. */
  packName: text('pack_name'),
  packQty: real('pack_qty'),
  /** On the spot-count list (the ~20 items counted at every close). */
  isSpot: integer('is_spot').notNull().default(0),
  active: integer('active').notNull().default(1),
}, t => [index('stock_items_venue_idx').on(t.venueId, t.kind, t.name)])

/** The normativ: how much of a stock item one unit of a product consumes. */
export const recipeLines = sqliteTable('recipe_lines', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  productId: text('product_id').notNull().references(() => products.id),
  stockItemId: text('stock_item_id').notNull().references(() => stockItems.id),
  qty: real('qty').notNull(),
}, t => [index('recipe_lines_product_idx').on(t.venueId, t.productId)])

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * A tab (*tura* upon *tura* on one table) is open from the first order until it
 * is paid. The partial unique index below is the rule "one open tab per table",
 * enforced by the database rather than by a race-prone SELECT-then-INSERT.
 */
export const tabs = sqliteTable('tabs', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  tableId: text('table_id').notNull().references(() => tables.id),
  clientId: text('client_id').notNull(),
  status: text('status', { enum: ['open', 'paid'] }).notNull().default('open'),
  openedBy: text('opened_by').notNull().references(() => users.id),
  openedAt: text('opened_at').notNull(),
  closedAt: text('closed_at'),
  closedBy: text('closed_by').references(() => users.id),
}, t => [
  uniqueIndex('tabs_client_uq').on(t.venueId, t.clientId),
  uniqueIndex('tabs_one_open_per_table_uq')
    .on(t.venueId, t.tableId)
    .where(sql`status = 'open'`),
  index('tabs_venue_status_idx').on(t.venueId, t.status),
])

/**
 * One locked round. Append-only apart from the single `prepared_at` /
 * `prepared_by` transition the bartender's ticket screen writes — a trigger in
 * `triggers.sql` enforces exactly that and nothing else.
 */
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  tabId: text('tab_id').notNull().references(() => tabs.id),
  clientId: text('client_id').notNull(),
  lockedBy: text('locked_by').notNull().references(() => users.id),
  note: text('note'),
  createdAt: text('created_at').notNull(),
  preparedAt: text('prepared_at'),
  preparedBy: text('prepared_by').references(() => users.id),
}, t => [
  uniqueIndex('orders_client_uq').on(t.venueId, t.clientId),
  index('orders_tab_idx').on(t.venueId, t.tabId),
  index('orders_prep_idx').on(t.venueId, t.preparedAt, t.createdAt),
])

/**
 * `name_snapshot` and `unit_price_fen` are copied from the product at the moment
 * the round is locked. Editing a price tomorrow must not change what a guest was
 * charged tonight, and the phone never sends either number.
 *
 * `flavours_json` holds stock item **ids** (`["uuid","uuid"]`), never names —
 * names are joined at read time, so renaming an aroma does not rewrite history.
 */
export const orderLines = sqliteTable('order_lines', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  orderId: text('order_id').notNull().references(() => orders.id),
  productId: text('product_id').notNull().references(() => products.id),
  nameSnapshot: text('name_snapshot').notNull(),
  qty: real('qty').notNull(),
  unitPriceFen: integer('unit_price_fen').notNull(),
  chargedFen: integer('charged_fen').notNull(),
  flavoursJson: text('flavours_json'),
  note: text('note'),
}, t => [index('order_lines_order_idx').on(t.venueId, t.orderId)])

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

/**
 * The only stock truth. On hand is always `SUM(qty_delta)` for the item — a
 * running balance column is never stored, because a balance can be wrong and a
 * ledger cannot: every number on every stock screen is re-derived from these
 * rows, so a bug shows up as a wrong sum and not as a corrupted stock level.
 *
 * `qty_delta` is signed: a sale is negative, a delivery positive.
 * `ref_type` / `ref_id` point back at what caused it ('order_line' + line id).
 */
export const stockMovements = sqliteTable('stock_movements', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  stockItemId: text('stock_item_id').notNull().references(() => stockItems.id),
  type: text('type', { enum: ['opening', 'delivery', 'sale', 'correction'] }).notNull(),
  qtyDelta: real('qty_delta').notNull(),
  refType: text('ref_type'),
  refId: text('ref_id'),
  userId: text('user_id').references(() => users.id),
  note: text('note'),
  /** When it happened in the venue's world. */
  occurredAt: text('occurred_at').notNull(),
  /** When the row reached the database. The two differ for a late sync. */
  createdAt: text('created_at').notNull(),
}, t => [
  index('stock_movements_item_idx').on(t.venueId, t.stockItemId, t.occurredAt),
  index('stock_movements_ref_idx').on(t.refType, t.refId),
])
