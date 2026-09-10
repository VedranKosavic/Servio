/**
 * The owner dashboard's reads: *Puls*, the shift list, *Smjena* and the
 * drill-down (`docs/BACKEND.md` §6.10).
 *
 * Three rules shape this file.
 *
 * **It re-reads nothing.** Every number here comes out of the function that owns
 * the ledger it describes — `summarizeShift` for promet and the per-person
 * strip, `expectedCash` for the cash box, `getTablesState` for the floor plan,
 * `listDevices` for the phones, `shiftLines` for the last rounds. A second
 * hand-written `SELECT sum(charged_fen)` over `order_lines` would be a second
 * definition of promet, and the night the two disagreed nobody would know which
 * one was the café's takings. That is also why `owner-live.test.ts` can assert
 * `live.promet_danas_fen === summary.promet_fen` to the fen: they are the same
 * call.
 *
 * **`attention[]` is assembled, never queried.** Each package exports one
 * `pendingFor(q, venueId, now): AttentionItem[]` over its own tables and writes
 * its own Bosnian sentence; this file concatenates them and sorts by age. The
 * one adapter is `counts.ts`, which deliberately returns a plain row shape (it
 * must not define WP7's type) and is mapped here — its own comment says so.
 *
 * **Two lists, and the second one clears itself.** In-app acknowledgement is
 * Korak 3 (§1), so *Puls* must never show a row that no tap can clear.
 * `attention[]` holds only rows with a decide route; everything informational is
 * a `Flag`, recomputed from a time window on every read and gone the moment the
 * condition ends. Nothing accumulates and no `acknowledged_at` column exists.
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { schema } from '../database/client'
import { nowIso } from '../utils/ids'
import { businessDate } from '#shared/dates'
import type {
  Actor, AttentionAction, AttentionItem, AttentionRefType, Flag, LineRow, LiveCountFen,
  LiveWho, OwnerLive, OwnerShift, OwnerShiftRow, PendingCount, Settings, ShiftSummary,
  StaleDevice, TableState,
} from '#shared/types'
import { ATTENTION_ROUTES } from '#shared/types/owner'
import type { Queryable } from './types'
import { getSettings } from './contracts'
import { expectedCash, pendingFor as cashPending } from './cash'
import { maxSeq, pendingCounts as pendingBadges } from './changes'
import { pendingCounts as submittedCounts } from './counts'
import { listDevices } from './devices'
import { maxAt as logMaxAt, listLog } from './log'
import { pendingFor as adjustmentsPending } from './adjustments'
import { ownerStock } from './reports'
import { pendingFor as settlementsPending } from './settlements'
import {
  hasSubmittedCount, listOwnerShifts as listShifts, pendingFor as shiftsPending, shiftBrief,
} from './shifts'
import {
  getOwnerShift as ownerShift, latestSummary, shiftLines, summarizeShift,
} from './summaries'
import { getTablesState, pendingFor as tabsPending } from './tabs'

// The route files import from here so `api/owner/**` has one import target
// (§6.10); the read itself belongs to the package that owns the ledger.
export { shiftLines } from './summaries'

/**
 * `GET /api/owner/shift/:id` — *Smjena*, with the category names filled in.
 *
 * `latestSummary` joins the names onto the stored numeric JSON; `summarizeShift`,
 * which is what a shift still running folds through, has no reason to and does
 * not. §7 promises this route "with names joined", so the fallback path gets
 * them here rather than leaving *Smjena* to draw a bar chart of blanks on the
 * one night the owner is most likely to be looking at it.
 */
export function getOwnerShift(q: Queryable, venueId: string, shiftId: string): OwnerShift {
  const detail = ownerShift(q, venueId, shiftId)
  return { ...detail, summary: namedSummary(q, venueId, detail.summary) }
}

/** `GET /api/owner/shift/:id/summary` — the written row, or tonight's fold. */
export function ownerShiftSummary(
  q: Queryable, venueId: string, shiftId: string, now = nowIso(),
): ShiftSummary {
  return namedSummary(q, venueId, summaryOf(q, venueId, shiftId, now))
}

/** The stored `by_category` JSON is numeric (§3.2); the names live on `categories`. */
function namedSummary(q: Queryable, venueId: string, summary: ShiftSummary): ShiftSummary {
  if (summary.by_category.every(c => c.name)) return summary

  const names = new Map(
    q.select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .where(eq(schema.categories.venueId, venueId))
      .all()
      .map(c => [c.id, c.name]),
  )
  return {
    ...summary,
    by_category: summary.by_category
      .map(c => ({ ...c, name: c.name ?? names.get(c.category_id) ?? '—' })),
  }
}

/** How many of tonight's rounds *Puls* shows under the numbers. */
const LAST_LINES = 20

/** A shift with more lines than this is paged in `shiftLines`-sized bites. */
const LINES_PAGE = 300

/** A guard on the paging loop below: 30 pages is 9 000 lines, ten busy nights. */
const MAX_LINE_PAGES = 30

// ===========================================================================
// Puls
// ===========================================================================

/**
 * `GET /api/owner/live` — the whole first screen of `/admin`, in one read.
 *
 * **Which shift the numbers describe.** `shift` is the *open* one and is `null`
 * once the night is closed, because that strip is what draws *Zatvori smjenu*.
 * The money below it follows a slightly wider rule — the open shift if there is
 * one, otherwise the newest shift on today's business date — so that an owner
 * who opens *Puls* at half past four, after the bar has closed and before the
 * business day rolls over at 06:00, reads his night instead of a screen of
 * zeros. `promet_danas_fen` is wider still: every shift on today's date, summed
 * exactly the way *Smjena* sums each of them.
 */
export function getLive(
  q: Queryable, venueId: string, actor: Actor, now = nowIso(),
): OwnerLive {
  const settings = getSettings(q, venueId)
  const today = businessDate(now, settings.timezone, settings.business_day_start_hour)

  const focus = focusShift(q, venueId, today)
  const summary = focus ? summaryOf(q, venueId, focus.id, now) : null
  const ec = focus ? expectedCash(q, venueId, focus.id, undefined, now) : null

  const tablesState = getTablesState(q, venueId, actor)
  const devices = listDevices(q, venueId).filter(d => d.revoked_at === null)

  const attention = attentionItems(q, venueId, now)

  return {
    seq: maxSeq(q, venueId),
    shift: shiftBrief(q, venueId, actor),
    promet_danas_fen: prometForDate(q, venueId, today, now),
    open: openTables(tablesState.tables),
    expected_cash_fen: ec?.venue_expected_fen ?? 0,
    storna: pair(summary?.void_count, summary?.void_fen),
    gratis: pair(
      summary?.by_user.reduce((n, u) => n + u.gratis.count, 0),
      summary?.comp_fen,
    ),
    self_voids: pair(summary?.self_void_count, summary?.self_void_fen),
    waste: pair(
      summary?.by_user.reduce((n, u) => n + u.waste.count, 0),
      summary?.waste_fen,
    ),
    who: who(q, venueId, summary, ec?.waiters ?? [], tablesState.tables),
    unsent: unsentDevices(devices),
    pending: pendingBadges(q, venueId),
    attention,
    flags: flags(q, venueId, settings, focus, ec, devices, tablesState.tables, now),
    last_lines: lastLines(q, venueId, focus?.id ?? null),
    tables: tablesState.tables,
    log_max_at: logMaxAt(q, venueId),
  }
}

/**
 * `GET /api/owner/shifts?from&to` — the list of nights.
 *
 * `shifts.ts` reads each row's promet out of the newest `shift_summaries` row
 * and reports 0 when there is none, which is right for a night that was never
 * closed and wrong for the one the café is in the middle of: *Smjene* would
 * print tonight as 0,00 KM until somebody taps *Zatvori smjenu*. So a row with
 * no written summary is folded live here — the same "written row if there is
 * one, otherwise the live fold" rule *Puls* and *Smjena* already follow, so all
 * three screens print one number for one night.
 */
export function listOwnerShifts(
  q: Queryable, venueId: string, from: string, to: string, now = nowIso(),
): OwnerShiftRow[] {
  return listShifts(q, venueId, from, to).map((row) => {
    if (latestSummary(q, venueId, row.id)) return row
    return { ...row, promet_fen: summarizeShift(q, venueId, row.id, now).promet_fen }
  })
}

/**
 * The six `pendingFor()`s and the one adapter, oldest first.
 *
 * Oldest first is the product rule, not a tie-break: a void that has been
 * waiting since half past ten belongs above one from a minute ago, and an owner
 * who works down the list from the top is working down it in the order the
 * people at the bar have been waiting.
 */
export function attentionItems(
  q: Queryable, venueId: string, now = nowIso(),
): AttentionItem[] {
  return [
    ...adjustmentsPending(q, venueId, now),
    ...tabsPending(q, venueId, now),
    ...cashPending(q, venueId, now),
    ...shiftsPending(q, venueId, now),
    ...settlementsPending(q, venueId, now),
    ...submittedCounts(q, venueId).map(countAttention),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/**
 * A submitted count, as a row of the owner's list.
 *
 * `counts.ts` returns a plain `PendingCount` on purpose — it must not declare
 * WP7's type — and its own comment says *Puls* turns each one into an
 * `AttentionItem` with the confirm route behind it. This is that function.
 * A count is confirmed or left alone; Korak 2 has no reject, so one action.
 */
function countAttention(c: PendingCount): AttentionItem {
  const kind = c.kind === 'full' ? 'Popis' : 'Brzi popis'
  return {
    kind: 'count',
    ref_type: 'stock_count',
    ref_id: c.count_id,
    title_bs: `${kind} čeka potvrdu · ${c.counted_by_name}`
      + (c.out_of_tolerance > 0 ? ` · ${c.out_of_tolerance} van tolerancije` : ''),
    amount_fen: c.variance_fen,
    at: c.submitted_at,
    actions: ['approve'],
  }
}

/**
 * The route one button on an attention row posts to, with the ids filled in.
 *
 * The logic moved to `shared/attention.ts` in Phase 2, because `UiAttentionRow`
 * in `/admin` fills the same paths in the browser and one rule must not exist
 * twice. It is re-exported here so every server caller — and
 * `owner-live.test.ts` — keeps importing it from the file that owns *Puls*.
 */
export { attentionTarget } from '#shared/attention'

// ===========================================================================
// The pieces of Puls
// ===========================================================================

/** The open shift, else the newest one on today's business date. */
function focusShift(
  q: Queryable, venueId: string, today: string,
): { id: string, status: string, openedAt: string } | null {
  const open = q.select().from(schema.shifts)
    .where(and(
      eq(schema.shifts.venueId, venueId),
      inArray(schema.shifts.status, ['open', 'closing']),
    ))
    .get()
  if (open) return { id: open.id, status: open.status, openedAt: open.openedAt }

  const last = q.select().from(schema.shifts)
    .where(and(
      eq(schema.shifts.venueId, venueId),
      eq(schema.shifts.businessDate, today),
    ))
    .orderBy(desc(schema.shifts.openedAt))
    .get()
  return last ? { id: last.id, status: last.status, openedAt: last.openedAt } : null
}

/**
 * The written summary if there is one, otherwise the live fold.
 *
 * Exactly what `getOwnerShift` does, and deliberately so: *Puls* and *Smjena*
 * must not be able to print two different prometi for one night.
 */
function summaryOf(q: Queryable, venueId: string, shiftId: string, now: string): ShiftSummary {
  return latestSummary(q, venueId, shiftId) ?? summarizeShift(q, venueId, shiftId, now)
}

/** Every shift on the business date, summed the way *Smjena* sums each one. */
function prometForDate(q: Queryable, venueId: string, date: string, now: string): number {
  return q.select({ id: schema.shifts.id }).from(schema.shifts)
    .where(and(eq(schema.shifts.venueId, venueId), eq(schema.shifts.businessDate, date)))
    .all()
    .reduce((sum, s) => sum + summaryOf(q, venueId, s.id, now).promet_fen, 0)
}

/**
 * The tiles with guests at them, and what those guests still owe.
 *
 * `remaining_fen`, not `total_fen`: a table that has paid half its bill is not
 * an open bill of its full amount, and this number sits next to the cash box.
 */
function openTables(tables: TableState[]): { tables: number, total_fen: number } {
  const open = tables.filter(t => t.tab_id !== null)
  return {
    tables: open.length,
    total_fen: open.reduce((sum, t) => sum + t.remaining_fen, 0),
  }
}

function pair(count: number | undefined, fen: number | undefined): LiveCountFen {
  return { count: count ?? 0, fen: fen ?? 0 }
}

/**
 * *Ko radi* — one row per person on the shift.
 *
 * `promet_fen` comes from the same `by_user` fold the shift summary prints, and
 * `settled` from `expectedCash`, so the strip cannot disagree with either. The
 * roster read is the one plain query in this file: `userNames()` already reads
 * the same three columns for every list of rows in the codebase, and this screen
 * needs `initials` beside the name for the badge.
 */
function who(
  q: Queryable, venueId: string, summary: ShiftSummary | null,
  waiters: { user_id: string, settled: boolean }[], tables: TableState[],
): LiveWho[] {
  if (!summary) return []

  const initials = new Map(
    q.select({ id: schema.users.id, initials: schema.users.initials })
      .from(schema.users)
      .where(eq(schema.users.venueId, venueId))
      .all()
      .map(u => [u.id, u.initials]),
  )
  const settled = new Map(waiters.map(w => [w.user_id, w.settled]))

  const openTabsOf = (userId: string): number =>
    tables.filter(t => t.tab_id !== null && t.assigned_to === userId).length

  return summary.by_user.map(u => ({
    user_id: u.user_id,
    name: u.name,
    initials: initials.get(u.user_id) ?? '',
    joined_at: u.joined_at,
    promet_fen: u.promet_fen,
    open_tabs: openTabsOf(u.user_id),
    settled: settled.get(u.user_id) ?? u.settled_at !== null,
  }))
}

/** Phones that say they are still holding rounds, whatever else is true of them. */
function unsentDevices(devices: ReturnType<typeof listDevices>): StaleDevice[] {
  return devices
    .filter(d => d.pending_count > 0)
    .map(d => ({
      device_id: d.id,
      label: d.label,
      pending_count: d.pending_count,
      last_seen_at: d.last_seen_at,
    }))
}

/**
 * The last rounds rung up tonight, newest first.
 *
 * `shiftLines` pages forward from the oldest line, so the tail costs a walk. It
 * is bounded (`MAX_LINE_PAGES`) rather than unbounded because a runaway loop on
 * a screen that polls every 15 s is the kind of bug that only shows up on the
 * busiest night of the year.
 */
function lastLines(q: Queryable, venueId: string, shiftId: string | null): LineRow[] {
  if (!shiftId) return []

  let rows: LineRow[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_LINE_PAGES; page++) {
    const next = shiftLines(q, venueId, shiftId, {
      kat: 'sve', limit: LINES_PAGE, ...(cursor ? { cursor } : {}),
    })
    rows = [...rows, ...next.rows].slice(-LAST_LINES)
    if (!next.next_cursor) break
    cursor = next.next_cursor
  }
  return rows.reverse()
}

// ===========================================================================
// The flags (§1)
// ===========================================================================

/**
 * Everything that is information rather than a decision, derived fresh.
 *
 * The window is the open shift, or the last 24 hours when none is open — §1's
 * rule, and the reason none of these needs an `acknowledged_at`: a flag is a
 * sentence about the present, and when the present changes the sentence is not
 * written.
 */
function flags(
  q: Queryable, venueId: string, settings: Settings,
  focus: { id: string, status: string, openedAt: string } | null,
  ec: { opening_float_known: boolean } | null,
  devices: ReturnType<typeof listDevices>,
  tables: TableState[],
  now: string,
): Flag[] {
  const out: Flag[] = []
  const since = focus && (focus.status === 'open' || focus.status === 'closing')
    ? focus.openedAt
    : new Date(Date.parse(now) - 24 * 3600 * 1000).toISOString()

  if (focus && ec && !ec.opening_float_known) {
    out.push({
      kind: 'opening_float_unknown',
      title_bs: 'Nije unesen početni polog',
      ref_type: 'shift', ref_id: focus.id, at: focus.openedAt,
    })
  }

  if (focus && !hasSubmittedCount(q, venueId, focus.id, 'open')) {
    out.push({
      kind: 'no_opening_count',
      title_bs: 'Nema početnog popisa robe',
      ref_type: 'shift', ref_id: focus.id, at: focus.openedAt,
    })
  }

  // A phone with rounds in its outbox that has not been heard from in
  // `heartbeat_fresh_s`. It clears itself the next time the phone checks in —
  // which is the whole design: nobody has to remember to tick it off.
  const freshFrom = new Date(Date.parse(now) - settings.heartbeat_fresh_s * 1000).toISOString()
  for (const d of devices) {
    if (d.pending_count > 0 && (d.last_seen_at === null || d.last_seen_at < freshFrom)) {
      out.push({
        kind: 'stale_device',
        title_bs: `Telefon se ne javlja · ${d.label} · ${d.pending_count} neposlanih`,
        ref_type: 'device', ref_id: d.id, at: d.last_seen_at ?? d.enrolled_at,
      })
    }
    if (Math.abs(d.clock_skew_s) > settings.clock_skew_alert_s) {
      out.push({
        kind: 'clock_skew',
        title_bs: `Sat na telefonu nije tačan · ${d.label} · ${d.clock_skew_s} s`,
        ref_type: 'device', ref_id: d.id, at: d.last_seen_at ?? d.enrolled_at,
      })
    }
  }

  // A round somebody else locked that this payment did not claim to cover.
  // `tabs.pendingFor()` already owns the *unpaid* ones as decisions; these are
  // still open at a table, so they are a look-at rather than a decide.
  for (const t of tables) {
    if (t.pending_review && t.tab_id) {
      out.push({
        kind: 'uncovered_payment',
        title_bs: `Naplata čeka · ${t.opened_by_name ?? '—'}`,
        ref_type: 'tab', ref_id: t.tab_id, at: t.last_order_at ?? t.opened_at ?? now,
      })
    }
  }

  // An item nobody has ever priced makes every variance on it worth 0,00 KM, so
  // the closing count says nothing. It clears the moment *Početno stanje* gives
  // it a cost — that is §11's self-clearing case.
  for (const item of ownerStock(q, venueId).items) {
    if (item.status === 'bez_cijene') {
      out.push({
        kind: 'no_item_cost',
        title_bs: `Nema nabavne cijene · ${item.name}`,
        ref_type: 'stock_item', ref_id: item.id, at: since,
      })
    }
  }

  out.push(...logFlags(q, venueId, since))
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/**
 * The three flags that are already sentences in the Dnevnik.
 *
 * They are read back out of `log_entries` rather than recomputed because the
 * entry *is* the record — `log()` wrote it inside the transaction that did the
 * thing — and because its `title_bs` is already the Bosnian the owner should
 * read. The window keeps them from accumulating.
 */
function logFlags(q: Queryable, venueId: string, since: string): Flag[] {
  const out: Flag[] = []

  for (const entry of listLog(q, venueId, { kind: 'cross_waiter_lock', after: since, limit: 20 })
    .entries) {
    out.push({
      kind: 'cross_waiter_lock',
      title_bs: entry.title_bs,
      ref_type: entry.ref_type ?? 'log_entry', ref_id: entry.ref_id ?? entry.id, at: entry.at,
    })
  }

  for (const entry of listLog(q, venueId, { kind: 'late_after_close', after: since, limit: 20 })
    .entries) {
    out.push({
      kind: 'late_after_close',
      title_bs: entry.title_bs,
      ref_type: entry.ref_type ?? 'log_entry', ref_id: entry.ref_id ?? entry.id, at: entry.at,
    })
  }

  for (const entry of listLog(q, venueId, { kind: 'shift_closed', after: since, limit: 20 })
    .entries) {
    if (entry.body.early_close !== true) continue
    out.push({
      kind: 'early_close',
      title_bs: entry.title_bs,
      ref_type: entry.ref_type ?? 'shift', ref_id: entry.ref_id ?? entry.id, at: entry.at,
    })
  }

  return out
}
