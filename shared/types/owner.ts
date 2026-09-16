/**
 * The owner dashboard's read shapes — *Puls*, *Smjena* and the drill-down
 * (`docs/BACKEND.md` §6.10).
 *
 * Everything that is merely *information* — a phone whose clock is wrong, a
 * shift closed an hour early, a device holding rounds — goes into `flags[]`,
 * which is **derived on every read from a time window** and disappears by
 * itself when the condition stops being true, so nothing here needs dismissing.
 */
import type { StaleDevice } from './auth'
import type { TableState } from './money'
import type { LineRow, ShiftBrief } from './shifts'

// ---------------------------------------------------------------------------
// The derived list
// ---------------------------------------------------------------------------

/**
 * `no_item_cost` is the one kind §6.10's list does not name. §11 asks for it by
 * behaviour rather than by name — "a Flag raised by a condition disappears once
 * the condition ends … an unpriced item that gets its opening cost" — and there
 * was no kind in the union to carry it. It reads `ownerStock().totals`, the
 * pending read WP4 exports for exactly this, and it clears itself the moment
 * *Početno stanje* prices the item.
 */
export type FlagKind =
  | 'clock_skew' | 'early_close' | 'stale_device' | 'uncovered_payment'
  | 'no_opening_count' | 'cross_waiter_lock' | 'late_after_close'
  | 'opening_float_unknown' | 'no_item_cost'

/**
 * Information, not a decision. Recomputed on every read of *Puls* and gone the
 * moment the condition ends — a stale phone that heartbeats, a count that gets
 * submitted, a float that gets entered. Nothing here accumulates and nothing
 * here needs dismissing.
 */
export interface Flag {
  kind: FlagKind
  title_bs: string
  ref_type: string
  ref_id: string
  at: string
}

// ---------------------------------------------------------------------------
// Puls
// ---------------------------------------------------------------------------

/** A count and what it is worth — the pairs that sit beside promet on *Puls*. */
export interface LiveCountFen {
  count: number
  fen: number
}

/** One person on tonight's strip: *ko radi*. */
export interface LiveWho {
  user_id: string
  name: string
  /** "A.H." — the same badge the floor plan puts on a colleague's tile. */
  initials: string
  joined_at: string | null
  promet_fen: number
  open_tabs: number
  settled: boolean
}

/**
 * One person **the plan** has on a shift today — *Ko radi*, read from
 * *Raspored* rather than from who has signed on.
 *
 * `LiveWho` above is the fact: a row exists because somebody PIN-ed in and rang
 * something up. This is the intention, and the two answer different questions.
 * The owner opening *Puls* at ten in the morning wants to know who is meant to
 * be behind the bar — and the gap between the two lists is the thing worth
 * seeing, so the screen draws both against each other instead of picking one.
 *
 * It is the weekly *Raspored* pattern for today's **business** weekday (the café's
 * day starts at 06:00, so at 02:00 on Saturday this is still Friday's plan),
 * active people on active templates only.
 */
export interface LiveRostered {
  user_id: string
  name: string
  initials: string
  template_id: string
  template_name: string
  /** The template's hours as they stand — the pattern has no dated snapshot. */
  start_time: string
  end_time: string
}

/**
 * `GET /api/owner/live` — *Puls*, polled every 15 s with an ETag (§4.4).
 *
 * The tag carries the role, the user and the minute: table ages and stale-device
 * badges move with the clock even when nothing has been written, so a tag of
 * `MAX(seq)` alone would freeze the screen (§4.2).
 */
export interface OwnerLive {
  /** `MAX(seq)`, so the screen can tell how far behind a cached read is. */
  seq: number
  /** Null once the shift is closed: this strip is what drives *Zatvori smjenu*. */
  shift: ShiftBrief | null
  /** Every shift on today's business date, summed the way *Smjena* sums them. */
  promet_danas_fen: number
  open: { tables: number, total_fen: number }
  /** `=== expectedCash(...).venue_expected_fen` — asserted in `owner-live.test.ts`. */
  expected_cash_fen: number
  storna: LiveCountFen
  gratis: LiveCountFen
  self_voids: LiveCountFen
  waste: LiveCountFen
  who: LiveWho[]
  /** Today's plan, from *Raspored* — see `LiveRostered`. */
  rostered: LiveRostered[]
  /** Phones still holding rounds in their outbox. */
  unsent: StaleDevice[]
  pending: { adjustments: number, unpaid: number, payouts: number, settlements: number }
  flags: Flag[]
  /** The last 20 lines rung up tonight, newest first. */
  last_lines: LineRow[]
  tables: TableState[]
  /** The Dnevnik's newest entry: when it moves, *Puls* fetches `?after=` once. */
  log_max_at: string
}

// ---------------------------------------------------------------------------
// Analitika (16.09.2026)
// ---------------------------------------------------------------------------

/** One day of the month on the chart: what its shifts took. */
export interface AnalyticsDay {
  business_date: string
  pazar_fen: number
  /** How many shifts ran that day; 0 on a day the café did not open. */
  shifts: number
}

/** One month on the twelve-month chart. */
export interface AnalyticsMonthPoint {
  month: string
  pazar_fen: number
}

/** The best night a slot (*Prva smjena*, *Druga smjena*) has had. */
export interface AnalyticsRecord {
  shift_id: string
  business_date: string
  pazar_fen: number
}

export interface AnalyticsSlotRecords {
  template_id: string
  /** The template's own name — *Prva smjena*, *Druga smjena*. */
  name: string
  /** Best in the month on screen, or `null` when that slot never ran in it. */
  month: AnalyticsRecord | null
  /** Best ever. */
  all_time: AnalyticsRecord | null
}

/** A cost the owner types, as stored for one month. */
export interface AnalyticsManualCost {
  amount_fen: number
  /**
   * `true` when this month has no row of its own and the number is carried
   * from an earlier month — *Kirija* does that, being the same every month
   * until somebody changes it.
   */
  carried: boolean
  /** The month the number was actually entered for. `null` when never. */
  from_month: string | null
}

/** `GET /api/owner/analitika?month=YYYY-MM` */
export interface MonthAnalytics {
  month: string
  /** Σ promet of every shift whose business day is in the month. */
  pazar_fen: number
  /** Σ *Za predati* of the month's closings. Open or force-closed nights add nothing. */
  za_predati_fen: number
  shifts: number
  /** How many of them the šanker closed — the ones *Za predati* and *Dnevnice* can see. */
  closed_shifts: number
  /**
   * Rung up, in the pazar, and paid for by nobody: the tabs of the month's
   * shifts closed as *Otpis*, *Rashod*, *Policija* or *Osoblje* — open shifts
   * included, so tonight's counts before the šanker closes it.
   */
  unpaid: {
    otpis: number
    rashod: number
    policija: number
    osoblje: number
  }
  unpaid_fen: number
  costs: {
    roba: number
    okusi: number
    zar: number
    /** *Plaćanje kafe*, *Merkator* and *Dodatna plaćanja* from the month's closings. */
    kafa: number
    merkator: number
    dodatna: number
    dnevnice: number
    struja: number
    voda: number
    kirija: number
  }
  /** How struja, voda and kirija got their number. */
  manual: {
    struja: AnalyticsManualCost
    voda: AnalyticsManualCost
    kirija: AnalyticsManualCost
  }
  total_cost_fen: number
  /** `pazar_fen − unpaid_fen − total_cost_fen`. May be negative, and is shown as it is. */
  neto_fen: number
  /** Every day of the month, zeros included, oldest first. */
  days: AnalyticsDay[]
  /** The five days with the biggest pazar, biggest first. Days with none left out. */
  best_days: AnalyticsDay[]
  /** Twelve months ending with this one, oldest first. */
  trend: AnalyticsMonthPoint[]
  /** One entry per active template, in the templates' own order. */
  records: AnalyticsSlotRecords[]
}
