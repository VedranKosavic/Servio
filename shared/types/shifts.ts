/**
 * The shift, the drawer, the envelope and the night's numbers.
 *
 * WP2 owns this fragment (`docs/BACKEND.md` §6.5–§6.7). Everything here is a
 * *response* shape: what `GET /api/me/shift` puts on a waiter's phone, what a
 * close answers, and the two summaries the owner reads.
 *
 * One vocabulary note that the whole file turns on. There are three different
 * "expected cash" numbers and mixing them up is how a reconciliation silently
 * stops reconciling:
 *
 *   `venue_expected_fen`  — every fen of the café's money, wherever it is
 *                           sitting: the drawer plus every waiter's pocket.
 *   `drawer_expected_fen` — only what should be in the drawer itself.
 *   `expected_fen` on a waiter row — what should be in *that person's* pocket.
 *
 * and the identity that binds them, asserted by a test and by `invariants.test.ts`:
 *
 *   venue_expected_fen === drawer_expected_fen + Σ waiters[].expected_fen
 *
 * The shift *summary* then splits that same total a second way, by who has
 * already handed his envelope over: `expected_cash_fen` (drawer + the waiters
 * who settled) + `outstanding_fen` (everybody who has not) === venue expected.
 */
import type { Role } from '../types'

export type ShiftStatus = 'open' | 'closing' | 'closed' | 'reviewed'
export type ShiftClosedKind = 'normal' | 'forced'
export type CashMovementType = 'float_in' | 'float_out' | 'payout' | 'owner_pickup' | 'refund'
export type CashMovementStatus = 'pending' | 'approved' | 'rejected'
export type PayoutReason = 'dobavljac' | 'sitno' | 'ostalo'
export type SummaryReason = 'close' | 'decision' | 'late'

// ---------------------------------------------------------------------------
// The shift itself
// ---------------------------------------------------------------------------

/** A `shifts` row as a screen sees it: snake_case, no nulls invented. */
export interface Shift {
  id: string
  business_date: string
  status: ShiftStatus
  opened_at: string
  opened_by: string
  opened_by_name: string
  auto_opened: boolean
  stock_custodian_id: string | null
  closing_started_at: string | null
  closing_started_by: string | null
  closed_at: string | null
  closed_by: string | null
  closed_kind: ShiftClosedKind | null
  opening_float_override_fen: number | null
  cash_counted_fen: number | null
  card_total_fen: number | null
  closing_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
}

/**
 * The strip at the top of every waiter screen. `my_settled` and `my_open_tabs`
 * are why this read takes an actor and why its ETag carries the user (§4.2).
 */
export interface ShiftBrief {
  id: string
  status: ShiftStatus
  business_date: string
  /** Somebody tapped *Zatvori smjenu*; the envelopes are being collected. */
  closing: boolean
  closer_name: string | null
  my_settled: boolean
  my_open_tabs: number
}

export interface ShiftMember {
  user_id: string
  name: string
  role: Role
  joined_at: string
  left_at: string | null
  hours: number
}

// ---------------------------------------------------------------------------
// Cash
// ---------------------------------------------------------------------------

export interface CashMovement {
  id: string
  type: CashMovementType
  amount_fen: number
  /** Whose money it is — the waiter receiving a float, the payout's requester. */
  user_id: string
  user_name: string
  /** Who wrote the row. */
  created_by: string
  created_by_name: string
  reason: string | null
  note: string | null
  status: CashMovementStatus
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

/**
 * Where the opening float came from. `derived` is the previous close's counted
 * cash minus what the owner took out of it; `unknown` means nobody has told the
 * app yet, and the venue expectation uses 0 while saying so.
 */
export interface OpeningFloat {
  fen: number | null
  source: 'override' | 'derived' | 'unknown'
}

/**
 * One waiter's row of `expectedCash`. Every term answers the same question —
 * *how much cash should be in this person's pocket right now* — so every term is
 * either cash that moved or a balance he is holding, and **no term is a charge**.
 */
export interface ExpectedCashWaiter {
  user_id: string
  name: string
  /** Terms 1–5 added up. Term 6 is inside term 2 and is never added twice. */
  expected_fen: number
  /** 1 · cash the drawer handed him (approved `float_out` only). */
  float_out_fen: number
  /** 2 · cash he took, negative reversals included. */
  cash_fen: number
  /** 3 · tabs he marked *nije plaćeno* that the owner has not decided yet. */
  unpaid_fen: number
  /** 4 · a void he asked for that has not been granted is still owed. */
  void_held_fen: number
  /** 5 · what is still owed on tabs carrying a round he locked after settling. */
  post_settle_lock_fen: number
  /** 6 · reported, never added: it is already inside `cash_fen`. */
  post_settle_cash_fen: number
  settled: boolean
}

export interface ExpectedCash {
  venue_expected_fen: number
  drawer_expected_fen: number
  opening_float_known: boolean
  waiters: ExpectedCashWaiter[]
}

// ---------------------------------------------------------------------------
// Close, review, settle
// ---------------------------------------------------------------------------

export interface MissingSettlement {
  user_id: string
  name: string
}

export interface CloseResult {
  shift: Shift
  summary_version: number
  missing_settlements: MissingSettlement[]
  /** What the waiters who had not settled were still holding. */
  outstanding_fen: number
  /** The drawer plus everybody who *has* settled — what the count is compared to. */
  expected_fen: number
  counted_fen: number | null
  diff_fen: number | null
  within_tolerance: boolean
}

/**
 * A phone that still holds rounds in its outbox. Reported rather than thrown
 * when the device has not been heard from recently (§6.6): a settle must not be
 * blocked by a phone that is switched off in a drawer.
 */
export interface StaleDevice {
  device_id: string
  label: string
  pending_count: number
  last_seen_at: string | null
}

export interface Settlement {
  id: string
  shift_id: string
  user_id: string
  user_name: string
  declared_fen: number
  expected_at_declare_fen: number
  diff_fen: number
  accepted_by: string | null
  accepted_by_name: string | null
  accepted_at: string | null
  self_sealed: boolean
  late: boolean
  created_at: string
}

/**
 * The reveal. `declared_fen` was recorded **before** any of these numbers left
 * the server — that recorded pair, not the strip, is the evidence (§6.6).
 */
export interface SettleResult {
  settlement_id: string
  summary: UserSummary
  expected_fen: number
  declared_fen: number
  diff_fen: number
  within_tolerance: boolean
  tolerance_fen: number
  breakdown: ExpectedCashWaiter
  self_sealed: boolean
  late: boolean
  stale_devices: StaleDevice[]
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface CategoryLine {
  category_id: string
  /** Joined at read; the stored JSON is purely numeric (§3.2). */
  name?: string
  qty: number
  fen: number
}

export interface CountFen {
  count: number
  fen: number
}

export interface StornoTotals extends CountFen {
  pending_count: number
  pending_fen: number
}

/**
 * One person's night. `self_voids` and `waste` sit on the same row as promet
 * because the point of counting them is that they are visibly counted.
 */
export interface UserSummary {
  user_id: string
  name: string
  joined_at: string | null
  settled_at: string | null
  hours: number
  promet_fen: number
  unpaid_fen: number
  cash_fen: number
  card_fen: number
  float_out_fen: number
  tabs: number
  rounds: number
  bowls: number
  by_category: CategoryLine[]
  storno: StornoTotals
  self_voids: CountFen
  gratis: CountFen
  waste: CountFen
  post_settle_locks: CountFen
  /** Present once he has settled (or at the moment he settles). */
  expected_fen?: number
  declared_fen?: number
  tolerance_fen?: number
  within_tolerance?: boolean
}

export interface ShiftSummary {
  shift_id: string
  version: number
  reason: SummaryReason
  promet_fen: number
  cash_fen: number
  card_fen: number
  comp_fen: number
  void_count: number
  void_fen: number
  self_void_count: number
  self_void_fen: number
  unpaid_fen: number
  /** The drawer plus the waiters who have settled — what a count is compared to. */
  expected_cash_fen: number
  /** Everybody who has not settled. `expected + outstanding === venue expected`. */
  outstanding_fen: number
  counted_cash_fen: number | null
  diff_fen: number | null
  stock_variance_fen: number
  waste_fen: number
  bowls: number
  tobacco_g: number
  coals: number
  by_category: CategoryLine[]
  by_user: UserSummary[]
  computed_at: string
}

// ---------------------------------------------------------------------------
// The line drill-down
// ---------------------------------------------------------------------------

export type LineStatus =
  | 'otvoreno' | 'naplaceno' | 'nije_placeno'
  | 'storno' | 'storno_na_cekanju' | 'gratis'

export interface LineRow {
  line_id: string
  at: string
  /** When the phone said it happened, if it was queued. */
  arrived_at: string
  sync_lag_s: number
  shift_seq: number
  table_name: string
  name_snapshot: string
  note: string | null
  flavour_names: string[]
  qty: number
  charged_fen: number
  unit_price_fen: number
  status: LineStatus
  late_sync: boolean
  locked_by: string
  locked_by_name: string
}

/** Computed over the whole filtered set, never the page — page 1 and page 3 agree. */
export interface LineTotals {
  rows: number
  qty: number
  charged_fen: number
  storno_fen: number
  gratis_fen: number
}

export interface LinesPage {
  rows: LineRow[]
  totals: LineTotals
  next_cursor?: string
}

// ---------------------------------------------------------------------------
// The two shift reads
// ---------------------------------------------------------------------------

export interface MyShift {
  shift: ShiftBrief | null
  joined_at: string | null
  hours: number
  settled: boolean
  settlement: Settlement | null
  /**
   * Always present, even before settlement. The blindness strip is about promet
   * and expected, not about what a person was handed (§6.5) — without this a
   * bartender could push his own shortfall onto a colleague who was
   * structurally prevented from noticing it.
   */
  float_out_fen: number
  /** His own rows, always. */
  cash_movements: CashMovement[]
  /** `null` until he settles — the blindness strip. */
  summary: UserSummary | null
}

export interface MyShiftRow {
  shift_id: string
  business_date: string
  joined_at: string
  left_at: string | null
  hours: number
  declared_fen: number | null
  diff_fen: number | null
}

export interface OwnerShiftRow {
  id: string
  business_date: string
  status: ShiftStatus
  opened_at: string
  closed_at: string | null
  promet_fen: number
  diff_fen: number | null
}

/**
 * A submitted or confirmed count, as the shift screen lists it. The full
 * `CountView` with its lines is WP4's (§6.8); this is the brief the shift read
 * needs and nothing more.
 */
export interface ShiftCountBrief {
  id: string
  kind: 'spot' | 'full'
  phase: 'open' | 'close' | 'adhoc'
  status: 'submitted' | 'confirmed'
  counted_by: string
  counted_by_name: string
  submitted_at: string
  confirmed_at: string | null
  variance_fen: number
}

export interface LateAfterClose {
  count: number
  fen: number
  user_names: string[]
}

export interface OwnerShift {
  shift: Shift
  summary: ShiftSummary
  by_user: UserSummary[]
  cash_movements: CashMovement[]
  settlements: Settlement[]
  counts: ShiftCountBrief[]
  late_after_close: LateAfterClose
}
