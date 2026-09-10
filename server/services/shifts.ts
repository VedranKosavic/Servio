/**
 * The night: opened by the first round, worked by whoever turns up, closed once.
 *
 * A shift is not a calendar day. It is opened by the first lock of the evening
 * (`ensureOpenShift`, in `contracts.ts` because half the app calls it), carries a
 * `business_date` from `shared/dates.ts` — 02:30 belongs to the previous night —
 * and ends when somebody counts the drawer. `shifts_one_open_uq` makes "one open
 * shift per venue" a database rule rather than a hopeful SELECT.
 *
 * The close is the only place in the app where a number the server computed and
 * a number a human counted are put side by side, so it is worth naming what it
 * compares. `expected` is the **drawer plus the waiters who have already handed
 * their envelopes over**; everybody else's expected cash is reported as
 * `outstanding_fen` and is deliberately *not* in the comparison. Comparing the
 * drawer against money that is still in somebody's pocket made every single
 * close a ritual note, which is the fastest way to teach a café to ignore its
 * own alarms.
 */
import { and, count, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { SankError, conflict, forbidden, notFound, unprocessable } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { businessDate, localTime } from '#shared/dates'
import type { Settings } from '#shared/settings'
import type { Actor, Db, Queryable, Tx } from './types'
import type {
  CloseResult, MissingSettlement, OwnerShiftRow, Shift, ShiftBrief, ShiftStatus,
} from '#shared/types'
import { bump, getSettings, joinShift, log, verifyPinMetered } from './contracts'
import { expectedCash, withinTolerance } from './cash'
import { writeSummaryVersion } from './summaries'

type ShiftRow = typeof schema.shifts.$inferSelect

/**
 * The hot-path helpers live in `contracts.ts` — every package calls them and a
 * lock must not import a whole service file to open a shift. They are re-exported
 * here so `docs/BACKEND.md` §6.5's export list is true of this file too.
 */
export { currentShift, ensureOpenShift, joinShift, nextShiftSeq } from './contracts'

/**
 * A row on the owner's *treba odlučiti* list.
 *
 * WP2 declared this shape here because WP7's `shared/types/owner.ts` did not
 * exist yet, and said the declaration would go away when it landed. It has: the
 * type is now the shared one, re-exported from this file so the four packages
 * that import `AttentionItem` from `./shifts` keep importing it from `./shifts`
 * and nothing else moved. The objects they already build satisfy it unchanged —
 * that was the point of writing it out identically.
 */
export type { AttentionItem } from '#shared/types/owner'

// ===========================================================================
// Small shared reads
// ===========================================================================

/** Every name in the venue, once, so a list of rows costs one query and not N. */
export function userNames(q: Queryable, venueId: string): Map<string, string> {
  return new Map(
    q.select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.venueId, venueId))
      .all()
      .map(u => [u.id, u.name]),
  )
}

export function requireShift(q: Queryable, venueId: string, shiftId: string): ShiftRow {
  const row = q.select().from(schema.shifts)
    .where(and(eq(schema.shifts.venueId, venueId), eq(schema.shifts.id, shiftId)))
    .get()
  if (!row) throw notFound('SHIFT_NOT_FOUND', `shift ${shiftId} not found`)
  return row
}

/** A shift that is still taking money. `closing` counts: the envelopes are in flight. */
export function requireOpenShift(q: Queryable, venueId: string, shiftId: string): ShiftRow {
  const shift = requireShift(q, venueId, shiftId)
  if (shift.status !== 'open' && shift.status !== 'closing') {
    throw conflict('SHIFT_CLOSED', `shift ${shiftId} is ${shift.status}`)
  }
  return shift
}

/**
 * The **fine** gate. `ROUTE_ROLES` is the coarse one: it lets an admin and a
 * bartender through the seven approval routes because that is the default
 * `approver_roles`. An owner who drops `bartender` from the setting gets a
 * bartender who is exactly a waiter, and this is where he is turned away.
 */
export function requireApprover(settings: Settings, actor: Actor): void {
  if (!settings.approver_roles.includes(actor.role)) {
    throw forbidden('NOT_APPROVER', 'this role does not approve money')
  }
}

function requireAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw forbidden('FORBIDDEN', 'this is the owner\'s to do')
}

/** The `shifts` row as a screen sees it. */
export function shiftView(q: Queryable, venueId: string, shiftId: string): Shift {
  const row = requireShift(q, venueId, shiftId)
  const names = userNames(q, venueId)
  return {
    id: row.id,
    business_date: row.businessDate,
    status: row.status,
    opened_at: row.openedAt,
    opened_by: row.openedBy,
    opened_by_name: names.get(row.openedBy) ?? '—',
    auto_opened: row.autoOpened === 1,
    stock_custodian_id: row.stockCustodianId,
    closing_started_at: row.closingStartedAt,
    closing_started_by: row.closingStartedBy,
    closed_at: row.closedAt,
    closed_by: row.closedBy,
    closed_kind: row.closedKind,
    opening_float_override_fen: row.openingFloatOverrideFen,
    cash_counted_fen: row.cashCountedFen,
    card_total_fen: row.cardTotalFen,
    closing_note: row.closingNote,
    reviewed_by: row.reviewedBy,
    reviewed_at: row.reviewedAt,
  }
}

/**
 * The strip at the top of every waiter screen, in one read.
 *
 * `my_settled` and `my_open_tabs` are the two fields that make the *Završi
 * smjenu* bar work, and they are why this takes an actor and why the ETag of
 * every envelope carrying it has the user in the tag.
 */
export function shiftBrief(q: Queryable, venueId: string, actor: Actor): ShiftBrief | null {
  return shiftBriefFor(q, venueId, actor.userId)
}

/**
 * The same brief for a person rather than a session — `GET /api/me/shift` has a
 * user id and no need to build an `Actor` around it.
 */
export function shiftBriefFor(
  q: Queryable, venueId: string, userId: string,
): ShiftBrief | null {
  const shift = q.select().from(schema.shifts)
    .where(and(
      eq(schema.shifts.venueId, venueId),
      inArray(schema.shifts.status, ['open', 'closing']),
    ))
    .get()
  if (!shift) return null

  const settled = q.select({ id: schema.waiterSettlements.id })
    .from(schema.waiterSettlements)
    .where(and(
      eq(schema.waiterSettlements.venueId, venueId),
      eq(schema.waiterSettlements.shiftId, shift.id),
      eq(schema.waiterSettlements.userId, userId),
    ))
    .get()

  const openTabs = q.select({ n: count() })
    .from(schema.tabs)
    .where(and(
      eq(schema.tabs.venueId, venueId),
      eq(schema.tabs.status, 'open'),
      eq(schema.tabs.assignedTo, userId),
    ))
    .get()

  const names = userNames(q, venueId)
  return {
    id: shift.id,
    status: shift.status,
    business_date: shift.businessDate,
    closing: shift.status === 'closing',
    closer_name: shift.closingStartedBy ? names.get(shift.closingStartedBy) ?? null : null,
    my_settled: Boolean(settled),
    my_open_tabs: openTabs?.n ?? 0,
  }
}

/** Has this shift got a submitted count of that phase? The close asks about `open`. */
export function hasSubmittedCount(
  q: Queryable, venueId: string, shiftId: string, phase: 'open' | 'close',
): boolean {
  const row = q.select({ id: schema.stockCounts.id })
    .from(schema.stockCounts)
    .where(and(
      eq(schema.stockCounts.venueId, venueId),
      eq(schema.stockCounts.shiftId, shiftId),
      eq(schema.stockCounts.phase, phase),
    ))
    .get()
  return Boolean(row)
}

/**
 * Who is answerable for the stock this shift — whoever submitted its opening
 * count. Written once and never moved: a custodian who changed halfway through
 * the night is two people answering for one closing variance.
 */
export function setCustodian(tx: Tx, venueId: string, shiftId: string, userId: string): void {
  tx.update(schema.shifts)
    .set({ stockCustodianId: userId })
    .where(and(
      eq(schema.shifts.venueId, venueId),
      eq(schema.shifts.id, shiftId),
      isNull(schema.shifts.stockCustodianId),
    ))
    .run()
}

// ===========================================================================
// The night
// ===========================================================================

/**
 * `POST /api/shifts/open` — the explicit open, for the evening somebody wants
 * the shift running before the first guest sits down (an opening count, a float
 * into the drawer). The usual way a shift opens is still the first lock.
 */
export function openShift(db: Db, venueId: string, actor: Actor, _body: unknown): Shift {
  const at = nowIso()

  return db.transaction((tx) => {
    const settings = getSettings(tx, venueId)
    const open = tx.select({ id: schema.shifts.id }).from(schema.shifts)
      .where(and(
        eq(schema.shifts.venueId, venueId),
        inArray(schema.shifts.status, ['open', 'closing']),
      ))
      .get()
    if (open) throw conflict('SHIFT_ALREADY_OPEN', 'a shift is already open')

    const id = newId()
    tx.insert(schema.shifts).values({
      id,
      venueId,
      businessDate: businessDate(at, settings.timezone, settings.business_day_start_hour),
      openedAt: at,
      openedBy: actor.userId,
      autoOpened: 0,
      status: 'open',
      createdAt: at,
    }).run()
    joinShift(tx, venueId, id, actor.userId, actor.role, at)

    log(tx, venueId, {
      kind: 'shift_opened',
      body: { shift_id: id, user_id: actor.userId, at, auto: false },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'shift', id },
      shiftId: id,
    })
    bump(tx, venueId, 'shift', id)

    return shiftView(tx, venueId, id)
  })
}

/**
 * `POST /api/shifts/:id/closing` — *Zatvori smjenu*: stop being a normal night
 * and start collecting envelopes. Reversible on purpose (`closing → open` is an
 * allowed transition): somebody locks one more round and the café is working.
 */
export function startClosing(db: Db, venueId: string, actor: Actor, shiftId: string): Shift {
  const at = nowIso()

  return db.transaction((tx) => {
    const settings = getSettings(tx, venueId)
    requireApprover(settings, actor)
    const shift = requireOpenShift(tx, venueId, shiftId)

    if (shift.status !== 'closing') {
      tx.update(schema.shifts)
        .set({ status: 'closing', closingStartedAt: at, closingStartedBy: actor.userId })
        .where(eq(schema.shifts.id, shiftId))
        .run()
    }
    bump(tx, venueId, 'shift', shiftId)

    return shiftView(tx, venueId, shiftId)
  })
}

/**
 * `POST /api/shifts/:id/close` — the drawer is counted and the night is a record.
 *
 * The PIN is verified **before** the transaction opens, on `db` and not on `tx`:
 * a failed attempt has to survive the rejection, and a row written inside a
 * transaction that then throws is rolled back with it (§2).
 */
export function closeShift(
  db: Db, venueId: string, actor: Actor, shiftId: string,
  body: {
    cash_counted_fen: number, closing_note?: string, pin: string,
    override_no_open_count?: boolean,
  },
): CloseResult {
  const at = nowIso()
  const settings = getSettings(db, venueId)
  requireApprover(settings, actor)
  // The request ip is not on the `Actor` and does not need to be: WP1's limiter
  // keys a PIN attempt on `(device, user)`, and the ip is evidence on the
  // attempt row rather than part of the rule (§5.2, §5.4).
  verifyPinMetered(db, venueId, actor.userId, actor.deviceId, body.pin, {
    ip: '', kind: 'approve', now: at,
  })

  return db.transaction((tx) => {
    const shift = requireOpenShift(tx, venueId, shiftId)

    // The guard reads `tabs` alone and names the table with a LEFT join, because
    // an inner one silently dropped every *Bez stola* tab (PHASE3 §1.11) — and a
    // night that closes with money still on an open tab is the one thing this
    // check exists to stop.
    const openTabs = tx.select({
      id: schema.tabs.id,
      table: sql<string>`coalesce(${schema.tables.name}, 'Bez stola')`,
    })
      .from(schema.tabs)
      .leftJoin(schema.tables, eq(schema.tables.id, schema.tabs.tableId))
      .where(and(
        eq(schema.tabs.venueId, venueId),
        eq(schema.tabs.shiftId, shiftId),
        eq(schema.tabs.status, 'open'),
      ))
      .all()
    if (openTabs.length > 0) {
      throw new SankError(409, 'OPEN_TABS', 'the shift still has open tabs', {
        tabs: openTabs.map(t => ({ tab_id: t.id, table_name: t.table })),
      })
    }

    // PLAN F10 step 4 asks for the **opening** count, not the closing one: what
    // the close needs is a baseline it can measure the night against.
    if (!hasSubmittedCount(tx, venueId, shiftId, 'open')) {
      if (!(actor.role === 'admin' && body.override_no_open_count)) {
        throw conflict('NO_OPEN_COUNT', 'the shift has no opening count')
      }
      log(tx, venueId, {
        kind: 'override',
        body: { what: 'no_open_count', ref_id: shiftId },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'shift', id: shiftId },
        shiftId,
      })
    }

    const ec = expectedCash(tx, venueId, shiftId)
    const expected = ec.waiters.reduce(
      (sum, w) => (w.settled ? sum + w.expected_fen : sum),
      ec.drawer_expected_fen,
    )
    const outstanding = ec.waiters.reduce(
      (sum, w) => (w.settled ? sum : sum + w.expected_fen),
      0,
    )
    const missing: MissingSettlement[] = ec.waiters
      .filter(w => !w.settled)
      .map(w => ({ user_id: w.user_id, name: w.name }))

    const counted = body.cash_counted_fen
    const diff = counted - expected
    const ok = withinTolerance(diff, expected, settings)
    const note = body.closing_note?.trim() ?? ''
    if (!ok && note === '') {
      throw unprocessable('NOTE_REQUIRED', 'a close outside tolerance needs a sentence', {
        expected_fen: expected, counted_fen: counted, diff_fen: diff,
      })
    }

    tx.update(schema.shifts)
      .set({
        status: 'closed',
        closedAt: at,
        closedBy: actor.userId,
        closedKind: 'normal',
        cashCountedFen: counted,
        closingNote: note === '' ? null : note,
      })
      .where(eq(schema.shifts.id, shiftId))
      .run()

    autoLeave(tx, venueId, shiftId, at)
    const version = writeSummaryVersion(tx, venueId, shiftId, 'close', at)
    const summary = latestSummaryNumbers(tx, venueId, shiftId)

    log(tx, venueId, {
      kind: 'shift_closed',
      body: {
        shift_id: shiftId,
        promet_fen: summary.promet,
        cash_fen: summary.cash,
        diff_fen: diff,
        early_close: isEarlyClose(at, settings),
        by_user: settledLines(tx, venueId, shiftId),
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'shift', id: shiftId },
      shiftId,
    })
    bump(tx, venueId, 'shift', shiftId)

    return {
      shift: shiftView(tx, venueId, shiftId),
      summary_version: version,
      missing_settlements: missing,
      outstanding_fen: outstanding,
      expected_fen: expected,
      counted_fen: counted,
      diff_fen: diff,
      within_tolerance: ok,
    }
  })
}

/**
 * `POST /api/shifts/:id/force-close` — admin only, when the night ended badly:
 * a phone died, nobody settled, the tabs are a mess. It skips the tab and count
 * blocks, records no counted cash at all (rather than a lie) and demands a
 * sentence saying what happened.
 */
export function forceClose(
  db: Db, venueId: string, actor: Actor, shiftId: string, body: { note: string },
): CloseResult {
  requireAdmin(actor)
  const at = nowIso()

  return db.transaction((tx) => {
    requireOpenShift(tx, venueId, shiftId)

    const ec = expectedCash(tx, venueId, shiftId)
    const expected = ec.waiters.reduce(
      (sum, w) => (w.settled ? sum + w.expected_fen : sum),
      ec.drawer_expected_fen,
    )
    const outstanding = ec.waiters.reduce((sum, w) => (w.settled ? sum : sum + w.expected_fen), 0)
    const missing: MissingSettlement[] = ec.waiters
      .filter(w => !w.settled)
      .map(w => ({ user_id: w.user_id, name: w.name }))

    tx.update(schema.shifts)
      .set({
        status: 'closed',
        closedAt: at,
        closedBy: actor.userId,
        closedKind: 'forced',
        cashCountedFen: null,
        closingNote: body.note.trim(),
      })
      .where(eq(schema.shifts.id, shiftId))
      .run()

    autoLeave(tx, venueId, shiftId, at)
    const version = writeSummaryVersion(tx, venueId, shiftId, 'close', at)

    log(tx, venueId, {
      kind: 'shift_forced',
      body: {
        shift_id: shiftId,
        note: body.note.trim(),
        missing_user_ids: missing.map(m => m.user_id),
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'shift', id: shiftId },
      shiftId,
    })
    bump(tx, venueId, 'shift', shiftId)

    return {
      shift: shiftView(tx, venueId, shiftId),
      summary_version: version,
      missing_settlements: missing,
      outstanding_fen: outstanding,
      expected_fen: expected,
      counted_fen: null,
      diff_fen: null,
      within_tolerance: true,
    }
  })
}

/**
 * `POST /api/shifts/:id/review` — the morning after: the owner reconciles the
 * card terminal's own total against Σ card payments. A difference is allowed;
 * a difference with no sentence is not.
 */
export function reviewShift(
  db: Db, venueId: string, actor: Actor, shiftId: string,
  body: { card_total_fen?: number, closing_note?: string },
): Shift {
  requireAdmin(actor)
  const at = nowIso()

  return db.transaction((tx) => {
    const shift = requireShift(tx, venueId, shiftId)
    if (shift.status !== 'closed') {
      throw conflict('SHIFT_NOT_CLOSED', `shift ${shiftId} is ${shift.status}`)
    }

    const cardRow = tx.select({ fen: sql<number>`coalesce(sum(${schema.payments.amountFen}), 0)` })
      .from(schema.payments)
      .where(and(
        eq(schema.payments.venueId, venueId),
        eq(schema.payments.shiftId, shiftId),
        eq(schema.payments.method, 'card'),
      ))
      .get()
    const cardPayments = cardRow?.fen ?? 0
    const cardDiff = body.card_total_fen === undefined ? 0 : body.card_total_fen - cardPayments
    const note = body.closing_note?.trim() ?? shift.closingNote?.trim() ?? ''
    if (cardDiff !== 0 && note === '') {
      throw unprocessable('NOTE_REQUIRED', 'a card total that differs needs a sentence', {
        card_payments_fen: cardPayments, card_diff_fen: cardDiff,
      })
    }

    tx.update(schema.shifts)
      .set({
        status: 'reviewed',
        reviewedBy: actor.userId,
        reviewedAt: at,
        ...(body.card_total_fen === undefined ? {} : { cardTotalFen: body.card_total_fen }),
        ...(note === '' ? {} : { closingNote: note }),
      })
      .where(eq(schema.shifts.id, shiftId))
      .run()

    log(tx, venueId, {
      kind: 'shift_reviewed',
      body: {
        shift_id: shiftId,
        card_total_fen: body.card_total_fen ?? null,
        card_diff_fen: cardDiff,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'shift', id: shiftId },
      shiftId,
    })
    bump(tx, venueId, 'shift', shiftId)

    return shiftView(tx, venueId, shiftId)
  })
}

/**
 * `POST /api/shifts/:id/leave` — "I have gone home".
 *
 * A logout is **not** a leave (§5.1): on the shared bar tablet *Promijeni
 * korisnika* happens a dozen times a night and ending Emir's row at 21:40 could
 * never be undone. The trigger allows `left_at` to be set exactly once.
 */
export function leaveShift(
  db: Db, venueId: string, actor: Actor, shiftId: string,
): { left_at: string } {
  const at = nowIso()

  return db.transaction((tx) => {
    const member = tx.select().from(schema.shiftMembers)
      .where(and(
        eq(schema.shiftMembers.venueId, venueId),
        eq(schema.shiftMembers.shiftId, shiftId),
        eq(schema.shiftMembers.userId, actor.userId),
      ))
      .get()
    if (!member) throw notFound('SHIFT_NOT_FOUND', 'you are not on that shift')
    if (member.leftAt) throw conflict('ALREADY_LEFT', 'you have already left this shift')

    tx.update(schema.shiftMembers)
      .set({ leftAt: at, leftAtSource: 'manual' })
      .where(eq(schema.shiftMembers.id, member.id))
      .run()
    bump(tx, venueId, 'shift', shiftId)

    return { left_at: at }
  })
}

// ===========================================================================
// Owner reads
// ===========================================================================

/** `GET /api/owner/shifts?from&to` — one row per night, business dates inclusive. */
export function listOwnerShifts(
  q: Queryable, venueId: string, from: string, to: string,
): OwnerShiftRow[] {
  const shifts = q.select().from(schema.shifts)
    .where(and(
      eq(schema.shifts.venueId, venueId),
      gte(schema.shifts.businessDate, from),
      lte(schema.shifts.businessDate, to),
    ))
    .orderBy(desc(schema.shifts.businessDate), desc(schema.shifts.openedAt))
    .all()

  return shifts.map((shift) => {
    const summary = latestSummaryNumbers(q, venueId, shift.id)
    return {
      id: shift.id,
      business_date: shift.businessDate,
      status: shift.status as ShiftStatus,
      opened_at: shift.openedAt,
      closed_at: shift.closedAt,
      promet_fen: summary.promet,
      diff_fen: summary.diff,
    }
  })
}

/**
 * A `closing` shift's unsettled waiters — the one thing on the owner's list that
 * only the shift knows about. `note` and not `approve`: nobody approves a person
 * into settling, somebody goes and finds him.
 */
export function pendingFor(q: Queryable, venueId: string, now: string): AttentionItem[] {
  const shift = q.select().from(schema.shifts)
    .where(and(eq(schema.shifts.venueId, venueId), eq(schema.shifts.status, 'closing')))
    .get()
  if (!shift) return []

  const ec = expectedCash(q, venueId, shift.id, undefined, now)
  return ec.waiters
    .filter(w => !w.settled && w.expected_fen !== 0)
    .map(w => ({
      kind: 'settlement' as const,
      ref_type: 'waiter_settlement' as const,
      ref_id: `${shift.id}:${w.user_id}`,
      title_bs: `Nije predao pazar · ${w.name}`,
      amount_fen: w.expected_fen,
      at: shift.closingStartedAt ?? shift.openedAt,
      actions: ['note'] as ('approve' | 'reject' | 'note')[],
    }))
}

// ===========================================================================
// Internals
// ===========================================================================

/**
 * Everybody still on the shift goes home when the shift does. `left_at_source`
 * says `auto` so the roster can tell a real hand-written end from this one.
 */
function autoLeave(tx: Tx, venueId: string, shiftId: string, at: string): void {
  tx.update(schema.shiftMembers)
    .set({ leftAt: at, leftAtSource: 'auto' })
    .where(and(
      eq(schema.shiftMembers.venueId, venueId),
      eq(schema.shiftMembers.shiftId, shiftId),
      isNull(schema.shiftMembers.leftAt),
    ))
    .run()
}

/**
 * Is this close more than `early_close_min` before the café's closing time?
 *
 * Both clocks are read in the venue's zone through `shared/dates.ts` and turned
 * into minutes since the business day started, so 03:00 (which is "tomorrow" on
 * a wall clock) is simply a bigger number than 23:00 and the subtraction works
 * with no special case for midnight.
 */
function isEarlyClose(at: string, settings: Settings): boolean {
  const minutesSinceDayStart = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number)
    const raw = (h ?? 0) * 60 + (m ?? 0)
    const start = settings.business_day_start_hour * 60
    return raw < start ? raw + 24 * 60 - start : raw - start
  }
  const closing = minutesSinceDayStart(settings.closing_time)
  const now = minutesSinceDayStart(localTime(at, settings.timezone))
  return closing - now > settings.early_close_min
}

/**
 * One line per envelope already handed in, for the `shift_closed` entry: what
 * the person declared and how far it was from what the ledger expected of him at
 * that moment. `expected_at_declare_fen` is stored on the row precisely so this
 * sentence can still be read months later, after a late void has moved the live
 * number.
 */
function settledLines(
  q: Queryable, venueId: string, shiftId: string,
): { user_id: string, declared_fen: number, diff_fen: number }[] {
  return q.select().from(schema.waiterSettlements)
    .where(and(
      eq(schema.waiterSettlements.venueId, venueId),
      eq(schema.waiterSettlements.shiftId, shiftId),
    ))
    .all()
    .map(row => ({
      user_id: row.userId,
      declared_fen: row.declaredFen,
      diff_fen: row.declaredFen - row.expectedAtDeclareFen,
    }))
}

/** The numbers of the newest `shift_summaries` row, or zeros when there is none. */
function latestSummaryNumbers(
  q: Queryable, venueId: string, shiftId: string,
): { promet: number, cash: number, diff: number | null } {
  const row = q.select().from(schema.shiftSummaries)
    .where(and(
      eq(schema.shiftSummaries.venueId, venueId),
      eq(schema.shiftSummaries.shiftId, shiftId),
    ))
    .orderBy(desc(schema.shiftSummaries.version))
    .get()
  if (!row) return { promet: 0, cash: 0, diff: null }
  return { promet: row.prometFen, cash: row.cashFen, diff: row.diffFen }
}

export type { ShiftRow }
