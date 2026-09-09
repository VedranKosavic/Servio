/**
 * Stock, as the screens see it.
 *
 * WP4 owns this fragment (`docs/BACKEND.md` §6.8): *Stanje šanka*, *Prijem robe*,
 * *Otpis*, *Popis*, and the three owner reads — the stock list with its ledger
 * drill-down, the Kategorije report and the Nargila report.
 */
import type { StaleDevice } from './auth'
import type { StockItemAdmin } from './admin'

export type StockKind = 'pice' | 'duhan' | 'zar' | 'potrosni' | 'hrana'
export type BaseUnit = 'kom' | 'g' | 'ml'
export type MovementType =
  | 'opening' | 'delivery' | 'sale' | 'sale_storno' | 'late_sync'
  | 'waste' | 'count_adjust' | 'correction' | 'return_supplier'

/**
 * The colour of a row on *Stanje šanka*, in the order the screen sorts by.
 *
 * - `u_minusu` — on hand is negative: the ledger says the shelf owes stock,
 *   which is always a missing delivery or a wrong normativ, never good news.
 * - `bez_cijene` — the item has neither a moving average nor a last cost, so
 *   every number computed from it (variance, *utrošak*, *otpis*) is 0,00 KM.
 * - `nisko` — at or below `par_qty`: order more.
 */
export type StockStatus = 'u_minusu' | 'bez_cijene' | 'nisko' | 'ok'

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
  /**
   * The three fields *Brzi popis* cannot count without (PHASE3 §1.3).
   *
   * They used to live on `StockItemAdmin` only, behind admin routes a bartender
   * may not call — which left the count screen unable to say which items go on
   * the scale, what tare to subtract, or which line needs a note. None of them
   * is a price or anybody's money: they are how the shelf is measured.
   */
  count_method: 'count' | 'weigh'
  /** The empty tin, in grams. `null` on an item nobody weighs. */
  tare_g: number | null
  /** How far a count may miss before the line needs a note. */
  tolerance_qty: number
  on_hand: number
  status: StockStatus
  /** The unit cost is the `last_cost_mfen` fallback, not a real average (§6.8). */
  estimated: boolean
  unit_cost_mfen: number
  last_movement: StockLastMovement | null
}

/** `GET /api/stock` — the ETagged envelope (§7). */
export interface StockResponse {
  seq: number
  items: StockItem[]
}

// ===========================================================================
// Deliveries, waste, corrections
// ===========================================================================

export interface DeliveryLineView {
  stock_item_id: string
  item_name: string
  packs: number
  loose: number
  qty: number
  line_cost_fen: number
  unit_cost_mfen: number
  note: string | null
}

export interface DeliveryView {
  id: string
  client_id: string
  supplier_name: string
  invoice_no: string | null
  delivered_at: string
  total_fen: number
  status: string
  reversed_at: string | null
  reversal_note: string | null
  entered_by: string
  entered_by_name: string
  note: string | null
  lines: DeliveryLineView[]
  /** The same `client_id` was posted before; this is the stored answer (§2). */
  already_applied: boolean
}

export interface WasteView {
  id: string
  stock_item_id: string
  item_name: string
  qty: number
  reason: string
  note: string | null
  cost_fen: number
  /** Priced by the `last_cost_mfen` fallback — *procijenjeno* on the screen. */
  estimated: boolean
  needs_approval: boolean
  approved_by: string | null
  approved_by_name: string | null
  created_at: string
  on_hand: number
  already_applied: boolean
}

/**
 * `POST /api/stock/opening` and `GET /api/owner/stock` answer with the admin row
 * plus what the ledger says about it.
 *
 * §6.8 calls this shape "`StockItemAdmin`, plus `on_hand`, `status`,
 * `estimated`". WP6 landed `StockItemAdmin` first, with `estimated_cost` and no
 * ledger fields on it, so the two extras live here rather than in a fragment
 * this package does not own.
 */
export interface StockItemStock extends StockItemAdmin {
  on_hand: number
  status: StockStatus
  /** `on_hand × unit_cost_mfen / 1000`, rounded once at the end (§2). */
  value_fen: number
}

// ===========================================================================
// Counts
// ===========================================================================

export interface CountLineView {
  id: string
  stock_item_id: string
  item_name: string
  base_unit: BaseUnit
  counted_packs: number | null
  counted_loose: number | null
  weighed_g: number | null
  counted_qty: number
  theoretical_qty: number
  variance_qty: number
  unit_cost_mfen: number
  variance_fen: number
  /** Derived at read: the line was priced by the fallback, not by an average. */
  estimated: boolean
  out_of_tolerance: boolean
  applied_adjust: number | null
  note: string | null
}

export interface CountView {
  id: string
  kind: 'spot' | 'full'
  phase: 'open' | 'close' | 'adhoc'
  shift_id: string | null
  status: 'submitted' | 'confirmed'
  counted_by: string
  counted_by_name: string
  submitted_at: string
  /**
   * The incoming custodian's *Potvrđujem stanje* (F9 step 4, PHASE3 §1.4).
   *
   * Nullable on purpose: an unwitnessed count is an attention line on the
   * owner's *Puls*, never a blocked one. A count with nobody else behind the bar
   * is still a count.
   */
  witnessed_by: string | null
  witnessed_by_name: string | null
  witnessed_at: string | null
  confirmed_by: string | null
  confirmed_by_name: string | null
  confirmed_at: string | null
  override_by: string | null
  note: string | null
  lines: CountLineView[]
  totals: {
    lines: number
    out_of_tolerance: number
    variance_fen: number
  }
  /** Phones that still report an outbox but are simply switched off (§6.6). */
  stale_devices: StaleDevice[]
}

export interface ConfirmResultLine {
  stock_item_id: string
  item_name: string
  /** What the variance looked like at submit. */
  submitted_variance: number
  /** What the confirm actually wrote — recomputed against the theoretical now. */
  applied_adjust: number
  /** Rounds that synced between submit and confirm: `applied − submitted`. */
  late_delta: number
}

export interface ConfirmResult {
  count: CountView
  lines: ConfirmResultLine[]
}

/** A submitted count waiting for an admin — WP7's *Puls* reads this (§6.10). */
export interface PendingCount {
  count_id: string
  kind: 'spot' | 'full'
  phase: 'open' | 'close' | 'adhoc'
  shift_id: string | null
  counted_by: string
  counted_by_name: string
  submitted_at: string
  variance_fen: number
  out_of_tolerance: number
}

// ===========================================================================
// The owner's stock reads (§6.8 "Reports")
// ===========================================================================

export interface OwnerStockReport {
  items: StockItemStock[]
  totals: {
    items: number
    value_fen: number
    /** How many rows are `u_minusu`, `bez_cijene` or `nisko`. */
    u_minusu: number
    bez_cijene: number
    nisko: number
  }
}

export interface ItemMovementRow {
  id: string
  type: MovementType
  qty_delta: number
  unit_cost_mfen: number
  value_fen: number
  occurred_at: string
  created_at: string
  user_name: string | null
  ref_label: string
  note: string | null
  /** On hand after this row, walking the page from the oldest row upwards. */
  running_on_hand: number
}

export interface ItemMovementsPage {
  item: { id: string, name: string, base_unit: BaseUnit, on_hand: number }
  rows: ItemMovementRow[]
  /** Pass back as `?before=` for the next page; `null` = the ledger starts here. */
  next_cursor: string | null
}

// ===========================================================================
// The two monthly reports
// ===========================================================================

export interface CategoryReportRow {
  category_id: string
  category_name: string
  kind: 'pice' | 'hrana' | 'nargila' | 'ostalo'
  /** Σ `delivery_lines.line_cost_fen`, less reversals and goods sent back. */
  nabavka_fen: number
  /** Σ `charged_fen` − applied void `amount_fen`. */
  prodaja_fen: number
  /** What the sales took off the shelf, at cost. */
  utrosak_fen: number
  /** Waste, count adjustments and late-sync offsets, at cost. */
  otpis_fen: number
  /** `prodaja − utrošak` — the gross margin the owner reads first. */
  marza_fen: number
}

export interface CategoriesReport {
  from: string
  to: string
  rows: CategoryReportRow[]
  totals: Omit<CategoryReportRow, 'category_id' | 'category_name' | 'kind'>
}

export interface NargilaReportItem {
  stock_item_id: string
  item_name: string
  pocetno_g: number
  primljeno_g: number
  zavrsno_g: number
  potroseno_g: number
  /** `završno_g` is a theoretical figure, not a counted one. */
  estimated: boolean
}

export interface NargilaReport {
  from: string
  to: string
  month: string | null
  pocetno_g: number
  primljeno_g: number
  zavrsno_g: number
  potroseno_g: number
  prodano_lula: number
  /** `potroseno_g / grams_per_bowl_default`, rounded. */
  ocekivano_lula: number
  /** `očekivano − prodano`: bowls the tobacco says were sold and the till does not. */
  razlika_lula: number
  /** The difference valued at the cheapest active shisha product. */
  razlika_fen: number
  /** Measured grams per bowl, `null` when nothing was sold. */
  grams_per_bowl: number | null
  gpb_norm: number
  within_band: boolean
  estimated: boolean
  items: NargilaReportItem[]
}
