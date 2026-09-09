/**
 * The response shapes, written once and imported by both sides.
 *
 * The request types are derived from the Zod schemas in `./schemas` (one
 * definition, two uses). The response types are declared here, and the service
 * functions in `server/services/*` are typed to return them — so a change to a
 * route's answer is a compile error in the screen that reads it, instead of a
 * blank field discovered on a Saturday night.
 */
export type {
  CreateDeliveryBody,
  CreateOrderBody,
  MarkPreparedBody,
  OrderLineInput,
  PayTabBody,
} from './schemas'

export type Role = 'waiter' | 'bartender' | 'owner'
export type Zone = 'unutra' | 'basta'
export type ProductKind = 'simple' | 'shisha'
export type StockKind = 'pice' | 'duhan' | 'zar' | 'potrosni'
export type BaseUnit = 'kom' | 'g' | 'ml'
export type MovementType = 'opening' | 'delivery' | 'sale' | 'correction'
export type TabStatus = 'open' | 'paid'

export interface Venue {
  id: string
  name: string
  slug: string
}

export interface User {
  id: string
  name: string
  initials: string
  role: Role
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
  sort: number
}

export interface Product {
  id: string
  category_id: string
  name: string
  price_fen: number
  kind: ProductKind
  /** Grams of tobacco a bowl uses, split across the chosen flavours. */
  shisha_grams: number | null
  coal_pcs: number | null
  is_favourite: boolean
  sort: number
}

/** A tobacco stock item, offered as an aroma on a shisha product. */
export interface Flavour {
  id: string
  name: string
  on_hand: number
  base_unit: BaseUnit
}

export interface Bootstrap {
  venue: Venue
  users: User[]
  tables: VenueTable[]
  categories: Category[]
  products: Product[]
  flavours: Flavour[]
}

export interface TableState {
  table_id: string
  tab_id: string | null
  total_fen: number
  opened_by_name: string | null
  opened_at: string | null
  last_order_at: string | null
}

export interface CreateOrderResult {
  order_id: string
  tab_id: string
  order_total_fen: number
  tab_total_fen: number
  /** True when this request was a replay of one already applied. */
  already_applied: boolean
}

export interface Tab {
  id: string
  table_id: string
  table_name: string
  client_id: string
  status: TabStatus
  total_fen: number
  opened_by: string
  opened_at: string
  closed_at: string | null
  closed_by: string | null
}

export interface PrepLine {
  name_snapshot: string
  qty: number
  flavours: string[]
  note: string | null
}

export interface PrepOrder {
  order_id: string
  table_name: string
  waiter_name: string
  created_at: string
  prepared_at: string | null
  prepared_by_name: string | null
  note: string | null
  lines: PrepLine[]
}

export interface Prep {
  open: PrepOrder[]
  done: PrepOrder[]
}

export interface StockLastMovement {
  type: MovementType
  qty_delta: number
  occurred_at: string
  /** A human line: "Sto 7 · narudžba", "prijem robe", "početno stanje". */
  ref_label: string
}

export interface StockItem {
  id: string
  name: string
  kind: StockKind
  base_unit: BaseUnit
  pack_name: string | null
  pack_qty: number | null
  is_spot: boolean
  on_hand: number
  last_movement: StockLastMovement | null
}

export interface Health {
  ok: true
  tables: number
  products: number
}

/** The body of every 4xx/5xx this API returns, unwrapped by `useApi`. */
export interface ApiError {
  code: string
  message: string
}
