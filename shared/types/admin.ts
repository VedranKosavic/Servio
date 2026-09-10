/**
 * The catalogue and the venue, as the screens see them.
 *
 * WP6 owns this fragment (`docs/BACKEND.md` §6.10 admin CRUD). WP0 seeds it with
 * the shapes Korak 1 already serves, so the waiter screens keep compiling and
 * WP6 extends its own file rather than editing the barrel.
 */
export type Zone = 'unutra' | 'basta'
export type ProductKind = 'simple' | 'shisha'
export type CategoryKind = 'pice' | 'hrana' | 'nargila' | 'ostalo'

/**
 * The two products a *phone* is allowed to recognise (PHASE3 §1.10).
 *
 * `'zar'` is *Dodatni žar* — 0 KM, two pieces of coal, and the one product the
 * lock sheet is skipped for (PLAN §10, invariant 2). `'ostalo'` is the
 * fixed-price catch-all whose long-press takes the free text that becomes the
 * line's note. Both get behaviour of their own on S2 and S3, and matching that
 * behaviour on a *name* is how a rename in *Meni* becomes a Saturday-night bug.
 */
export type ProductSystemKey = 'zar' | 'ostalo'

export interface Venue {
  id: string
  name: string
  slug: string
}

export interface User {
  id: string
  name: string
  initials: string
  role: import('../types').Role
}

export interface VenueTable {
  id: string
  name: string
  zone: Zone
  col: number
  row: number
  /** 'vip' for the VIP box; null for an ordinary table. */
  grp: string | null
  sort: number
}

export interface Category {
  id: string
  name: string
  /**
   * The quick notes a long-press offers on this category's tiles — *bez šećera*,
   * *s mlijekom*, *dupla* (F2 step 4). A category with none falls back to the
   * free-text field alone.
   */
  note_chips: string[]
  sort: number
}

export interface Product {
  id: string
  category_id: string
  name: string
  /** What fits on a 3-column tile when `name` does not. */
  short_name: string | null
  /**
   * Extra words the *Dodaj* search matches, space separated ("kola koka").
   * The search is prefix-based and diacritic-insensitive, so "coca" and "kola"
   * both find Coca-Cola without either spelling being the product's name.
   */
  search_aliases: string
  price_fen: number
  kind: ProductKind
  /** Set only on the two system products; see `ProductSystemKey`. */
  system_key: ProductSystemKey | null
  /** Grams of tobacco a bowl uses, split across the chosen flavours. */
  shisha_grams: number | null
  coal_pcs: number | null
  /** May a waiter take this as one of his staff drinks (F7)? */
  staff_drink_allowed: boolean
  is_favourite: boolean
  sort: number
}

/**
 * `GET /api/bootstrap` — everything a screen needs before it can draw anything,
 * in one request (§5.7, §7).
 *
 * The last five fields are Korak 2's. Korak 1 shipped a catalogue and nothing
 * else, so every screen then asked separately who it was talking to; now the
 * envelope answers that too. `me`, `device` and `shift` are the same objects
 * `GET /api/me` and `GET /api/tables/state` return — one parser on the client,
 * not three — and `seq` and `menu_version` are the two cursors: poll
 * `/api/changes?since=seq`, and refetch this whole envelope only when
 * `menu_version` moves (§4.4).
 */
export interface Bootstrap {
  venue: Venue
  /** The sync cursor at this moment. Poll `/api/changes?since=` from here. */
  seq: number
  /** Refetch this envelope when this number moves, and at no other time. */
  menu_version: number
  me: import('./auth').MeUser
  /** `null` on an admin's email session, which has no device. */
  device: import('./auth').DeviceBrief | null
  /** The open shift and this actor's place in it, or `null` before one opens. */
  shift: import('./shifts').ShiftBrief | null
  users: User[]
  tables: VenueTable[]
  categories: Category[]
  products: Product[]
  flavours: import('./stock').Flavour[]
}

export interface Health {
  ok: true
  tables: number
  products: number
}

// ===========================================================================
// The `/admin` catalogue screens (WP6 — `docs/BACKEND.md` §6.10, §7 *admin*)
// ===========================================================================
//
// **Why these are `*Admin` supersets and not the four shapes above.** §7 names
// the responses `Product`, `Category`, `VenueTable` and `User`, and those names
// are already taken by the lean bootstrap shapes every waiter phone parses —
// `api-shapes.test.ts` asserts their exact field sets. *Meni & Postavke* needs
// strictly more (`active`, the recipe, the cost, when the price last moved), so
// the admin screens get their own names rather than a widened envelope that
// would put an admin's `email` on every phone in the café.
//
// **Nothing here is a secret.** No `pin_hash`, no `password_hash`, no session
// token: `admin.test.ts` walks every response below and fails on any key
// matching `/_hash$|token|password|pepper/`, the same grep `api-shapes.test.ts`
// runs over the phone-facing envelopes.

/** One line of a *normativ*: how much of a shelf item one product consumes. */
export interface RecipeLine {
  stock_item_id: string
  stock_item_name: string
  base_unit: 'kom' | 'g' | 'ml'
  qty: number
}

export interface ProductAdmin {
  id: string
  category_id: string
  category_name: string
  name: string
  short_name: string | null
  search_aliases: string
  price_fen: number
  /** When the current price started — the open `price_history` row's `valid_from`. */
  price_since: string | null
  kind: ProductKind
  sells_stock_item_id: string | null
  shisha_grams: number | null
  shisha_grams_measured_at: string | null
  coal_pcs: number | null
  staff_drink_allowed: boolean
  is_favourite: boolean
  sort: number
  active: boolean
  created_at: string
  updated_at: string | null
  recipe: RecipeLine[]
}

export interface CategoryAdmin {
  id: string
  name: string
  kind: CategoryKind
  note_chips: string[]
  sort: number
  active: boolean
  /** How many products would disappear from the menu if this were deactivated. */
  product_count: number
}

export interface TableAdmin {
  id: string
  name: string
  zone: Zone
  col: number
  row: number
  grp: string | null
  sort: number
  active: boolean
  /** Guests are sitting there right now — deactivating it is 409. */
  has_open_tab: boolean
}

export interface StockItemAdmin {
  id: string
  name: string
  kind: 'pice' | 'duhan' | 'zar' | 'potrosni' | 'hrana'
  base_unit: 'kom' | 'g' | 'ml'
  category_id: string | null
  category_name: string | null
  brand: string | null
  pack_name: string | null
  pack_qty: number | null
  /** The moving average every delivery recomputes: what the shelf is worth. */
  avg_cost_mfen: number
  /** What the last invoice charged. */
  last_cost_mfen: number
  /** True when the cost is the `last_cost_mfen` fallback — *procijenjeno* (§3.1). */
  estimated_cost: boolean
  count_method: 'count' | 'weigh'
  tare_g: number | null
  tolerance_qty: number
  par_qty: number | null
  is_spot: boolean
  available: boolean
  active: boolean
  /** The item has movements, so `base_unit` can no longer change (409 `UNIT_FROZEN`). */
  unit_frozen: boolean
}

export interface UserAdmin {
  id: string
  name: string
  initials: string
  role: import('../types').Role
  active: boolean
  /** 4 or 6 — how many dots the PIN pad draws before it auto-submits. */
  pin_len: 4 | 6
  /** False = this person cannot log in until an admin sets a PIN. */
  has_pin: boolean
  /** Admins only; the laptop login. Never the password itself. */
  email: string | null
  created_at: string
}

/** `POST /api/admin/users/:id/pin` — the devices this reset also unlocked. */
export interface PinResetResult {
  ok: true
  unlocked: string[]
}
