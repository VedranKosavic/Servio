/**
 * The bodies of the admin catalogue routes (`docs/BACKEND.md` §6.10, §7 *admin*).
 *
 * WP6 owns this fragment; `shared/schemas.ts` re-exports it.
 *
 * **Why a price is allowed in these bodies at all.** §2's rule is narrower than
 * "no money in a body": what a *phone* may never send is the value of a thing
 * the catalogue already prices (`unit_price_fen`, a line total, a promet). The
 * catalogue itself has to be typed in by somebody, and that somebody is the
 * admin standing in `/a` — so `price_fen` and `last_cost_mfen` arrive here and
 * nowhere else, on routes `ROUTE_ROLES` gives to `['admin']` alone.
 *
 * Every body is `.strict()`: an unknown key in a *Postavke* form is a typo or a
 * stale screen, never something to shrug at. Patch bodies are `.partial()` and
 * may not be empty — the service answers `EMPTY_PATCH` rather than writing a
 * Dnevnik entry that says nothing changed.
 */
import { z } from 'zod'
import { MAX_MONEY_FEN } from '../constants'
import { moneyFen, pin, uuid } from './common'

/**
 * A per-unit cost, in **milli-feninga** (`docs/BACKEND.md` §2): 30 KM per 700 ml
 * is 4 286 mfen/ml, and rounding that to 4 fen/ml loses 2,20 KM on one bottle.
 * A thousand times the money ceiling, because the unit is a thousandth.
 */
export const costMfen = z.int().min(0).max(MAX_MONEY_FEN * 1000)

const name60 = z.string().trim().min(1).max(60)
const zone = z.enum(['unutra', 'basta'])
const productKind = z.enum(['simple', 'shisha'])
const categoryKind = z.enum(['pice', 'hrana', 'nargila', 'ostalo'])
const stockKind = z.enum(['pice', 'duhan', 'zar', 'potrosni', 'hrana'])
const baseUnit = z.enum(['kom', 'g', 'ml'])
const countMethod = z.enum(['count', 'weigh'])
const role = z.enum(['admin', 'waiter', 'bartender'])

// ===========================================================================
// Products and recipes
// ===========================================================================

/**
 * `POST /api/admin/products`. The new product's price opens its first
 * `price_history` row in the same transaction, so "what did this cost in March"
 * has an answer from the first minute.
 */
export const createProductBody = z.object({
  category_id: uuid,
  name: name60,
  short_name: z.string().trim().max(20).nullish(),
  /** Extra words the search box matches: "cola kola". */
  search_aliases: z.string().trim().max(120).optional(),
  price_fen: moneyFen,
  kind: productKind.optional(),
  /** The 1:1 shelf item this product sells, when it has one. */
  sells_stock_item_id: uuid.nullish(),
  /** `kind='shisha'`: grams of tobacco a bowl uses, split across its flavours. */
  shisha_grams: z.number().min(0).max(200).nullish(),
  coal_pcs: z.int().min(0).max(50).nullish(),
  staff_drink_allowed: z.boolean().optional(),
  is_favourite: z.boolean().optional(),
  sort: z.int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
}).strict()

/** `PATCH /api/admin/products/:id`. A `price_fen` here is the price change (§6.10). */
export const updateProductBody = createProductBody.partial()

/**
 * `PUT /api/admin/products/:id/recipe` — the *normativ*, replaced whole.
 *
 * Whole, not line by line: a recipe is one statement about a product ("kafa is
 * 7 g kafe and 5 g šećera"), and editing it a line at a time is how a product
 * ends up briefly consuming sugar and nothing else.
 */
export const setRecipeBody = z.object({
  lines: z.array(z.object({
    stock_item_id: uuid,
    qty: z.number().gt(0).max(100_000),
  }).strict()).max(20),
}).strict()

// ===========================================================================
// Categories, tables
// ===========================================================================

export const createCategoryBody = z.object({
  name: z.string().trim().min(1).max(40),
  kind: categoryKind.optional(),
  /** The quick note chips this category offers: "bez šećera", "duplo". */
  note_chips: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
  sort: z.int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
}).strict()

export const updateCategoryBody = createCategoryBody.partial()

/**
 * `POST /api/admin/tables`. `col`/`row` place the table on its zone's bird's-eye
 * schematic — the floor plan the waiter taps, not a list.
 */
export const createTableBody = z.object({
  name: z.string().trim().min(1).max(20),
  zone,
  col: z.int().min(1).max(12),
  row: z.int().min(1).max(12),
  /** 'vip' for the box inside Unutra; null for an ordinary table. */
  grp: z.string().trim().max(20).nullish(),
  sort: z.int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
}).strict()

export const updateTableBody = createTableBody.partial()

// ===========================================================================
// Stock items
// ===========================================================================

/**
 * `POST /api/admin/stock-items`.
 *
 * `last_cost_mfen` is **optional here and required by the service** (422
 * `COST_REQUIRED`), which is deliberate: a missing cost is not a malformed
 * request, it is a business rule with a Bosnian sentence behind it, and §3.1
 * explains what a zero cost silently switches off — `variance_fen`,
 * `waste_events.cost_fen`, *utrošak* and the `count_confirmed` alert.
 */
export const createStockItemBody = z.object({
  name: name60,
  kind: stockKind,
  base_unit: baseUnit,
  category_id: uuid.nullish(),
  brand: z.string().trim().max(40).nullish(),
  /** "gajba", "tin", "kutija" — how it arrives; `pack_qty` converts to base units. */
  pack_name: z.string().trim().max(20).nullish(),
  pack_qty: z.number().gt(0).max(100_000).nullish(),
  count_method: countMethod.optional(),
  /** A `weigh` item's empty tin, in grams. */
  tare_g: z.number().min(0).max(100_000).nullish(),
  tolerance_qty: z.number().min(0).max(100_000).optional(),
  par_qty: z.number().min(0).max(1_000_000).nullish(),
  last_cost_mfen: costMfen.optional(),
  is_spot: z.boolean().optional(),
  available: z.boolean().optional(),
  active: z.boolean().optional(),
}).strict()

/**
 * `PATCH /api/admin/stock-items/:id`. `base_unit` is frozen once the item has a
 * movement (409 `UNIT_FROZEN`): the ledger's `qty_delta` is in the old unit and
 * `SUM(qty_delta)` would silently start adding millilitres to grams.
 */
export const updateStockItemBody = createStockItemBody.partial()

// ===========================================================================
// Users
// ===========================================================================

/**
 * `POST /api/admin/users` — a new person on the staff.
 *
 * The PIN is in the body because a person with no PIN cannot log in at all, and
 * the admin who is adding somebody is standing next to them. 4 or 6 digits are
 * both legal for every role (§6.10); 6 is recommended for an admin, and that is
 * advice on a screen rather than a rule in the server.
 */
export const createUserBody = z.object({
  name: z.string().trim().min(1).max(40),
  initials: z.string().trim().min(1).max(3),
  role,
  pin,
  /** Admins only: email + password is the one way into `/a` on a laptop. */
  email: z.email().max(120).trim().toLowerCase().nullish(),
  /** Pasted from @userinfobot; where this admin's Telegram mirror goes (§9). */
  telegram_chat_id: z.string().trim().max(40).nullish(),
}).strict()

/**
 * `PATCH /api/admin/users/:id`. No PIN here — a PIN is set on its own route, so
 * that every PIN in the app goes through one function that also clears the
 * device lock it left behind.
 */
export const updateUserBody = z.object({
  name: z.string().trim().min(1).max(40),
  initials: z.string().trim().min(1).max(3),
  role,
  active: z.boolean(),
  email: z.email().max(120).trim().toLowerCase().nullish(),
  telegram_chat_id: z.string().trim().max(40).nullish(),
}).strict().partial()

/**
 * `POST /api/admin/users/:id/pin` — the admin resets somebody's PIN.
 *
 * The route hands this straight to WP1's `resetPin` (`services/auth.ts`), which
 * hashes it, clears the devices this person locked and writes both Dnevnik
 * entries. It is deliberately **not** on `PIN_BEARING_ROUTES`: that list is the
 * *approval* routes, where a PIN authorises somebody else's money and
 * `pinLimiter` is keyed on `(deviceId, approverUserId)`. Here there is no
 * approver — the admin's own session is the authority, and the PIN is being
 * written rather than verified.
 */
export const resetUserPinBody = z.object({ pin }).strict()

export type CreateProductBody = z.infer<typeof createProductBody>
export type UpdateProductBody = z.infer<typeof updateProductBody>
export type SetRecipeBody = z.infer<typeof setRecipeBody>
export type CreateCategoryBody = z.infer<typeof createCategoryBody>
export type UpdateCategoryBody = z.infer<typeof updateCategoryBody>
export type CreateTableBody = z.infer<typeof createTableBody>
export type UpdateTableBody = z.infer<typeof updateTableBody>
export type CreateStockItemBody = z.infer<typeof createStockItemBody>
export type UpdateStockItemBody = z.infer<typeof updateStockItemBody>
export type CreateUserBody = z.infer<typeof createUserBody>
export type UpdateUserBody = z.infer<typeof updateUserBody>
export type ResetUserPinBody = z.infer<typeof resetUserPinBody>
