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
import type { ClosingExtra } from '../closing'
import type { ShiftCostKind } from '../shiftCosts'
import type { Role } from '../types'
import type { StaleDevice } from './auth'

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
  /**
   * Which of the café's two slots this shift is — the `shift_templates` row the
   * worker named when he signed in.
   *
   * `null` on every night worked before the picker existed, and those are still
   * matched by their opening time. Nothing else may guess: a shift opened at
   * 14:50 falls inside *Prva smjena*'s window and was drawn as *Vanredna
   * smjena* for exactly that reason.
   */
  template_id: string | null
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
 * Where the opening float came from.
 *
 * **The café does not count it** (the owner, 23.09.2026): *"ne treba ga
 * ubrajati, to se radi fizički i zna se da je 40 — faktički je 0 jer ga nigdje
 * ne računamo."* The float stays in the wallet across the handover, nobody
 * enters it, and every number the app compares against is the night's takings
 * alone. So `none` is the ordinary answer and it means zero, not "unknown".
 *
 * `override` is the admin typing one in — kept for the venue that does count
 * its drawer, and for the night this one decides to.
 */
export interface OpeningFloat {
  fen: number
  source: 'override' | 'none'
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

// `StaleDevice` — a phone that still holds rounds in its outbox, reported
// rather than thrown when it has not been heard from recently (§6.6) — was
// declared here too, identically. The one that ships is WP1's in
// `shared/types/auth.ts`, beside the other device briefs and next to the
// `services/devices.ts` function that builds it. Two `export type *` fragments
// declaring one name make it ambiguous in the barrel, so there is exactly one.

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

/**
 * One category of his night, as a **count** — no money in it (PHASE3 §1.5).
 *
 * `category_id` is here so the chip can open the drill-down
 * (`/konobar/moja-smjena/stavke?kat=`), which filters on exactly this id.
 */
export interface MyShiftCategoryCount {
  category_id: string
  name: string
  count: number
}

/**
 * What *Moja smjena* shows **before** the envelope is handed in (PHASE3 §1.5).
 *
 * Always present, and deliberately **money-free**: not one key ends in `_fen`
 * except `gratis.max_fen`, which is not his money at all — it is the published
 * rule, the ceiling on a staff drink, and a rule you are measured against has
 * to be readable before you are measured. `summaries.test.ts` asserts that with
 * a regex over the serialised object, so a `*_fen` added here fails the suite
 * rather than the blindness (§6.6).
 */
export interface MyShiftCounts {
  rounds: number
  tabs: number
  bowls: number
  by_category: MyShiftCategoryCount[]
  /** His storna tonight, split by whether anybody has decided them yet. */
  storno: { pending: number, applied: number }
  /** *Osoblje: 1/2 (do 3 KM)* — used, the cap, and the per-drink ceiling. */
  gratis: { used: number, cap: number, max_fen: number }
  waste: number
  hours: number
}

/**
 * One article the shift sold, and what it took for it.
 *
 * Grouped by the **snapshotted** name, not by product id: a price list that was
 * edited mid-night leaves two rows with the same name and different prices, and
 * one row saying *Coca-Cola 12* is what a person reading this actually wants.
 * `fen` is promet — charged, minus an applied storno — so a cancelled round
 * leaves this list entirely rather than sitting in it at zero.
 */
export interface SoldItem {
  name: string
  qty: number
  fen: number
}

/**
 * *Moja smjena*, whole: what the shift sold and what it took (the owner's call,
 * 16.09.2026 — the screen is these rows and this total, and nothing else).
 *
 * **The shift's rows, not one person's.** The screen reads `/api/me/*` and
 * still names nobody, but what it shows is the night both people are working:
 * a šanker locks no round of his own, so his own list would always be empty,
 * and the pazar he is about to hand over is the shift's. There is still no
 * per-person money anywhere on a staff screen — this has no by-waiter split in
 * it at all.
 *
 * Which night: the open shift, else the last closed one he worked, so the
 * screen is worth opening the morning after as well.
 */
export interface SoldNight {
  shift_id: string | null
  business_date: string | null
  /** False when these are last night's numbers rather than tonight's. */
  open: boolean
  rows: SoldItem[]
  /** Ukupan pazar smjene: the sum of `rows`. */
  total_fen: number
}

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
  /**
   * Always present, with no money in it. The blindness strip hides what the
   * night *earned*; it was never meant to hide what he *did*, and an empty
   * screen for the first five hours of every shift is how a waiter learns that
   * *Moja smjena* is not worth opening (PHASE3 §1.5).
   */
  counts: MyShiftCounts
  /**
   * The newest **closed** shift he worked, with his own totals. Once the šanker
   * has closed the night there is nothing left to be blind about, so the
   * numbers are his to read (settlement or not); `null` when he has none.
   */
  last_closed: LastClosedShift | null
  /** The whole of what *Moja smjena* draws: sold articles and the pazar. */
  sold: SoldNight
}

export interface LastClosedShift {
  shift_id: string
  business_date: string
  closed_at: string | null
  summary: UserSummary
  counts: MyShiftCounts
}

export interface MyShiftRow {
  shift_id: string
  business_date: string
  joined_at: string
  left_at: string | null
  hours: number
  declared_fen: number | null
  diff_fen: number | null
  /** *Napomena* — his own words about his own night, editable (PHASE3 §1.6). */
  note: string | null
}

export interface OwnerShiftRow {
  id: string
  business_date: string
  status: ShiftStatus
  opened_at: string
  /**
   * Which of the café's two slots this shift is — the `shift_templates` row the
   * worker named when he signed in.
   *
   * `null` on every night worked before the picker existed, and those are still
   * matched by their opening time. Nothing else may guess: a shift opened at
   * 14:50 falls inside *Prva smjena*'s window and was drawn as *Vanredna
   * smjena* for exactly that reason.
   */
  template_id: string | null
  closed_at: string | null
  promet_fen: number
  diff_fen: number | null
  /** *Za predati* from the šanker's closing, when the night has one. */
  za_predati_fen: number | null
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
  /** *Zaključenje smjene* — the šanker's close, or `null` for a night without one. */
  closing: ShiftClosing | null
}

// -- Zaključi smjenu ---------------------------------------------------------

/**
 * One `shift_closings` row as a screen reads it — the eight lines and the
 * result, plus who closed it. `SUM` of the typed five is not stored; a screen
 * that wants it adds them.
 */
export interface ShiftClosing {
  id: string
  shift_id: string
  business_date: string
  client_id: string
  closed_by: string
  closed_by_name: string
  created_at: string
  /** Server: the shift's promet — charged minus applied voids. */
  prihod_fen: number
  /** Server: `settings.dnevnica_fen` as it stood at the close. */
  dnevnica_fen: number
  /**
   * Server: the shift's otpis — `summary.waste_fen` **plus** the tabs marked
   * *Otpis* on the floor, which are a tab and not a `product_waste` row.
   */
  otpis_fen: number
  /** Server: the tabs marked *Rashod* on the floor, at what was left on them. */
  rashod_fen: number
  /** Server: the tabs marked *Policija*, the same way. */
  policija_fen: number
  /** Server: the tabs marked *Osoblje* — a worker's own allowance. */
  osoblje_fen: number
  roba_fen: number
  okusi_fen: number
  zar_fen: number
  kafa_fen: number
  merkator_fen: number
  /** *Dodatna plaćanja*, each with the name the šanker gave it. */
  extras: ClosingExtra[]
  /** Their sum — what the subtraction below actually used. */
  extra_fen: number
  /**
   * What is left of the shift: the šanker's *Za predati* **less** the
   * *Naknadni troškovi* an admin added afterwards. May be negative.
   */
  za_predati_fen: number
  /** The šanker's own *Za predati* at the close, before any *naknadni trošak*. */
  za_predati_at_close_fen: number
  /** *Naknadni troškovi*: paid out of this shift's takings after it closed. */
  naknadni: ShiftExtraCost[]
  /** Their sum. */
  naknadni_fen: number
  note: string | null
}

/** One *Naknadni trošak* on a closed shift, as *Kasa* lists it. */
/** A paid invoice's own lines: what was bought and what each cost. */
export interface ShiftCostInvoice {
  delivered_at: string
  supplier_name: string
  invoice_no: string | null
  entered_by_name: string
  total_fen: number
  reversed_at: string | null
  lines: {
    item_name: string
    category_name: string | null
    qty: number
    base_unit: 'kom' | 'g' | 'ml'
    line_cost_fen: number
  }[]
}

export interface ShiftExtraCost {
  id: string
  kind: ShiftCostKind
  /** The owner's own name for *Ostalo*; `null` otherwise. */
  label: string | null
  amount_fen: number
  /** The *Prijem robe* invoice this pays, when it pays one. */
  delivery_id: string | null
  /** That invoice, as *Smjena* prints it under *Kasa*; `null` for a cost with no invoice. */
  invoice: ShiftCostInvoice | null
  created_at: string
  created_by_name: string
}

/** `GET /api/shifts/:id/zakljucenje` — what the šanker sees before he types. */
export interface ClosingPreview {
  shift_id: string
  business_date: string
  status: ShiftStatus
  prihod_fen: number
  dnevnica_fen: number
  otpis_fen: number
  rashod_fen: number
  policija_fen: number
  osoblje_fen: number
  /** Tabs still open; the close is refused (409 `OPEN_TABS`) while any are. */
  open_tabs: { tab_id: string, table_name: string }[]
  /** Already closed: the stored row, so a reload shows the done state. */
  closing: ShiftClosing | null
}
