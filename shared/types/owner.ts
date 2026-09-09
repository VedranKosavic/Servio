/**
 * The owner dashboard's read shapes — *Puls*, *Smjena* and the drill-down
 * (`docs/BACKEND.md` §6.10).
 *
 * Two lists and why there are two (§1). `attention[]` holds only rows a tap can
 * clear: every one of them has a decide route behind its buttons, so the owner
 * can always empty it. Everything that is merely *information* — a phone whose
 * clock is wrong, a shift closed an hour early, a device holding rounds — goes
 * into `flags[]`, which is **derived on every read from a time window** and
 * disappears by itself when the condition stops being true. In-app
 * acknowledgement is Korak 3, so Korak 2 must never show the owner a row that
 * nothing can clear; deriving the flags rather than storing them is what makes
 * that true without an `acknowledged_at` column anywhere.
 */
import type { StaleDevice } from './auth'
import type { TableState } from './money'
import type { LineRow, ShiftBrief } from './shifts'

// ---------------------------------------------------------------------------
// The decidable list
// ---------------------------------------------------------------------------

export type AttentionKind =
  | 'void' | 'comp' | 'unpaid_tab' | 'payout' | 'float_out'
  | 'settlement' | 'count' | 'waste'

export type AttentionRefType =
  | 'line_adjustment' | 'tab' | 'cash_movement' | 'waiter_settlement'
  | 'stock_count' | 'waste_event'

export type AttentionAction = 'approve' | 'reject' | 'note'

/**
 * One row of *treba odlučiti*.
 *
 * **Assembled, never queried.** `services/owner.ts` writes no cross-package SQL:
 * it concatenates one `pendingFor(q, venueId, now)` per package — voids and
 * comps from `adjustments.ts`, unpaid tabs from `tabs.ts`, pending `payout` and
 * `float_out` from `cash.ts`, a closing shift's unsettled waiters from
 * `shifts.ts`, envelopes awaiting acceptance from `settlements.ts` — plus the
 * submitted counts `counts.ts` reports. The package that owns the ledger owns
 * the sentence written about it.
 *
 * `at` is when the thing happened, and the screen sorts **oldest first**: a
 * decision that has been waiting an hour belongs above one from a minute ago.
 */
export interface AttentionItem {
  kind: AttentionKind
  ref_type: AttentionRefType
  ref_id: string
  /** "Traži storno · Amar · Sto 7 · 2 × Kafa 4,00 KM" — Bosnian, ready to render. */
  title_bs: string
  amount_fen?: number
  at: string
  actions: AttentionAction[]
}

/**
 * Which route a button on an attention row posts to — the *one-tap target*.
 *
 * It is a table and not a field on the row because a route is code, not data: a
 * path in a payload is a path the server would have to keep honest forever,
 * while a table checked against `ROUTE_ROLES` at test time cannot drift.
 * `owner-live.test.ts` walks every `(ref_type, action)` pair here and asserts it
 * names a declared route — an attention row whose button had nowhere to go
 * would be exactly the un-clearable row §1 forbids.
 *
 * Keyed on `ref_type` rather than `kind` because the ref is what the path
 * carries: `void` and `comp` are two kinds of one `line_adjustment` and go to
 * the same decide route.
 */
export const ATTENTION_ROUTES: Record<
  AttentionRefType, Partial<Record<AttentionAction, string>>
> = {
  line_adjustment: {
    approve: 'POST /api/adjustments/:id/decide',
    reject: 'POST /api/adjustments/:id/decide',
  },
  tab: {
    approve: 'POST /api/tabs/:id/unpaid/decide',
    reject: 'POST /api/tabs/:id/unpaid/decide',
  },
  cash_movement: {
    approve: 'POST /api/cash-movements/:id/decide',
    reject: 'POST /api/cash-movements/:id/decide',
  },
  waiter_settlement: {
    approve: 'POST /api/shifts/:id/settlements/:id/accept',
    // Nobody *approves* a person into settling. The one thing an owner can do
    // about a waiter who has gone home without handing in his envelope is close
    // the shift over him, which records the missing settlements by name.
    note: 'POST /api/shifts/:id/force-close',
  },
  stock_count: {
    // A submitted count is confirmed or left alone; Korak 2 has no reject.
    approve: 'POST /api/stock/counts/:id/confirm',
  },
  waste_event: {
    approve: 'POST /api/stock/waste/:id/approve',
  },
} as const

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
  /** Phones still holding rounds in their outbox. */
  unsent: StaleDevice[]
  pending: { adjustments: number, unpaid: number, payouts: number, settlements: number }
  attention: AttentionItem[]
  flags: Flag[]
  /** The last 20 lines rung up tonight, newest first. */
  last_lines: LineRow[]
  tables: TableState[]
  /** The Dnevnik's newest entry: when it moves, *Puls* fetches `?after=` once. */
  log_max_at: string
}
