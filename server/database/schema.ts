/**
 * The database, as TypeScript. `drizzle-kit generate` turns this file into a
 * .sql migration in `migrations/`; that file is committed and replayed by
 * `drizzle-kit migrate`. The schema here is the source of truth for the shape;
 * the migrations are the source of truth for what a live database has already
 * been through.
 *
 * House rules (docs/BACKEND.md §2), enforced by hand because SQLite cannot:
 *   - `id` is a TEXT uuid.
 *   - every business table carries `venue_id`; a second café is an insert.
 *   - money is INTEGER feninga in `*_fen`; **per-unit costs** are INTEGER
 *     milli-feninga in `*_mfen`, because 30 KM per 700 ml is 4.286 mfen/ml and
 *     rounding that to 4 fen/ml loses 2,20 KM on one bottle.
 *   - quantities are REAL in the item's own base unit (kom / g / ml).
 *   - timestamps are ISO-8601 UTC strings written by the server. Exactly three
 *     arrive in a body (`client_created_at`, `delivered_at`, `occurred_at`) and
 *     all three are clamped by `clampEventAt` before they touch a column.
 *   - rows born on a phone carry a `client_id` uuid with UNIQUE(venue_id, client_id),
 *     so replaying the same request twice cannot create two rows.
 *
 * A word on the two migration rules this file is written around (BACKEND §2):
 *
 *   1. A column added to an existing table that carries REFERENCES must be
 *      **nullable with no default**. Under `foreign_keys = ON` — which
 *      `openDatabase()` sets before migrating — SQLite refuses
 *      `ADD COLUMN … NOT NULL DEFAULT '' REFERENCES users(id)`. Such a column is
 *      backfilled by an UPDATE in the same migration and made mandatory by a
 *      `BEFORE INSERT` trigger instead (see `tabs.assigned_to`, `orders.shift_id`).
 *   2. Korak 2 never changes an existing column's type or nullability, because
 *      drizzle-kit answers that by rebuilding the table (copy into `__new_x`,
 *      drop, rename) — which drops every trigger mid-migration and fights the
 *      foreign keys. `tests/unit/migration.test.ts` greps for `__new_`.
 *
 * Widening a text enum below is free: in SQLite a Drizzle text enum is plain
 * TEXT with no CHECK constraint, so `role` gaining 'admin' or `stock_movements.type`
 * gaining six members changes the TypeScript and nothing in the DDL.
 */
import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------------------
// Venue & people
// ---------------------------------------------------------------------------

export const venues = sqliteTable('venues', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  /**
   * The venue's overrides of `DEFAULT_SETTINGS` (`shared/settings.ts`), as JSON.
   * No service parses this itself: `getSettings()` merges it over the defaults,
   * so a key the owner never touched always reads as the documented default.
   */
  settingsJson: text('settings_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('venues_slug_uq').on(t.slug)])

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  name: text('name').notNull(),
  /** "AM", "LJ" — what fits on an avatar circle. */
  initials: text('initials').notNull(),
  /**
   * Three roles and no more. Korak 1's `'owner'` is renamed to `'admin'` by the
   * Korak 2 migration; the *paths* that name the owner dashboard keep the word
   * (`/api/owner/live`), the role value never does.
   */
  role: text('role', { enum: ['admin', 'waiter', 'bartender'] }).notNull(),
  /** SQLite has no boolean: 1 / 0. */
  active: integer('active').notNull().default(1),
  /** `scrypt$N$r$p$<salt hex>$<hash hex>`; NULL = this person cannot log in. */
  pinHash: text('pin_hash'),
  /** 4 or 6. Zod enforces the range; no trigger, no CHECK. */
  pinLen: integer('pin_len').notNull().default(4),
  pinSetAt: text('pin_set_at'),
  /**
   * Which `PIN_PEPPER` the stored hash was made with. A pepper is a secret that
   * lives only in `/opt/sank/.env`, mixed into the hash input — so a stolen
   * database file is not every 4-digit PIN in the venue. Rotating it means
   * bumping this and re-hashing at the next successful login (§5.3).
   */
  pinPepperV: integer('pin_pepper_v').notNull().default(1),
  /** Admins only: email + password is the one way into `/a` on a laptop. */
  passwordHash: text('password_hash'),
  /** Lowercase, trimmed. */
  email: text('email'),
  /** The Dnevnik badge: everything after this is "new". */
  logSeenAt: text('log_seen_at'),
  createdAt: text('created_at').notNull().default(''),
}, t => [
  index('users_venue_idx').on(t.venueId),
  // An email identifies a person before any venue is known, so this unique is
  // global on purpose (`GLOBAL_UNIQUE_INDEXES`). Partial, because staff without
  // a laptop login have no email and NULLs must not collide.
  uniqueIndex('users_email_uq').on(t.email).where(sql`email IS NOT NULL`),
])

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
  /** What the category *is*, for the reports: piće, hrana, nargila, ostalo. */
  kind: text('kind', { enum: ['pice', 'hrana', 'nargila', 'ostalo'] }).notNull().default('ostalo'),
  /** JSON array of the quick note chips this category offers ("bez šećera"). */
  noteChipsJson: text('note_chips_json').notNull().default('[]'),
  sort: integer('sort').notNull().default(0),
  active: integer('active').notNull().default(1),
}, t => [index('categories_venue_idx').on(t.venueId, t.sort)])

/**
 * A `product` is what the waiter taps. A `stock_item` is what sits on the shelf.
 * The two are connected either 1:1 (`sells_stock_item_id`, most of the menu) or
 * through `recipe_lines` (kafa = 7 g kafa + 5 g šećer).
 *
 * `kind='shisha'` products resolve their stock at order time instead: their
 * `shisha_grams` are split across the flavours the guest chose, and `coal_pcs`
 * come off the coal item. (`free_text` is Korak 3.)
 */
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  categoryId: text('category_id').notNull().references(() => categories.id),
  name: text('name').notNull(),
  /** What fits on a tile when `name` does not. */
  shortName: text('short_name'),
  /** Space-separated extra words the search box matches ("cola kola"). */
  searchAliases: text('search_aliases').notNull().default(''),
  priceFen: integer('price_fen').notNull(),
  kind: text('kind', { enum: ['simple', 'shisha'] }).notNull().default('simple'),
  sellsStockItemId: text('sells_stock_item_id').references(() => stockItems.id),
  shishaGrams: real('shisha_grams'),
  /** When the owner last weighed a bowl of this, so `grams_per_bowl` is honest. */
  shishaGramsMeasuredAt: text('shisha_grams_measured_at'),
  coalPcs: integer('coal_pcs'),
  /** May a waiter take this as one of his `staff_drinks_per_shift`? */
  staffDrinkAllowed: integer('staff_drink_allowed').notNull().default(0),
  isFavourite: integer('is_favourite').notNull().default(0),
  /**
   * What a *phone* is allowed to recognise a product by (PHASE3 §1.10).
   *
   * `'zar'` is *Dodatni žar* and `'ostalo'` is the fixed-price catch-all; both
   * get UI behaviour of their own, and matching that behaviour on a name is how
   * a rename becomes a Saturday-night bug. NULL for everything else, which is
   * why the unique index below is **partial**: a partial index only indexes the
   * rows its WHERE matches, so a hundred products with no system key are not a
   * hundred collisions on NULL.
   */
  systemKey: text('system_key', { enum: ['zar', 'ostalo'] }),
  sort: integer('sort').notNull().default(0),
  active: integer('active').notNull().default(1),
  createdAt: text('created_at').notNull().default(''),
  updatedAt: text('updated_at'),
}, t => [
  index('products_venue_cat_idx').on(t.venueId, t.categoryId, t.sort),
  uniqueIndex('products_system_key_uq')
    .on(t.venueId, t.systemKey)
    .where(sql`system_key IS NOT NULL`),
])

/**
 * Costs live here in **milli-feninga per base unit**, and there are two of them:
 * `avg_cost_mfen` is the moving average every delivery re-computes (what stock
 * on the shelf is worth), `last_cost_mfen` is what the last invoice charged.
 * Readers go through `unitCost(item)` = `avg || last || 0` and flag anything
 * priced by the fallback as *procijenjeno* — a zero cost silently switches off
 * variance, waste value and *utrošak*, so it is never assumed, only reported.
 */
export const stockItems = sqliteTable('stock_items', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['pice', 'duhan', 'zar', 'potrosni', 'hrana'] }).notNull(),
  baseUnit: text('base_unit', { enum: ['kom', 'g', 'ml'] }).notNull(),
  /** For the *Roba* report: which menu category this item belongs under. */
  categoryId: text('category_id').references(() => categories.id),
  brand: text('brand'),
  /** "gajba", "tin", "kutija" — how it arrives; `pack_qty` converts to base units. */
  packName: text('pack_name'),
  packQty: real('pack_qty'),
  avgCostMfen: integer('avg_cost_mfen').notNull().default(0),
  lastCostMfen: integer('last_cost_mfen').notNull().default(0),
  /** `weigh` items are counted on a scale; `tare_g` is the empty tin. */
  countMethod: text('count_method', { enum: ['count', 'weigh'] }).notNull().default('count'),
  tareG: real('tare_g'),
  /** How far a count may miss before it is a variance worth a note. */
  toleranceQty: real('tolerance_qty').notNull().default(0),
  /** The "order more" level. `stock_below_par` alerts are Korak 3. */
  parQty: real('par_qty'),
  /** On the spot-count list (the ~20 items counted at every close). */
  isSpot: integer('is_spot').notNull().default(0),
  /** Temporarily out ("nema u dostavi") without deactivating the item. */
  available: integer('available').notNull().default(1),
  active: integer('active').notNull().default(1),
}, t => [
  index('stock_items_venue_idx').on(t.venueId, t.kind, t.name),
  index('stock_items_category_idx').on(t.venueId, t.categoryId),
])

/** The normativ: how much of a stock item one unit of a product consumes. */
export const recipeLines = sqliteTable('recipe_lines', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  productId: text('product_id').notNull().references(() => products.id),
  stockItemId: text('stock_item_id').notNull().references(() => stockItems.id),
  qty: real('qty').notNull(),
}, t => [index('recipe_lines_product_idx').on(t.venueId, t.productId)])

/**
 * Every price a product has ever had, one open row (`valid_to IS NULL`) at a
 * time. The partial unique index is what makes "open" mean exactly one row.
 */
export const priceHistory = sqliteTable('price_history', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  productId: text('product_id').notNull().references(() => products.id),
  priceFen: integer('price_fen').notNull(),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to'),
  changedBy: text('changed_by'),
}, t => [
  uniqueIndex('price_history_open_uq')
    .on(t.venueId, t.productId)
    .where(sql`valid_to IS NULL`),
  index('price_history_product_idx').on(t.venueId, t.productId, t.validFrom),
])

// ---------------------------------------------------------------------------
// Devices, sessions, auth
// ---------------------------------------------------------------------------

/**
 * A phone or tablet that has been enrolled once and carries a `sank_d` cookie
 * ever after. Only the sha256 of the token is stored: the raw token exists in
 * the cookie and nowhere else, so the database file is not a set of keys.
 *
 * `mode='personal'` is somebody's own phone (`bound_user_id`); `'shared'` is the
 * bar tablet anyone may PIN into.
 */
export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  label: text('label').notNull(),
  tokenHash: text('token_hash').notNull(),
  mode: text('mode', { enum: ['personal', 'shared'] }).notNull(),
  boundUserId: text('bound_user_id').references(() => users.id),
  enrolledAt: text('enrolled_at').notNull(),
  enrolledBy: text('enrolled_by'),
  revokedAt: text('revoked_at'),
  revokedBy: text('revoked_by'),
  /** Set by the 15th consecutive failed PIN; cleared by a reset or an unlock. */
  lockedAt: text('locked_at'),
  lastSeenAt: text('last_seen_at'),
  appVersion: text('app_version'),
  standalone: integer('standalone'),
  /** What the last heartbeat said was still queued in the phone's outbox. */
  pendingCount: integer('pending_count').notNull().default(0),
  oldestPendingAt: text('oldest_pending_at'),
  /** device clock − server clock, in seconds, from the heartbeat. */
  clockSkewS: integer('clock_skew_s').notNull().default(0),
}, t => [
  // Global: a bare cookie token is looked up before we know which venue it is.
  uniqueIndex('devices_token_uq').on(t.tokenHash),
  index('devices_venue_idx').on(t.venueId, t.revokedAt),
  index('devices_bound_idx').on(t.venueId, t.boundUserId),
])

/** A 6-character code an admin mints in `/a` so a phone can enrol itself. */
export const enrolCodes = sqliteTable('enrol_codes', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  code: text('code').notNull(),
  mode: text('mode', { enum: ['personal', 'shared'] }).notNull(),
  boundUserId: text('bound_user_id'),
  label: text('label').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  usesLeft: integer('uses_left').notNull().default(2),
}, t => [
  // Global: the phone has no venue yet when it posts the code.
  uniqueIndex('enrol_codes_code_uq').on(t.code),
  index('enrol_codes_venue_idx').on(t.venueId, t.expiresAt),
])

/**
 * A login. Not a ledger — the nightly task deletes rows expired over 30 days,
 * which is why this table has no append-only trigger (see triggers.sql).
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  userId: text('user_id').notNull().references(() => users.id),
  /** NULL for an admin email+password session, which has no device. */
  deviceId: text('device_id').references(() => devices.id),
  tokenHash: text('token_hash').notNull(),
  kind: text('kind', { enum: ['admin', 'staff'] }).notNull(),
  /** 1 when somebody PIN'd into a colleague's personal phone: 2 h, not 14 h. */
  borrowed: integer('borrowed').notNull().default(0),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at'),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
  ip: text('ip'),
  userAgent: text('user_agent'),
}, t => [
  uniqueIndex('sessions_token_uq').on(t.tokenHash),
  index('sessions_user_idx').on(t.venueId, t.userId, t.expiresAt),
  index('sessions_device_idx').on(t.deviceId),
])

/**
 * Append-only lockout evidence — every PIN, password and enrol-code attempt,
 * good or bad. It is a separate table and not a column because a failed attempt
 * written *inside* the transaction that then throws would be rolled back, and a
 * lockout that counts nothing is not a lockout (§5.2).
 */
export const authAttempts = sqliteTable('auth_attempts', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  deviceId: text('device_id'),
  userId: text('user_id'),
  ip: text('ip').notNull(),
  kind: text('kind', { enum: ['pin', 'password', 'enrol', 'approve', 'reset'] }).notNull(),
  ok: integer('ok').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [
  index('auth_attempts_subject_idx').on(t.venueId, t.deviceId, t.userId, t.createdAt),
])

// ---------------------------------------------------------------------------
// Shifts and cash
// ---------------------------------------------------------------------------

/**
 * A night. Opened by the first lock of the evening (`auto_opened = 1`) and
 * closed by the *Završi smjenu* flow. `business_date` is the date the night
 * belongs to, not the calendar date: the business day starts at 06:00
 * Europe/Sarajevo, so 02:30 on the 9th is still the 8th's shift.
 */
export const shifts = sqliteTable('shifts', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  businessDate: text('business_date').notNull(),
  openedAt: text('opened_at').notNull(),
  openedBy: text('opened_by').notNull(),
  autoOpened: integer('auto_opened').notNull().default(0),
  /** Who is responsible for the stock this shift (counts, deliveries). */
  stockCustodianId: text('stock_custodian_id'),
  status: text('status', { enum: ['open', 'closing', 'closed', 'reviewed'] }).notNull().default('open'),
  closingStartedAt: text('closing_started_at'),
  closingStartedBy: text('closing_started_by'),
  closedAt: text('closed_at'),
  closedBy: text('closed_by'),
  closedKind: text('closed_kind', { enum: ['normal', 'forced'] }),
  /** An admin's correction of the float derived from the previous close. */
  openingFloatOverrideFen: integer('opening_float_override_fen'),
  cashCountedFen: integer('cash_counted_fen'),
  cardTotalFen: integer('card_total_fen'),
  closingNote: text('closing_note'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: text('reviewed_at'),
  createdAt: text('created_at').notNull(),
}, t => [
  // One open shift per venue, enforced by the database rather than by a
  // race-prone SELECT-then-INSERT. `closing` counts as open: the shift is still
  // taking money while the settlements come in.
  uniqueIndex('shifts_one_open_uq')
    .on(t.venueId)
    .where(sql`status IN ('open','closing')`),
  index('shifts_venue_date_idx').on(t.venueId, t.businessDate, t.openedAt),
])

/**
 * Who worked the shift. `role` is a snapshot, so a bartender promoted next month
 * keeps his old shifts' lines. `left_at` may be set exactly once — a logout is
 * not a leave (§5.1), or Emir handing the tablet to Haris would end his hours.
 */
export const shiftMembers = sqliteTable('shift_members', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  shiftId: text('shift_id').notNull().references(() => shifts.id),
  userId: text('user_id').notNull().references(() => users.id),
  role: text('role', { enum: ['admin', 'waiter', 'bartender'] }).notNull(),
  joinedAt: text('joined_at').notNull(),
  leftAt: text('left_at'),
  leftAtSource: text('left_at_source', { enum: ['manual', 'auto'] }),
}, t => [
  uniqueIndex('shift_members_uq').on(t.venueId, t.shiftId, t.userId),
])

/**
 * Cash that moved without a guest: the opening float in, a float handed to a
 * waiter, a payout to a supplier, the owner taking the pazar, a refund.
 *
 * `amount_fen` is always positive — the `type` carries the sign. `user_id` is
 * whose money it is (the waiter receiving a `float_out`, the requester of a
 * `payout`); `created_by` is who wrote the row. `payout` and `float_out` are
 * born `pending`: a cash obligation needs the receiver's acknowledgement, or a
 * bartender could move his own shortfall onto a colleague.
 */
export const cashMovements = sqliteTable('cash_movements', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  shiftId: text('shift_id').notNull().references(() => shifts.id),
  type: text('type', { enum: ['float_in', 'float_out', 'payout', 'owner_pickup', 'refund'] }).notNull(),
  amountFen: integer('amount_fen').notNull(),
  userId: text('user_id').notNull(),
  createdBy: text('created_by').notNull(),
  reason: text('reason'),
  note: text('note'),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull(),
  decidedBy: text('decided_by'),
  decidedAt: text('decided_at'),
  refType: text('ref_type'),
  refId: text('ref_id'),
  createdAt: text('created_at').notNull(),
}, t => [
  index('cash_movements_shift_idx').on(t.venueId, t.shiftId, t.type, t.status),
])

/**
 * *Završi smjenu*, the blind declaration: the waiter types what he is handing
 * over **before** the server tells him what it expected. `expected_at_declare_fen`
 * is what the ledger said at that moment, kept so the comparison can be re-read
 * months later even after a late void moves the live number.
 */
export const waiterSettlements = sqliteTable('waiter_settlements', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  shiftId: text('shift_id').notNull().references(() => shifts.id),
  userId: text('user_id').notNull().references(() => users.id),
  declaredFen: integer('declared_fen').notNull(),
  expectedAtDeclareFen: integer('expected_at_declare_fen').notNull(),
  breakdownJson: text('breakdown_json').notNull(),
  summaryJson: text('summary_json').notNull(),
  acceptedBy: text('accepted_by'),
  acceptedAt: text('accepted_at'),
  /** Nobody was there to take it: the waiter sealed his own envelope. */
  selfSealed: integer('self_sealed').notNull().default(0),
  /** What the phone claimed was still unsent at settle — evidence, not truth. */
  unsentReportedJson: text('unsent_reported_json').notNull().default('{}'),
  deviceId: text('device_id'),
  /** 1 when the settlement arrived after the shift was already closed. */
  late: integer('late').notNull().default(0),
  createdAt: text('created_at').notNull(),
}, t => [
  // One settlement per person per shift; a correction is Korak 3.
  uniqueIndex('waiter_settlements_uq').on(t.venueId, t.shiftId, t.userId),
])

/**
 * The shift's numbers, versioned. A new version is written at close, at every
 * later decision that moves money, and when a late round attaches — never
 * updated in place, so "what did the summary say when we closed?" is a row and
 * not a reconstruction. Purely numeric JSON: names are joined at read.
 */
export const shiftSummaries = sqliteTable('shift_summaries', {
  shiftId: text('shift_id').notNull().references(() => shifts.id),
  venueId: text('venue_id').notNull().references(() => venues.id),
  version: integer('version').notNull(),
  reason: text('reason', { enum: ['close', 'decision', 'late'] }).notNull(),
  prometFen: integer('promet_fen').notNull().default(0),
  cashFen: integer('cash_fen').notNull().default(0),
  cardFen: integer('card_fen').notNull().default(0),
  compFen: integer('comp_fen').notNull().default(0),
  voidCount: integer('void_count').notNull().default(0),
  voidFen: integer('void_fen').notNull().default(0),
  selfVoidCount: integer('self_void_count').notNull().default(0),
  selfVoidFen: integer('self_void_fen').notNull().default(0),
  unpaidFen: integer('unpaid_fen').notNull().default(0),
  expectedCashFen: integer('expected_cash_fen').notNull().default(0),
  /** What waiters who had not settled yet were still holding. */
  outstandingFen: integer('outstanding_fen').notNull().default(0),
  countedCashFen: integer('counted_cash_fen'),
  diffFen: integer('diff_fen'),
  stockVarianceFen: integer('stock_variance_fen').notNull().default(0),
  wasteFen: integer('waste_fen').notNull().default(0),
  bowls: integer('bowls').notNull().default(0),
  tobaccoG: real('tobacco_g').notNull().default(0),
  coals: integer('coals').notNull().default(0),
  byCategoryJson: text('by_category_json').notNull(),
  byUserJson: text('by_user_json').notNull(),
  computedAt: text('computed_at').notNull(),
}, t => [
  primaryKey({ columns: [t.shiftId, t.version] }),
  index('shift_summaries_venue_idx').on(t.venueId, t.shiftId),
])

// ---------------------------------------------------------------------------
// Orders and money
// ---------------------------------------------------------------------------

/**
 * A tab (*tura* upon *tura* on one table) is open from the first order until it
 * is paid. The partial unique index is the rule "one open tab per table",
 * enforced by the database rather than by a race-prone SELECT-then-INSERT — and
 * because it is partial on `status='open'`, an `unpaid` tab frees the table
 * exactly like a `paid` one.
 *
 * Three pieces of surface here are **reserved and never written in Korak 2**:
 * `status='voided'` (two services throw `TAB_VOIDED` on it, nothing sets it —
 * voiding a whole tab is Korak 3; today the last line's void empties it) and
 * `fiscal_status` / `fiscal_ref` (there is no fiscal device — CLAUDE.md).
 * `offered_to` is *not* reserved: the handover writes it.
 *
 * `assigned_to` is nullable in DDL and never NULL in fact — a REFERENCES column
 * cannot be added NOT NULL, so the migration backfills it and the
 * `tabs_assigned_required` trigger refuses an insert without it. That is why
 * there is no `tabAssignee()` fallback helper anywhere: a fallback no row can
 * reach is a branch no test can cover.
 */
export const tabs = sqliteTable('tabs', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  /**
   * NULL is *Bez stola* (PHASE3 §1.11): a tab with no table, for the guests at
   * the bar. `tabs_one_open_per_table_uq` keeps working unchanged, because
   * SQLite treats two NULLs in a unique index as *different* values — so many
   * table-less tabs may be open at once while one table still holds one tab.
   */
  tableId: text('table_id').references(() => tables.id),
  clientId: text('client_id').notNull(),
  status: text('status', { enum: ['open', 'paid', 'unpaid', 'voided'] }).notNull().default('open'),
  shiftId: text('shift_id').references(() => shifts.id),
  openedBy: text('opened_by').notNull().references(() => users.id),
  openedAt: text('opened_at').notNull(),
  /** Whose tab it is: whose *Moji stolovi* it appears on, and whose money. */
  assignedTo: text('assigned_to').references(() => users.id),
  /** Set by *Predaj sto kolegi* until the colleague accepts. */
  offeredTo: text('offered_to').references(() => users.id),
  lateSync: integer('late_sync').notNull().default(0),
  unpaidReason: text('unpaid_reason'),
  unpaidBy: text('unpaid_by'),
  unpaidApprovedBy: text('unpaid_approved_by'),
  pendingReview: integer('pending_review').notNull().default(0),
  /** The replay key of the queueable *nije plaćeno* mark. */
  unpaidClientId: text('unpaid_client_id'),
  /** Reserved: there is no fiscal device (CLAUDE.md). Never written in Korak 2. */
  fiscalStatus: text('fiscal_status').notNull().default('none'),
  fiscalRef: text('fiscal_ref'),
  closedAt: text('closed_at'),
  closedBy: text('closed_by').references(() => users.id),
}, t => [
  uniqueIndex('tabs_client_uq').on(t.venueId, t.clientId),
  uniqueIndex('tabs_one_open_per_table_uq')
    .on(t.venueId, t.tableId)
    .where(sql`status = 'open'`),
  uniqueIndex('tabs_unpaid_client_uq')
    .on(t.venueId, t.unpaidClientId)
    .where(sql`unpaid_client_id IS NOT NULL`),
  index('tabs_venue_status_idx').on(t.venueId, t.status),
  index('tabs_shift_idx').on(t.venueId, t.shiftId, t.status),
  index('tabs_assigned_idx').on(t.venueId, t.assignedTo, t.status),
])

/**
 * One locked round. Append-only apart from the single `prepared_at` /
 * `prepared_by` transition the bartender's ticket screen writes — a trigger in
 * `triggers.sql` enforces exactly that and nothing else.
 *
 * `shift_seq` is the round's number within its shift ("12. tura"), unique per
 * shift. `client_created_at` is what the phone claimed; `client_created_at_adj`
 * is the clamped value the server actually used — both are kept so a phone with
 * a wrong clock leaves evidence instead of a silently-corrected row.
 */
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  tabId: text('tab_id').notNull().references(() => tabs.id),
  clientId: text('client_id').notNull(),
  shiftId: text('shift_id').references(() => shifts.id),
  shiftSeq: integer('shift_seq'),
  lockedBy: text('locked_by').notNull().references(() => users.id),
  deviceId: text('device_id').references(() => devices.id),
  note: text('note'),
  clientCreatedAt: text('client_created_at'),
  clientCreatedAtAdj: text('client_created_at_adj'),
  syncLagS: integer('sync_lag_s').notNull().default(0),
  lateSync: integer('late_sync').notNull().default(0),
  /** The locker had already settled this shift; the round raises his expected. */
  postSettle: integer('post_settle').notNull().default(0),
  /** Reserved: always 'app'. 'import' and 'scan' are Korak 3. */
  source: text('source').notNull().default('app'),
  createdAt: text('created_at').notNull(),
  preparedAt: text('prepared_at'),
  preparedBy: text('prepared_by').references(() => users.id),
}, t => [
  uniqueIndex('orders_client_uq').on(t.venueId, t.clientId),
  uniqueIndex('orders_shift_seq_uq').on(t.venueId, t.shiftId, t.shiftSeq),
  index('orders_tab_idx').on(t.venueId, t.tabId),
  index('orders_prep_idx').on(t.venueId, t.preparedAt, t.createdAt),
  index('orders_shift_locker_idx').on(t.venueId, t.shiftId, t.lockedBy),
])

/**
 * `name_snapshot` and `unit_price_fen` are copied from the product at the moment
 * the round is locked. Editing a price tomorrow must not change what a guest was
 * charged tonight, and the phone never sends either number.
 *
 * `flavours_json` holds stock item **ids** (`["uuid","uuid"]`), never names —
 * names are joined at read time, so renaming an aroma does not rewrite history.
 * `parent_line_id` is how a *Dodatni žar* row points at the bowl it tops up.
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
  /** Set when the line was locked free: staff_drink | owner_guest | complaint | promo. */
  compReason: text('comp_reason'),
  authorisedBy: text('authorised_by').references(() => users.id),
  parentLineId: text('parent_line_id').references((): AnySQLiteColumn => orderLines.id),
  note: text('note'),
}, t => [index('order_lines_order_idx').on(t.venueId, t.orderId)])

/**
 * Money in, append-only. A reversal is a **negative row** with an `approved_by`,
 * never an edit of the original — so `SUM(amount_fen)` is what was taken and
 * always was. `covers_json` holds the order `client_id`s the payer said this
 * covers, which is how *naplata bez pokrića* is detected.
 */
export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  tabId: text('tab_id').notNull().references(() => tabs.id),
  shiftId: text('shift_id').references(() => shifts.id),
  clientId: text('client_id').notNull(),
  method: text('method', { enum: ['cash', 'card'] }).notNull(),
  amountFen: integer('amount_fen').notNull(),
  /** What the guest handed over, for the change calculation. Not money taken. */
  receivedFen: integer('received_fen'),
  tipFen: integer('tip_fen').notNull().default(0),
  coversJson: text('covers_json').notNull().default('[]'),
  paidBy: text('paid_by').notNull().references(() => users.id),
  /** Required on a negative row — a trigger refuses a reversal without one. */
  approvedBy: text('approved_by'),
  deviceId: text('device_id'),
  reversesId: text('reverses_id'),
  adjustmentId: text('adjustment_id'),
  /** The payer had already settled this shift (§6.3). */
  postSettle: integer('post_settle').notNull().default(0),
  clientCreatedAt: text('client_created_at'),
  clientCreatedAtAdj: text('client_created_at_adj'),
  createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('payments_client_uq').on(t.venueId, t.clientId),
  index('payments_tab_idx').on(t.venueId, t.tabId),
  index('payments_shift_user_idx').on(t.venueId, t.shiftId, t.paidBy, t.method),
])

/**
 * A void or a comp on one line. One transition: `pending → applied|rejected`,
 * once, and a trigger holds the amount still while the status moves.
 *
 * `tab_id` is denormalised so a tab's money is one query. `was_paid` records
 * whether the guest had already paid when it was requested — the difference
 * between a correction and a refund. `refund_kind` says whose cash gives it
 * back: nobody's (`none`), the waiter's envelope (`from_waiter`) or the drawer.
 */
export const lineAdjustments = sqliteTable('line_adjustments', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  orderLineId: text('order_line_id').notNull().references(() => orderLines.id),
  tabId: text('tab_id').notNull().references(() => tabs.id),
  clientId: text('client_id').notNull(),
  kind: text('kind', { enum: ['void', 'comp'] }).notNull(),
  reason: text('reason').notNull(),
  note: text('note'),
  qty: real('qty').notNull(),
  amountFen: integer('amount_fen').notNull(),
  restock: integer('restock').notNull(),
  requestedBy: text('requested_by').notNull().references(() => users.id),
  deviceId: text('device_id'),
  /** How long after the lock it was asked for — the 300 s self-void window. */
  secondsSinceLock: integer('seconds_since_lock').notNull(),
  wasPaid: integer('was_paid').notNull(),
  status: text('status', { enum: ['pending', 'applied', 'rejected'] }).notNull(),
  /** 1 when a rule applied it with no human decision. */
  auto: integer('auto').notNull().default(0),
  approvedBy: text('approved_by'),
  decidedOnDeviceId: text('decided_on_device_id'),
  /** An admin PIN typed on somebody else's phone: allowed, always recorded. */
  foreignDevice: integer('foreign_device').notNull().default(0),
  decidedAt: text('decided_at'),
  decidedInShiftId: text('decided_in_shift_id'),
  refundKind: text('refund_kind', { enum: ['none', 'from_waiter', 'from_drawer'] }).notNull().default('none'),
  createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('line_adjustments_client_uq').on(t.venueId, t.clientId),
  // Whole-line voids in v1: a line has at most one live adjustment.
  uniqueIndex('line_adjustments_line_uq')
    .on(t.venueId, t.orderLineId)
    .where(sql`status IN ('pending','applied')`),
  index('line_adjustments_tab_idx').on(t.venueId, t.tabId, t.status),
  index('line_adjustments_requester_idx').on(t.venueId, t.requestedBy, t.createdAt),
  index('line_adjustments_pending_idx')
    .on(t.venueId, t.createdAt)
    .where(sql`status = 'pending'`),
])

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
 * `unit_cost_mfen` is what that quantity was worth when it moved, so COGS never
 * has to guess at yesterday's price.
 *
 * `late_sync` is the offset row: a movement that arrives dated *before* a
 * confirmed count was already on the shelf when the shelf was counted, so it
 * gets a mirror row cancelling it and `SUM(qty_delta)` stays true.
 */
export const stockMovements = sqliteTable('stock_movements', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  stockItemId: text('stock_item_id').notNull().references(() => stockItems.id),
  type: text('type', {
    enum: [
      'opening', 'delivery', 'sale', 'sale_storno', 'late_sync',
      'waste', 'count_adjust', 'correction', 'return_supplier',
    ],
  }).notNull(),
  qtyDelta: real('qty_delta').notNull(),
  unitCostMfen: integer('unit_cost_mfen').notNull().default(0),
  refType: text('ref_type'),
  refId: text('ref_id'),
  /** Nullable: the seed's `opening` rows were nobody's doing. */
  userId: text('user_id').references(() => users.id),
  shiftId: text('shift_id').references(() => shifts.id),
  note: text('note'),
  /** When it happened in the venue's world. */
  occurredAt: text('occurred_at').notNull(),
  /** When the row reached the database. The two differ for a late sync. */
  createdAt: text('created_at').notNull(),
}, t => [
  index('stock_movements_item_idx').on(t.venueId, t.stockItemId, t.occurredAt),
  index('stock_movements_ref_idx').on(t.refType, t.refId),
  index('stock_movements_shift_idx').on(t.venueId, t.shiftId),
])

/** *Prijem robe*: one header per invoice. Always posted in Korak 2. */
export const deliveries = sqliteTable('deliveries', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  /**
   * Not ceremony: the bartender receives goods from a phone on café wifi, and
   * without a replay key one retried post books 12 crates twice and silently
   * doubles the moving average's numerator.
   */
  clientId: text('client_id').notNull(),
  supplierName: text('supplier_name').notNull(),
  invoiceNo: text('invoice_no'),
  deliveredAt: text('delivered_at').notNull(),
  totalFen: integer('total_fen').notNull().default(0),
  /** `draft` exists for the Korak 3 scan flow and is never written in Korak 2. */
  status: text('status', { enum: ['draft', 'posted'] }).notNull().default('posted'),
  source: text('source').notNull().default('manual'),
  scanId: text('scan_id'),
  note: text('note'),
  enteredBy: text('entered_by').notNull(),
  postedBy: text('posted_by'),
  postedAt: text('posted_at'),
  reversedAt: text('reversed_at'),
  reversedBy: text('reversed_by'),
  reversalNote: text('reversal_note'),
  createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('deliveries_client_uq').on(t.venueId, t.clientId),
  index('deliveries_delivered_idx').on(t.venueId, t.deliveredAt),
  index('deliveries_status_idx').on(t.venueId, t.status),
])

/**
 * `qty` is server-computed (`packs × pack_qty_used + loose`) and `line_cost_fen`
 * is the exact invoice amount, so `unit_cost_mfen = round(cost × 1000 / qty)`
 * is honest to 0,001 fen per ml. A zero-cost line is rejected by the schema
 * before it can drag the moving average toward nothing.
 */
export const deliveryLines = sqliteTable('delivery_lines', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  deliveryId: text('delivery_id').notNull().references(() => deliveries.id),
  stockItemId: text('stock_item_id').notNull().references(() => stockItems.id),
  /** The pack size actually used, when this invoice's crate was not the usual one. */
  packQtyUsed: real('pack_qty_used'),
  packs: real('packs').notNull().default(0),
  loose: real('loose').notNull().default(0),
  qty: real('qty').notNull(),
  lineCostFen: integer('line_cost_fen').notNull(),
  unitCostMfen: integer('unit_cost_mfen').notNull(),
  note: text('note'),
}, t => [index('delivery_lines_delivery_idx').on(t.venueId, t.deliveryId)])

/**
 * *Otpis*: something left the shelf without being sold. Written immediately even
 * when it is over the approval threshold — the bottle is broken whether or not
 * anyone approves, and refusing the write teaches staff not to log breakage.
 * `needs_approval = 1` plus a non-quiet log entry is the accountability.
 */
export const wasteEvents = sqliteTable('waste_events', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  stockItemId: text('stock_item_id').notNull().references(() => stockItems.id),
  clientId: text('client_id').notNull(),
  qty: real('qty').notNull(),
  reason: text('reason', {
    enum: ['razbijeno', 'isteklo', 'prosuto', 'degustacija', 'ostalo'],
  }).notNull(),
  note: text('note'),
  costFen: integer('cost_fen').notNull(),
  shiftId: text('shift_id').references(() => shifts.id),
  userId: text('user_id').notNull().references(() => users.id),
  needsApproval: integer('needs_approval').notNull().default(0),
  approvedBy: text('approved_by'),
  approvedAt: text('approved_at'),
  createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('waste_events_client_uq').on(t.venueId, t.clientId),
  index('waste_events_shift_idx').on(t.venueId, t.shiftId),
  index('waste_events_created_idx').on(t.venueId, t.createdAt),
])

/**
 * A count: *popis*. Submitted by whoever counted, confirmed by an admin — and
 * only the confirm writes stock. `witnessed_by` / `witnessed_at` are reserved
 * columns so Korak 3 adds a route and no migration.
 *
 * The partial unique index is why a shift has at most one opening and one
 * closing count: a second submit is 409 `COUNT_EXISTS` rather than two rows
 * racing to be "the" opening count. `phase='adhoc'` is deliberately outside it —
 * a spot count can happen five times a night.
 */
export const stockCounts = sqliteTable('stock_counts', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  kind: text('kind', { enum: ['spot', 'full'] }).notNull(),
  phase: text('phase', { enum: ['open', 'close', 'adhoc'] }).notNull(),
  shiftId: text('shift_id').references(() => shifts.id),
  status: text('status', { enum: ['submitted', 'confirmed'] }).notNull().default('submitted'),
  countedBy: text('counted_by').notNull().references(() => users.id),
  witnessedBy: text('witnessed_by'),
  witnessedAt: text('witnessed_at'),
  confirmedBy: text('confirmed_by'),
  confirmedAt: text('confirmed_at'),
  overrideBy: text('override_by'),
  submittedAt: text('submitted_at').notNull(),
  note: text('note'),
}, t => [
  uniqueIndex('stock_counts_shift_phase_uq')
    .on(t.venueId, t.shiftId, t.phase)
    .where(sql`phase IN ('open','close')`),
  index('stock_counts_shift_idx').on(t.venueId, t.shiftId, t.phase),
  index('stock_counts_status_idx').on(t.venueId, t.status, t.submittedAt),
])

/**
 * Append-only, born at submit. `theoretical_qty` is the snapshot the ledger
 * showed at `submitted_at`, so the variance a screen shows tonight is the
 * variance the count actually found. `applied_adjust` is the single column a
 * confirm may fill in — a trigger allows exactly that and nothing else.
 */
export const stockCountLines = sqliteTable('stock_count_lines', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  countId: text('count_id').notNull().references(() => stockCounts.id),
  stockItemId: text('stock_item_id').notNull().references(() => stockItems.id),
  countedPacks: real('counted_packs'),
  countedLoose: real('counted_loose'),
  weighedG: real('weighed_g'),
  countedQty: real('counted_qty').notNull(),
  theoreticalQty: real('theoretical_qty').notNull(),
  varianceQty: real('variance_qty').notNull(),
  unitCostMfen: integer('unit_cost_mfen').notNull(),
  varianceFen: integer('variance_fen').notNull(),
  appliedAdjust: real('applied_adjust'),
  note: text('note'),
}, t => [
  uniqueIndex('stock_count_lines_uq').on(t.venueId, t.countId, t.stockItemId),
  index('stock_count_lines_item_idx').on(t.venueId, t.stockItemId, t.countId),
])

/**
 * *Napomena* — one person's own words about one of his own nights (PHASE3 §1.6).
 *
 * Deliberately **not** a ledger table: no trigger, no entry in `LEDGER_TABLES`,
 * and it may be edited and deleted. It is not an accounting row, it is a note,
 * and a note nobody can correct is a note nobody writes. One per person per
 * shift, which is what the unique index says.
 */
export const staffNotes = sqliteTable('staff_notes', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  shiftId: text('shift_id').notNull().references(() => shifts.id),
  userId: text('user_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
}, t => [
  uniqueIndex('staff_notes_shift_user_uq').on(t.venueId, t.shiftId, t.userId),
  index('staff_notes_user_idx').on(t.venueId, t.userId, t.shiftId),
])

// ---------------------------------------------------------------------------
// Log, alerts, sync
// ---------------------------------------------------------------------------

/**
 * The Dnevnik — the one activity record (CLAUDE.md: there is no separate audit
 * log). Written by `log()` inside the same transaction as the event it
 * describes, so an entry exists if and only if the event committed.
 *
 * `actor_id` NULL renders as *Sistem*. A redaction may rewrite `title_bs` and
 * `body_json` together with `redacted_at`, and nothing else, ever.
 */
export const logEntries = sqliteTable('log_entries', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  kind: text('kind').notNull(),
  titleBs: text('title_bs').notNull(),
  bodyJson: text('body_json').notNull(),
  refType: text('ref_type'),
  refId: text('ref_id'),
  actorId: text('actor_id'),
  deviceId: text('device_id'),
  shiftId: text('shift_id'),
  businessDate: text('business_date').notNull(),
  /** Points at the request entry this decision answers. */
  resolvesId: text('resolves_id'),
  createdAt: text('created_at').notNull(),
  redactedAt: text('redacted_at'),
}, t => [
  index('log_entries_created_idx').on(t.venueId, t.createdAt, t.id),
  index('log_entries_kind_idx').on(t.venueId, t.kind, t.createdAt),
  index('log_entries_actor_idx').on(t.venueId, t.actorId, t.createdAt),
  index('log_entries_ref_idx').on(t.venueId, t.refType, t.refId),
  index('log_entries_shift_idx').on(t.venueId, t.shiftId),
  index('log_entries_resolves_idx').on(t.venueId, t.resolvesId),
])

/**
 * One item for the in-app attention list. The unique key is the dedupe:
 * `INSERT OR IGNORE` on `(venue, rule, ref_type, ref_id)` means a void decided
 * twice on the same adjustment raises one item. `send_after` is the earliest it
 * may surface (quiet hours). Nothing sends anything: `sent_at`, `attempts` and
 * `last_error` are leftovers from the removed sender and stay unwritten (§9).
 */
export const alertEvents = sqliteTable('alert_events', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull().references(() => venues.id),
  ruleKey: text('rule_key').notNull(),
  refType: text('ref_type').notNull(),
  refId: text('ref_id').notNull(),
  payloadJson: text('payload_json').notNull(),
  createdAt: text('created_at').notNull(),
  sendAfter: text('send_after').notNull(),
  sentAt: text('sent_at'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
}, t => [
  uniqueIndex('alert_events_dedupe_uq').on(t.venueId, t.ruleKey, t.refType, t.refId),
  index('alert_events_unsent_idx').on(t.venueId, t.sentAt, t.sendAfter),
])

/**
 * The sync cursor — deliberately **not** a ledger, and deliberately without
 * triggers. A phone asks `GET /api/changes?since=<seq>` and gets back which
 * entities moved; the nightly task prunes rows older than a week with a plain
 * DELETE. Guarding a cursor with a no-delete trigger and then routinely
 * disabling that trigger would weaken the mechanism everything else depends on.
 *
 * `seq` is a global AUTOINCREMENT, monotonic per venue because every read
 * filters by `venue_id`. That is decided: making it per-venue later re-cursors
 * every phone in the building.
 */
export const changes = sqliteTable('changes', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  venueId: text('venue_id').notNull().references(() => venues.id),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  createdAt: text('created_at').notNull(),
}, t => [index('changes_venue_seq_idx').on(t.venueId, t.seq)])

/**
 * How an hourly task does a once-a-day job exactly once: it claims the day with
 * `INSERT OR IGNORE` against this unique key, and no row inserted means somebody
 * already did it.
 */
export const taskRuns = sqliteTable('task_runs', {
  id: text('id').primaryKey(),
  venueId: text('venue_id').notNull(),
  task: text('task').notNull(),
  businessDate: text('business_date').notNull(),
  ranAt: text('ran_at').notNull(),
  ok: integer('ok').notNull(),
  error: text('error'),
}, t => [uniqueIndex('task_runs_uq').on(t.venueId, t.task, t.businessDate)])
