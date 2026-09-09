/**
 * Tabs, rounds, payments and the prep tickets.
 *
 * WP3 owns this fragment (`docs/BACKEND.md` §6.1–§6.4). Every shape here is the
 * answer of one route in §7, and the services in `server/services/{orders,tabs,
 * payments,adjustments}.ts` are typed to return it — so changing what a route
 * answers is a compile error in the screen that reads it, rather than a blank
 * field found on a Saturday night.
 */
import type { ShiftBrief } from './shifts'

export type TabStatus = 'open' | 'paid' | 'unpaid' | 'voided'
export type PaymentMethod = 'cash' | 'card'
export type AdjustmentKind = 'void' | 'comp'
export type RefundKind = 'none' | 'from_waiter' | 'from_drawer'
export type AdjustmentStatus = 'pending' | 'applied' | 'rejected'

/**
 * What one line looks like on the tab sheet. Not `shared/types/shifts.ts`'s
 * `LineStatus`, which is the *shift drill-down's* vocabulary and carries
 * `naplaceno` / `nije_placeno` — a tab sheet already knows whether it is paid.
 */
export type TabLineStatus = 'ok' | 'storno' | 'storno_na_cekanju' | 'gratis'

// ---------------------------------------------------------------------------
// The floor plan
// ---------------------------------------------------------------------------

/**
 * One tile of the waiter's floor plan.
 *
 * `total_fen` is what the guests have been charged; `remaining_fen` is what they
 * still owe, and it is `remaining_fen` that goes on the tile — a tab half paid
 * is not a tab of its full total. `assigned_to` is whose tab it is: whose *Moji
 * stolovi* it appears on and who may mark it *nije plaćeno*. `offered_to` set
 * means a colleague has been offered the table and has not taken it yet.
 */
export interface TableState {
  /**
   * `null` only inside `loose_tabs`: a *Bez stola* tab belongs to guests at the
   * bar and sits on no tile of the floor plan (PHASE3 §1.11). Every row in
   * `tables` has one.
   */
  table_id: string | null
  tab_id: string | null
  /** The phone's own id for the tab; a phone that locked offline adopts it. */
  tab_client_id: string | null
  total_fen: number
  remaining_fen: number
  /** Never null while `tab_id` is not: a trigger refuses a tab without one. */
  assigned_to: string | null
  /** "A.H." — the colleague badge on the tile. */
  assigned_to_initials: string | null
  opened_by_name: string | null
  opened_at: string | null
  last_order_at: string | null
  /** Yellow tile: *naplata čeka* — somebody has to look at this one. */
  pending_review: boolean
  /** Amber *kasno* badge: the round arrived long after it happened. */
  late_sync: boolean
  /** Set → "Nudi ti: Sto 7 · Prihvati" for that user. */
  offered_to: string | null
}

/**
 * `GET /api/tables/state`. The strip at the top of the screen and the floor plan
 * come back together, because a phone that polled them separately would draw a
 * *Završi smjenu* bar for a shift that had already closed.
 */
export interface TablesStateResponse {
  seq: number
  shift: ShiftBrief | null
  tables: TableState[]
  /**
   * Open tabs with no table — *Bez stola*, the guests standing at the bar.
   *
   * They are their own list rather than extra rows in `tables`, because the
   * floor plan draws one circle per table and there is no circle for these:
   * `/k` renders them as cards above the plan (S1). Every row has
   * `table_id: null` and a `tab_id`.
   */
  loose_tabs: TableState[]
}

// ---------------------------------------------------------------------------
// The lock
// ---------------------------------------------------------------------------

export interface CreateOrderResult {
  order_id: string
  tab_id: string
  /** The canonical client id of the tab, so an offline phone can adopt it. */
  tab_client_id: string
  shift_id: string
  /** "12. tura" — the round's number within its shift. */
  shift_seq: number
  order_total_fen: number
  tab_total_fen: number
  /** The round arrived long after it happened, or after its tab was closed. */
  late_sync: boolean
  /** The locker had already handed his envelope in; it raises his expected. */
  post_settle: boolean
  /** True when this request was a replay of one already applied. */
  already_applied: boolean
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

/**
 * A tab's money, computed in one place and never stored.
 *
 *   total     = Σ charged_fen − Σ applied adjustments
 *   remaining = total − Σ pending void − Σ payments   (reversals are negative)
 *
 * `remaining_fen` may go **negative** after a void on a tab that was already
 * paid. That is not a bug and it is not corrected: the guest was charged, the
 * guest paid, and the café then decided the line should not have been there.
 * Who hands the money back, if anybody, is `refund_kind`'s question (§6.4).
 */
export interface TabMoney {
  total_fen: number
  pending_void_fen: number
  paid_fen: number
  remaining_fen: number
}

export interface Tab {
  id: string
  /** `null` is *Bez stola*. */
  table_id: string | null
  /** `null` with `table_id`; the screens render the word *Bez stola*. */
  table_name: string | null
  client_id: string
  status: TabStatus
  shift_id: string | null
  total_fen: number
  remaining_fen: number
  opened_by: string
  opened_at: string
  assigned_to: string | null
  assigned_to_name: string | null
  offered_to: string | null
  offered_to_name: string | null
  pending_review: boolean
  late_sync: boolean
  unpaid_reason: string | null
  unpaid_by: string | null
  closed_at: string | null
  closed_by: string | null
}

export interface TabLine {
  id: string
  name_snapshot: string
  note: string | null
  flavour_names: string[]
  qty: number
  unit_price_fen: number
  charged_fen: number
  comp_reason: string | null
  status: TabLineStatus
  adjustment_id: string | null
}

export interface TabOrder {
  id: string
  client_id: string
  shift_seq: number | null
  locked_by: string
  locked_by_name: string
  at: string
  late_sync: boolean
  lines: TabLine[]
}

export interface TabPayment {
  id: string
  method: PaymentMethod
  amount_fen: number
  paid_by: string
  paid_by_name: string
  at: string
  reverses_id: string | null
}

/** `GET /api/tabs/:id` — everything *Pokaži narudžbu* and *Naplati* need. */
export interface TabDetail {
  tab: Tab
  money: TabMoney
  orders: TabOrder[]
  payments: TabPayment[]
}

export interface UnpaidResult {
  tab: Tab
  already_applied: boolean
}

// ---------------------------------------------------------------------------
// Naplata
// ---------------------------------------------------------------------------

export interface PaymentResult {
  payment_id: string
  tab_id: string
  tab_client_id: string
  tab_status: TabStatus
  total_fen: number
  paid_fen: number
  remaining_fen: number
  /** What to hand back: `received_fen − amount_fen`, never negative. */
  change_fen: number
  /** The payer had already settled this shift (§6.3). */
  post_settle: boolean
  already_applied: boolean
}

// ---------------------------------------------------------------------------
// Storno i gratis
// ---------------------------------------------------------------------------

export interface PendingAdjustment {
  id: string
  kind: AdjustmentKind
  reason: string
  note: string | null
  qty: number
  amount_fen: number
  restock: boolean
  was_paid: boolean
  seconds_since_lock: number
  status: AdjustmentStatus
  /** 1 when a rule applied it with no human decision. */
  auto: boolean
  refund_kind: RefundKind
  order_line_id: string
  line_name: string
  tab_id: string
  table_name: string
  requested_by: string
  requested_by_name: string
  approved_by: string | null
  approved_by_name: string | null
  decided_at: string | null
  created_at: string
  /** This actor, this role, this window — whether the *Odobri* button shows. */
  can_decide: boolean
}

export interface AdjustmentResult {
  adjustment: PendingAdjustment
  tab_total_fen: number
  tab_remaining_fen: number
  /** The request was granted on the spot: a self-void, a staff drink, a PIN. */
  applied: boolean
  already_applied: boolean
}

// ---------------------------------------------------------------------------
// The prep tickets
// ---------------------------------------------------------------------------

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
