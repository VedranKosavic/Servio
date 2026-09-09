/**
 * Stock, as the screens see it.
 *
 * WP4 owns this fragment (`docs/BACKEND.md` §6.8). WP0 seeds it with the Korak 1
 * shapes plus the two enums the new schema widened.
 */
export type StockKind = 'pice' | 'duhan' | 'zar' | 'potrosni' | 'hrana'
export type BaseUnit = 'kom' | 'g' | 'ml'
export type MovementType =
  | 'opening' | 'delivery' | 'sale' | 'sale_storno' | 'late_sync'
  | 'waste' | 'count_adjust' | 'correction' | 'return_supplier'

/** A tobacco stock item, offered as an aroma on a shisha product. */
export interface Flavour {
  id: string
  name: string
  on_hand: number
  base_unit: BaseUnit
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
