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
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { SankError, conflict, forbidden, notFound, unprocessable } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { businessDate, localTime } from '#shared/dates'
import { toMinutes, windowCovers } from '#shared/shiftSlots'
import type { Settings } from '#shared/settings'
import type { Actor, Db, Queryable, Tx } from './types'
import type {
  CloseResult, MissingSettlement, OwnerShiftRow, Shift, ShiftBrief, ShiftChoices, ShiftStatus,
} from '#shared/types'
import { actorShift, bump, currentShift, getSettings, joinShift, log, verifyPinMetered } from './contracts'
import { expectedCash, withinTolerance } from './cash'
import { writeSummaryVersion } from './summaries'

type ShiftRow = typeof schema.shifts.$inferSelect

/**
 * How long a staff session lives once it is on a shift.
 *
 * Twenty hours is not a guess at a shift's length — it is "longer than any
 * night can be", because what actually ends these sessions is the šanker's
 * *Zaključi smjenu* (`endSessionsOn`). The number is only the backstop for a
 * phone that was never signed out of a shift nobody ever closed.
 */
const SHIFT_SESSION_S = 20 * 60 * 60

/**
 * The hot-path helpers live in `contracts.ts` — every package calls them and a
 * lock must not import a whole service file to open a shift. They are re-exported
 * here so `docs/BACKEND.md` §6.5's export list is true of this file too.
 */
export { actorShift, currentShift, ensureOpenShift, joinShift, nextShiftSeq, openShifts } from './contracts'

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
    template_id: row.templateId,
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
  return briefOn(q, venueId, actorShift(q, venueId, actor), actor.userId)
}

/**
 * The same brief for a person rather than a session — `GET /api/me/shift` has a
 * user id and no need to build an `Actor` around it.
 *
 * With no session to read the pick off, the shift is the open one **this person
 * is on**, found through `shift_members`. That is the same answer the session
 * would have given, one step further round: a worker joins the shift he picked,
 * and nobody is on two open shifts at once.
 */
export function shiftBriefFor(
  q: Queryable, venueId: string, userId: string,
): ShiftBrief | null {
  const mine = q.select({ shift: schema.shifts })
    .from(schema.shiftMembers)
    .innerJoin(schema.shifts, eq(schema.shifts.id, schema.shiftMembers.shiftId))
    .where(and(
      eq(schema.shiftMembers.venueId, venueId),
      eq(schema.shiftMembers.userId, userId),
      inArray(schema.shifts.status, ['open', 'closing']),
    ))
    .orderBy(desc(schema.shifts.openedAt))
    .get()?.shift
  return briefOn(q, venueId, mine ?? currentShift(q, venueId), userId)
}

/** The brief itself, once somebody has decided **which** shift it is about. */
function briefOn(
  q: Queryable, venueId: string, shift: ShiftRow | null, userId: string,
): ShiftBrief | null {
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

/**
 * The tabs still open on a shift, each with its table's name.
 *
 * It reads `tabs` alone and names the table with a LEFT join, because an inner
 * one silently dropped every *Bez stola* tab (PHASE3 §1.11) — and a night that
 * closes with money still on an open tab is the one thing both closes (the
 * drawer count and the šanker's *Zaključi smjenu*) exist to stop.
 */
export function openTabsOn(
  q: Queryable, venueId: string, shiftId: string,
): { tab_id: string, table_name: string }[] {
  return q.select({
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
    .map(t => ({ tab_id: t.id, table_name: t.table }))
}

/** 409 `OPEN_TABS { tabs }` while any tab on the shift is still open. */
export function assertNoOpenTabs(q: Queryable, venueId: string, shiftId: string): void {
  const tabs = openTabsOn(q, venueId, shiftId)
  if (tabs.length > 0) {
    throw new SankError(409, 'OPEN_TABS', 'the shift still has open tabs', { tabs })
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

    assertNoOpenTabs(tx, venueId, shiftId)

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
    endSessionsOn(tx, venueId, shiftId, at)
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
    endSessionsOn(tx, venueId, shiftId, at)
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
/** Σ *naknadni troškovi* per shift, for a list of shifts — one read, not one per row. */
export function shiftExtraCostTotals(
  q: Queryable, venueId: string, shiftIds: string[],
): Map<string, number> {
  if (shiftIds.length === 0) return new Map()
  const rows = q.select({
    shiftId: schema.shiftExtraCosts.shiftId,
    fen: sql<number>`coalesce(sum(${schema.shiftExtraCosts.amountFen}), 0)`,
  })
    .from(schema.shiftExtraCosts)
    .where(and(
      eq(schema.shiftExtraCosts.venueId, venueId),
      inArray(schema.shiftExtraCosts.shiftId, shiftIds),
    ))
    .groupBy(schema.shiftExtraCosts.shiftId)
    .all()
  return new Map(rows.map(r => [r.shiftId, r.fen]))
}

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

  // *Za predati* for every night in the range that the šanker closed — one
  // read for the whole list, not one per row.
  const closings = new Map(
    shifts.length === 0
      ? []
      : q.select({ shiftId: schema.shiftClosings.shiftId, fen: schema.shiftClosings.zaPredatiFen })
          .from(schema.shiftClosings)
          .where(and(
            eq(schema.shiftClosings.venueId, venueId),
            inArray(schema.shiftClosings.shiftId, shifts.map(s => s.id)),
          ))
          .all()
          .map(r => [r.shiftId, r.fen] as const),
  )

  const extraCosts = shiftExtraCostTotals(q, venueId, shifts.map(s => s.id))

  return shifts.map((shift) => {
    const summary = latestSummaryNumbers(q, venueId, shift.id)
    return {
      id: shift.id,
      business_date: shift.businessDate,
      status: shift.status as ShiftStatus,
      opened_at: shift.openedAt,
      template_id: shift.templateId,
      closed_at: shift.closedAt,
      promet_fen: summary.promet,
      diff_fen: summary.diff,
      // Less what was paid out of it afterwards (*Naknadni troškovi*), so the
      // list says what *Smjena* says.
      za_predati_fen: closings.has(shift.id)
        ? closings.get(shift.id)! - (extraCosts.get(shift.id) ?? 0)
        : null,
    }
  })
}

// ===========================================================================
// Internals
// ===========================================================================

/**
 * Everybody still on the shift goes home when the shift does. `left_at_source`
 * says `auto` so the roster can tell a real hand-written end from this one.
 */
export function autoLeave(tx: Tx, venueId: string, shiftId: string, at: string): void {
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

// ===========================================================================
// *Koju smjenu radiš?* — the picker (the owner, 23.09.2026)
// ===========================================================================

/**
 * The minute of the café's own day, 0 at `business_day_start_hour`.
 *
 * The same arithmetic `isEarlyClose` does, and for the same reason: 03:00 is
 * *later* than 23:00 in a café whose day starts at six, and a plain `HH:MM`
 * comparison would call it earlier.
 */
function cafeMinute(hhmm: string, settings: Settings): number {
  const [h, m] = hhmm.split(':').map(Number)
  const raw = (h ?? 0) * 60 + (m ?? 0)
  const start = settings.business_day_start_hour * 60
  return raw < start ? raw + 24 * 60 - start : raw - start
}

/** Every session working a shift right now, by `(shift, mode)`. */
function seatsOn(
  q: Queryable, venueId: string, shiftIds: string[], now: string,
): Map<string, { userId: string, name: string }> {
  if (shiftIds.length === 0) return new Map()
  const rows = q.select({
    shiftId: schema.sessions.shiftId,
    mode: schema.sessions.mode,
    userId: schema.sessions.userId,
    name: schema.users.name,
  })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(
      eq(schema.sessions.venueId, venueId),
      inArray(schema.sessions.shiftId, shiftIds),
      isNull(schema.sessions.revokedAt),
      gte(schema.sessions.expiresAt, now),
    ))
    .all()

  const seats = new Map<string, { userId: string, name: string }>()
  for (const row of rows) {
    if (!row.shiftId || !row.mode) continue
    // First one wins: two phones on one seat is one person with a spare, and
    // the name on the chip should be the one who took it.
    const key = `${row.shiftId}:${row.mode}`
    if (!seats.has(key)) seats.set(key, { userId: row.userId, name: row.name })
  }
  return seats
}

/**
 * `GET /api/auth/shifts` — the chooser's whole screen.
 *
 * **It lists the café's slots, not its shifts.** There are exactly two, they
 * are the owner's own `shift_templates` rows, and a day that ran only the
 * evening still draws both — *"u kafiću su uvijek prva ili druga smjena"*. A
 * tap either joins the one that is running or opens it.
 *
 * A slot is **taken** when somebody else already holds this person's *screen*
 * on it: the first shift is a konobar and a šanker, so Tarik arriving at 07:05
 * takes the šank seat of the shift Nidal opened rather than being pushed into
 * the evening. The seat is a live session, which is the only thing that knows
 * both the shift and the screen.
 */
export function shiftChoices(
  q: Queryable, venueId: string, actor: Actor, now = nowIso(),
): ShiftChoices {
  const settings = getSettings(q, venueId)
  const today = businessDate(now, settings.timezone, settings.business_day_start_hour)
  const nowMinute = cafeMinute(localTime(now, settings.timezone), settings)

  const templates = q.select().from(schema.shiftTemplates)
    .where(and(
      eq(schema.shiftTemplates.venueId, venueId),
      eq(schema.shiftTemplates.active, 1),
    ))
    .orderBy(asc(schema.shiftTemplates.sort), asc(schema.shiftTemplates.name))
    .all()

  const todaysShifts = q.select().from(schema.shifts)
    .where(and(
      eq(schema.shifts.venueId, venueId),
      eq(schema.shifts.businessDate, today),
    ))
    .all()

  /**
   * Which slot a shift belongs to, **adopting** one that names none.
   *
   * A shift already running when this update lands carries no `template_id` —
   * nobody was ever asked. Ignoring it would open a second shift beside it and
   * leave the first as a ghost nobody closes, so it is matched the old way
   * instead: by the window its opening time falls in, exactly as *Smjene* has
   * always drawn it. `pickShift` then writes the slot onto it, and the guess
   * becomes a fact the first time somebody signs in.
   */
  const slotOf = (shift: ShiftRow): string | null => {
    if (shift.templateId) return shift.templateId
    const minute = toMinutes(localTime(shift.openedAt, settings.timezone))
    return templates.find(t => windowCovers(t.startTime, t.endTime, minute))?.id ?? null
  }

  const live = todaysShifts.filter(s => s.status === 'open' || s.status === 'closing')
  const seats = seatsOn(q, venueId, live.map(s => s.id), now)

  const myOpenShifts = new Set(q.select({ shiftId: schema.shiftMembers.shiftId })
    .from(schema.shiftMembers)
    .where(and(
      eq(schema.shiftMembers.venueId, venueId),
      eq(schema.shiftMembers.userId, actor.userId),
      isNull(schema.shiftMembers.leftAt),
    ))
    .all()
    .map(r => r.shiftId))

  return {
    choices: templates.map((template) => {
      const running = live.find(s => slotOf(s) === template.id) ?? null
      const konobar = running ? seats.get(`${running.id}:konobar`) ?? null : null
      const sanker = running ? seats.get(`${running.id}:sanker`) ?? null : null
      const mine = running ? myOpenShifts.has(running.id) : false

      const common = {
        template_id: template.id,
        name: template.name,
        start_time: template.startTime,
        end_time: template.endTime,
        shift_id: running?.id ?? null,
        mine,
        konobar: konobar?.name ?? null,
        sanker: sanker?.name ?? null,
      }

      if (running) {
        // His own seat, or the one his screen needs. An admin holds no seat:
        // he has no `mode`, so nothing can be taken from under him.
        const seat = actor.mode === 'sanker' ? sanker : actor.mode === 'konobar' ? konobar : null
        const taken = seat !== null && seat.userId !== actor.userId
        return { ...common, action: taken ? null : 'join' as const, blocked: taken ? 'zauzeta' as const : null }
      }

      // Closed today already: the crew went home and the night is a record.
      if (todaysShifts.some(s => slotOf(s) === template.id)) {
        return { ...common, action: null, blocked: 'zavrsena' as const }
      }

      const opensAt = cafeMinute(template.startTime, settings) - settings.shift_open_early_min
      if (nowMinute < opensAt) {
        return { ...common, action: null, blocked: 'rano' as const }
      }
      return { ...common, action: 'open' as const, blocked: null }
    }),
  }
}

/**
 * `POST /api/auth/shift` — the tap.
 *
 * One transaction: the slot is re-read here rather than trusted from the
 * screen, because two phones can be looking at the same free seat. The session
 * is what carries the answer afterwards, so a reload lands the worker back on
 * his own crew instead of on the chooser.
 *
 * It answers the shift's id and not the whole `MeContext` on purpose: building
 * that means reading the session back through `auth.ts`, and `contracts.ts`
 * already re-exports two functions **from** this file. The route does it
 * instead, where both halves are already in scope and nothing points in a
 * circle.
 */
export function pickShift(
  db: Db, venueId: string, actor: Actor, templateId: string, now = nowIso(),
): { shift_id: string } {
  return db.transaction((tx) => {
    const choice = shiftChoices(tx, venueId, actor, now).choices
      .find(c => c.template_id === templateId)
    if (!choice) throw notFound('TEMPLATE_NOT_FOUND', `no active shift template ${templateId}`)

    if (choice.action === null) {
      if (choice.blocked === 'zavrsena') throw conflict('SHIFT_DONE', 'that shift is closed for today')
      if (choice.blocked === 'rano') throw conflict('SHIFT_TOO_EARLY', 'that shift has not started yet')
      throw conflict('SHIFT_ROLE_TAKEN', 'somebody already holds that seat')
    }

    let shiftId = choice.shift_id
    if (choice.action === 'open') {
      const settings = getSettings(tx, venueId)
      shiftId = newId()
      tx.insert(schema.shifts).values({
        id: shiftId,
        venueId,
        businessDate: businessDate(now, settings.timezone, settings.business_day_start_hour),
        openedAt: now,
        openedBy: actor.userId,
        templateId,
        // Not auto: somebody walked in and said which shift he is on. That is
        // the opposite of a shift born out of the first lock of the evening.
        autoOpened: 0,
        status: 'open',
        createdAt: now,
      }).run()

      log(tx, venueId, {
        kind: 'shift_opened',
        body: { shift_id: shiftId, user_id: actor.userId, at: now, auto: false },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'shift', id: shiftId },
        shiftId,
      })
    }

    // An adopted shift — one that was already running when the picker arrived —
    // is stamped with the slot the worker just named, so the guess above is
    // made exactly once and *Smjene* stops having to make it at all.
    if (choice.action === 'join') {
      tx.update(schema.shifts)
        .set({ templateId })
        .where(and(
          eq(schema.shifts.venueId, venueId),
          eq(schema.shifts.id, shiftId!),
          isNull(schema.shifts.templateId),
        ))
        .run()
    }

    joinShift(tx, venueId, shiftId!, actor.userId, actor.role, now)

    tx.update(schema.sessions)
      .set({
        shiftId,
        // The session now lasts as long as the shift does: the owner's rule is
        // that a worker signs in once and is asked again only when the šanker
        // closes the night, which revokes these rows outright.
        expiresAt: new Date(Date.parse(now) + SHIFT_SESSION_S * 1000).toISOString(),
        lastSeenAt: now,
      })
      .where(and(
        eq(schema.sessions.id, actor.sessionId),
        eq(schema.sessions.venueId, venueId),
        isNull(schema.sessions.revokedAt),
      ))
      .run()

    bump(tx, venueId, 'shift', shiftId!)
    return { shift_id: shiftId! }
  })
}

/**
 * Everybody on this shift is signed out when it closes.
 *
 * *"Kad je smjena završena, kad šanker zaključi smjenu, traži opet prijavu"* —
 * and only that crew: the other shift may be an hour into its own night, and
 * signing those phones out mid-service would be the handover breaking the
 * thing it exists to fix.
 */
export function endSessionsOn(tx: Tx, venueId: string, shiftId: string, at: string): void {
  tx.update(schema.sessions)
    .set({ revokedAt: at })
    .where(and(
      eq(schema.sessions.venueId, venueId),
      eq(schema.sessions.shiftId, shiftId),
      isNull(schema.sessions.revokedAt),
    ))
    .run()
}
