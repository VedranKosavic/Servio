/**
 * Sync, the Dnevnik and the heartbeat — the shapes WP5 answers with
 * (`docs/BACKEND.md` §4.1, §4.3, §6.9).
 *
 * **On the three placeholder aliases below.** §4.1 types three of the change
 * feed's snapshots as `TablesStateResponse`, `ShiftBrief` and `MeContext`, and
 * those names are shaped by WP3, WP2 and WP1 in *their* fragments — none of
 * which has landed. Rather than pre-empt three other packages' types in this
 * file (which would collide in the barrel the day they land), each is an alias
 * here, in one place, pointing at the shape the server can actually produce
 * today. When the owning package lands its envelope, exactly one line below
 * changes and every caller is a compile error until it agrees.
 */
import type { ChangeEntity } from '../types'
import type { LogKind } from '../logTemplates'
import type { Prep, TableState } from './money'
import type { StockItem } from './stock'

// --- the three forward references -------------------------------------------

/** → WP3's `TablesStateResponse` (§6.2). Korak 1 still answers a bare array. */
export type TablesStateSnapshot = TableState[]

/** → WP2's `ShiftBrief` (§6.5). Until it lands, the columns every screen needs. */
export interface ShiftSnapshot {
  id: string
  business_date: string
  status: 'open' | 'closing' | 'closed' | 'reviewed'
  opened_at: string
}

/** → WP1's `MeContext` (§5.5). A session refresh the phone re-reads on `user`/`device`. */
export type MeSnapshot = Record<string, unknown>

/** → WP4's `StockItemView` (§6.8). Korak 1's `StockItem` is its ancestor. */
export type StockSnapshot = StockItem[]

// --- the change feed --------------------------------------------------------

export interface ChangeRow {
  entity: ChangeEntity
  seq: number
}

/** The four queues the owner and the bartender act on. */
export interface PendingCounts {
  adjustments: number
  unpaid: number
  payouts: number
  settlements: number
}

export interface CountBrief {
  id: string
  status: string
  phase: string
}

/**
 * The answer to `GET /api/changes?since=`.
 *
 * **The rows are keys, never data.** Every snapshot attached here is re-read
 * from the ledgers inside the same request, so a phone that replays an old
 * response cannot apply a stale floor plan over a newer one — it only ever
 * advances the largest `seq` it has seen.
 */
export interface ChangesResult {
  /** The largest seq in this answer; the client's next cursor. */
  seq: number
  /** `since = 0`, or the cursor fell behind the nightly prune: take everything. */
  full: boolean
  changes: ChangeRow[]
  tables_state?: TablesStateSnapshot
  prep?: { seq: number } & Prep
  stock?: StockSnapshot
  counts?: CountBrief[]
  shift?: ShiftSnapshot | null
  /** Admins and bartenders only — the staff floor never sees the queues. */
  pending?: PendingCounts
  /** `MAX(seq)` over `menu` and `settings`: the client refetches `/api/bootstrap`. */
  menu_version?: number
  /** Admins only. */
  log_max_at?: string
  me?: MeSnapshot
}

// --- the Dnevnik ------------------------------------------------------------

export interface LogEntry {
  id: string
  kind: LogKind
  title_bs: string
  body: Record<string, unknown>
  ref_type: string | null
  ref_id: string | null
  actor_id: string | null
  /** A null actor renders as "Sistem". */
  actor_name: string | null
  device_label: string | null
  shift_id: string | null
  business_date: string
  at: string
  resolves_id: string | null
  redacted: boolean
  quiet: boolean
}

/** A decision carries the request it answers, and vice versa. */
export interface LogEntryDetail extends LogEntry {
  /** The `void_requested` this `void_decided` resolved. */
  request?: LogEntry
  /** The `void_decided` that resolved this `void_requested`. */
  resolver?: LogEntry
}

export interface LogQuery {
  /** Keyset cursor, older than this `(created_at, id)` pair. */
  before?: string
  /** Everything newer than this instant — how *Puls* tails the Dnevnik. */
  after?: string
  kind?: LogKind
  group?: string
  actor?: string
  from?: string
  to?: string
  /** Hide the quiet kinds, unless the entry resolves one. */
  important?: boolean
  limit?: number
}

export interface LogListResult {
  /** A decision carries the quiet request it resolved, so *važno* loses nothing. */
  entries: LogEntryDetail[]
  next_cursor?: string
  /** The ETag source for `GET /api/owner/log`, and *Puls*' tail cursor. */
  max_at: string
}

// --- the heartbeat ----------------------------------------------------------

export interface HeartbeatResult {
  server_now: string
  /** device clock − server clock, clamped to ±1 h. Negative: the phone is behind. */
  clock_skew_s: number
  seq: number
  /** The shift is in *closing*: the phone should stop taking new rounds. */
  shift_closing: boolean
  revoked: boolean
}
