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

export interface Bootstrap {
  venue: Venue
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
