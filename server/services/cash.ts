/**
 * The drawer, the envelopes, and the one function that says where the money is.
 *
 * `cash_movements` records every fen that moved **without a guest**: the opening
 * float in, a float handed to a waiter, a payout to a supplier, the owner taking
 * the pazar, a refund out of the drawer. `amount_fen` is always positive and the
 * `type` carries the sign, so `SUM(amount_fen)` per type is readable in a query
 * and no row can be negative by accident.
 *
 * Two of the five types are born `pending` — `payout` and `float_out` — because
 * both are a cash *obligation* landing on somebody. Without the receiver's
 * acknowledgement a bartender could hand himself a shortfall on a colleague's
 * line, and the close would reconcile perfectly.
 */
import { and, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { conflict, forbidden, notFound } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import type { Settings } from '#shared/settings'
import type {
  CashMovement, CashMovementType, ExpectedCash, ExpectedCashWaiter, OpeningFloat, Shift,
} from '#shared/types'
import type { Actor, Db, Queryable, Tx } from './types'
import { getSettings, joinShift, log, bump } from './contracts'
import {
  type AttentionItem, requireApprover, requireOpenShift, requireShift, shiftView, userNames,
} from './shifts'
import { writeSummaryVersion } from './summaries'

type ShiftRow = typeof schema.shifts.$inferSelect
type CashMovementRow = typeof schema.cashMovements.$inferSelect

// ===========================================================================
// Reads
// ===========================================================================

/**
 * What was in the drawer when the night started.
 *
 * The override if an admin typed one; otherwise the previous closed shift's
 * counted cash minus whatever the owner took out of it — the money physically
 * stayed in the till overnight. `null` means nobody has ever told the app, and
 * the venue expectation then uses 0 while saying so, rather than pretending the
 * drawer started empty.
 */
export function openingFloat(q: Queryable, venueId: string, shift: ShiftRow): OpeningFloat {
  if (shift.openingFloatOverrideFen !== null) {
    return { fen: shift.openingFloatOverrideFen, source: 'override' }
  }

  const previous = q.select().from(schema.shifts)
    .where(and(
      eq(schema.shifts.venueId, venueId),
      inArray(schema.shifts.status, ['closed', 'reviewed']),
      isNotNull(schema.shifts.cashCountedFen),
      lt(schema.shifts.openedAt, shift.openedAt),
    ))
    .orderBy(desc(schema.shifts.openedAt))
    .get()
  if (!previous || previous.cashCountedFen === null) return { fen: null, source: 'unknown' }

  const pickedUp = sumMovements(q, venueId, previous.id, 'owner_pickup', 'approved')
  return { fen: previous.cashCountedFen - pickedUp, source: 'derived' }
}

function sumMovements(
  q: Queryable, venueId: string, shiftId: string,
  type: CashMovementType, status: 'pending' | 'approved' | 'rejected',
): number {
  const row = q.select({ fen: sql<number>`coalesce(sum(${schema.cashMovements.amountFen}), 0)` })
    .from(schema.cashMovements)
    .where(and(
      eq(schema.cashMovements.venueId, venueId),
      eq(schema.cashMovements.shiftId, shiftId),
      eq(schema.cashMovements.type, type),
      eq(schema.cashMovements.status, status),
    ))
    .get()
  return row?.fen ?? 0
}

/**
 * What is still owed on a tab.
 *
 * `tabMoney` in `services/tabs.ts` is WP3's and is not in `contracts.ts`, so the
 * two terms of `expectedCash` that need a tab balance carry the formula of §6.2
 * here instead of importing across a package boundary:
 *
 *   total     = Σ charged_fen − Σ applied adjustments
 *   remaining = total − Σ pending void − Σ payments   (reversals are negative)
 */
function tabRemaining(q: Queryable, venueId: string, tabIds: string[]): Map<string, number> {
  const out = new Map<string, number>()
  if (tabIds.length === 0) return out
  for (const id of tabIds) out.set(id, 0)

  const charged = q.select({
    tabId: schema.orders.tabId,
    fen: sql<number>`coalesce(sum(${schema.orderLines.chargedFen}), 0)`,
  })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .where(and(eq(schema.orders.venueId, venueId), inArray(schema.orders.tabId, tabIds)))
    .groupBy(schema.orders.tabId)
    .all()
  for (const row of charged) out.set(row.tabId, (out.get(row.tabId) ?? 0) + row.fen)

  const adjustments = q.select({
    tabId: schema.lineAdjustments.tabId,
    status: schema.lineAdjustments.status,
    kind: schema.lineAdjustments.kind,
    fen: sql<number>`coalesce(sum(${schema.lineAdjustments.amountFen}), 0)`,
  })
    .from(schema.lineAdjustments)
    .where(and(
      eq(schema.lineAdjustments.venueId, venueId),
      inArray(schema.lineAdjustments.tabId, tabIds),
      inArray(schema.lineAdjustments.status, ['applied', 'pending']),
    ))
    .groupBy(schema.lineAdjustments.tabId, schema.lineAdjustments.status, schema.lineAdjustments.kind)
    .all()
  for (const row of adjustments) {
    // An applied adjustment (void or comp) leaves the total; a *pending void*
    // leaves the remaining only — the guest is not asked for money that is
    // about to be cancelled, but the line is still on the tab.
    const counts = row.status === 'applied' || row.kind === 'void'
    if (counts) out.set(row.tabId, (out.get(row.tabId) ?? 0) - row.fen)
  }

  const paid = q.select({
    tabId: schema.payments.tabId,
    fen: sql<number>`coalesce(sum(${schema.payments.amountFen}), 0)`,
  })
    .from(schema.payments)
    .where(and(eq(schema.payments.venueId, venueId), inArray(schema.payments.tabId, tabIds)))
    .groupBy(schema.payments.tabId)
    .all()
  for (const row of paid) out.set(row.tabId, (out.get(row.tabId) ?? 0) - row.fen)

  return out
}

interface Terms {
  float_out_fen: number
  cash_fen: number
  unpaid_fen: number
  void_held_fen: number
  post_settle_lock_fen: number
  post_settle_cash_fen: number
}

function emptyTerms(): Terms {
  return {
    float_out_fen: 0, cash_fen: 0, unpaid_fen: 0,
    void_held_fen: 0, post_settle_lock_fen: 0, post_settle_cash_fen: 0,
  }
}

/**
 * **The one function.** Where is the café's cash right now, and whose pocket is
 * it in?
 *
 * Every waiter term answers exactly one question — *how much cash should be in
 * this person's pocket* — so every term is either cash that moved or a balance
 * he is holding, and **no term is a charge**. All terms are filtered by
 * `venue_id` and `shift_id`; cash movements count only when `approved`.
 *
 *   1 `float_out_fen`         cash the drawer handed him
 *   2 `cash_fen`              cash he took, negative reversals included
 *   3 `unpaid_fen`            what he is answerable for until the owner writes it off
 *   4 `void_held_fen`         a void that has not been granted is still owed
 *   5 `post_settle_lock_fen`  what is owed on tabs he served after signing off
 *   6 `post_settle_cash_fen`  **already inside term 2** — reported, never added
 *
 *   drawer = openingFloat ?? 0 + Σ float_in − Σ payout − Σ float_out − Σ refund
 *   venue  = drawer + Σ waiterExpected
 *
 * Two terms are shaped the way they are because the obvious shape was wrong in
 * a way `venue === drawer + Σ waiters` could not see, both sides moving together:
 *
 *   - Term 5 counts what is **owed on the tab**, not what was charged. Summing
 *     `orders.charged_fen` counts the same money twice the moment anybody pays
 *     that tab in cash, because term 2 counts it again in whoever's row took it.
 *   - There is **no** "subtract a post-settlement `from_waiter` void" term. The
 *     negative `payments` row `insertReversal` already wrote is the whole story
 *     and term 2 sums it; subtracting again took the money off him twice.
 *
 * `tip_fen` and `received_fen` never enter — neither is the café's money.
 * `owner_pickup` never enters: it only drives the *next* shift's float.
 *
 * `userId` narrows `waiters[]` to one person (that is what a settle needs);
 * `venue_expected_fen` and `drawer_expected_fen` always describe the whole shift.
 */
export function expectedCash(
  q: Queryable, venueId: string, shiftId: string, userId?: string, _now?: string,
): ExpectedCash {
  const shift = requireShift(q, venueId, shiftId)
  const float = openingFloat(q, venueId, shift)

  const drawerExpected = (float.fen ?? 0)
    + sumMovements(q, venueId, shiftId, 'float_in', 'approved')
    - sumMovements(q, venueId, shiftId, 'payout', 'approved')
    - sumMovements(q, venueId, shiftId, 'float_out', 'approved')
    - sumMovements(q, venueId, shiftId, 'refund', 'approved')

  const terms = new Map<string, Terms>()
  const term = (id: string): Terms => {
    let t = terms.get(id)
    if (!t) { t = emptyTerms(); terms.set(id, t) }
    return t
  }

  // 1 — cash the drawer handed him.
  for (const row of q.select({
    userId: schema.cashMovements.userId,
    fen: sql<number>`coalesce(sum(${schema.cashMovements.amountFen}), 0)`,
  })
    .from(schema.cashMovements)
    .where(and(
      eq(schema.cashMovements.venueId, venueId),
      eq(schema.cashMovements.shiftId, shiftId),
      eq(schema.cashMovements.type, 'float_out'),
      eq(schema.cashMovements.status, 'approved'),
    ))
    .groupBy(schema.cashMovements.userId)
    .all()) {
    term(row.userId).float_out_fen += row.fen
  }

  // 2 and 6 — cash he took. A reversal is a negative row, so it subtracts here.
  for (const row of q.select({
    userId: schema.payments.paidBy,
    postSettle: schema.payments.postSettle,
    fen: sql<number>`coalesce(sum(${schema.payments.amountFen}), 0)`,
  })
    .from(schema.payments)
    .where(and(
      eq(schema.payments.venueId, venueId),
      eq(schema.payments.shiftId, shiftId),
      eq(schema.payments.method, 'cash'),
    ))
    .groupBy(schema.payments.paidBy, schema.payments.postSettle)
    .all()) {
    const t = term(row.userId)
    t.cash_fen += row.fen
    if (row.postSettle === 1) t.post_settle_cash_fen += row.fen
  }

  // 3 — tabs he marked *nije plaćeno* that the owner has not decided.
  const unpaidTabs = q.select({ id: schema.tabs.id, userId: schema.tabs.unpaidBy })
    .from(schema.tabs)
    .where(and(
      eq(schema.tabs.venueId, venueId),
      eq(schema.tabs.shiftId, shiftId),
      eq(schema.tabs.status, 'unpaid'),
      eq(schema.tabs.pendingReview, 1),
      isNotNull(schema.tabs.unpaidBy),
    ))
    .all()
  const unpaidRemaining = tabRemaining(q, venueId, unpaidTabs.map(t => t.id))
  for (const tab of unpaidTabs) {
    term(tab.userId!).unpaid_fen += unpaidRemaining.get(tab.id) ?? 0
  }

  // 4 — a void he asked for that nobody has granted. A rejected void on a tab
  // the guest already paid is still his: the money is in his pocket and the
  // café says the line stands.
  for (const row of q.select({
    userId: schema.lineAdjustments.requestedBy,
    fen: sql<number>`coalesce(sum(${schema.lineAdjustments.amountFen}), 0)`,
  })
    .from(schema.lineAdjustments)
    .innerJoin(schema.tabs, eq(schema.tabs.id, schema.lineAdjustments.tabId))
    .where(and(
      eq(schema.lineAdjustments.venueId, venueId),
      eq(schema.tabs.shiftId, shiftId),
      eq(schema.lineAdjustments.kind, 'void'),
      eq(schema.lineAdjustments.wasPaid, 0),
      or(
        eq(schema.lineAdjustments.status, 'pending'),
        and(eq(schema.lineAdjustments.status, 'rejected'), eq(schema.tabs.status, 'paid')),
      ),
    ))
    .groupBy(schema.lineAdjustments.requestedBy)
    .all()) {
    term(row.userId).void_held_fen += row.fen
  }

  // 5 — rounds he locked after signing off, counted as what the tab still owes.
  const lateLocks = q.selectDistinct({
    tabId: schema.orders.tabId,
    userId: schema.orders.lockedBy,
  })
    .from(schema.orders)
    .innerJoin(schema.tabs, eq(schema.tabs.id, schema.orders.tabId))
    .where(and(
      eq(schema.orders.venueId, venueId),
      eq(schema.orders.shiftId, shiftId),
      eq(schema.orders.postSettle, 1),
      inArray(schema.tabs.status, ['open', 'unpaid']),
    ))
    .all()
  const lateRemaining = tabRemaining(q, venueId, [...new Set(lateLocks.map(l => l.tabId))])
  for (const lock of lateLocks) {
    term(lock.userId).post_settle_lock_fen += lateRemaining.get(lock.tabId) ?? 0
  }

  // Everybody who has settled gets a row even when every term is zero — the
  // close needs his `settled` flag to know whose envelope is already in.
  const settled = new Set(
    q.select({ userId: schema.waiterSettlements.userId })
      .from(schema.waiterSettlements)
      .where(and(
        eq(schema.waiterSettlements.venueId, venueId),
        eq(schema.waiterSettlements.shiftId, shiftId),
      ))
      .all()
      .map(r => r.userId),
  )
  for (const id of settled) term(id)
  if (userId) term(userId)

  const names = userNames(q, venueId)
  const waiters: ExpectedCashWaiter[] = [...terms.entries()]
    .map(([id, t]) => ({
      user_id: id,
      name: names.get(id) ?? '—',
      // Term 6 is deliberately absent from this sum: it is inside `cash_fen`.
      expected_fen: t.float_out_fen + t.cash_fen + t.unpaid_fen
        + t.void_held_fen + t.post_settle_lock_fen,
      ...t,
      settled: settled.has(id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'bs'))

  const venueExpected = waiters.reduce((sum, w) => sum + w.expected_fen, drawerExpected)

  return {
    venue_expected_fen: venueExpected,
    drawer_expected_fen: drawerExpected,
    opening_float_known: float.source !== 'unknown',
    waiters: userId ? waiters.filter(w => w.user_id === userId) : waiters,
  }
}

/**
 * How much a count or an envelope may be out before somebody has to write a
 * sentence. `baseFen` is what the percentage is a percentage *of*: the venue
 * expectation at a close, the waiter's own expectation at a settle.
 */
export function toleranceFen(baseFen: number, settings: Settings): number {
  return Math.max(
    settings.cash_tolerance_fen,
    Math.round((Math.abs(baseFen) * settings.cash_tolerance_pct) / 100),
  )
}

export function withinTolerance(diffFen: number, baseFen: number, settings: Settings): boolean {
  return Math.abs(diffFen) <= toleranceFen(baseFen, settings)
}

/** One `cash_movements` row with the two names joined. */
export function cashMovementView(q: Queryable, venueId: string, id: string): CashMovement {
  const row = q.select().from(schema.cashMovements)
    .where(and(eq(schema.cashMovements.venueId, venueId), eq(schema.cashMovements.id, id)))
    .get()
  if (!row) throw notFound('MOVEMENT_NOT_FOUND', `cash movement ${id} not found`)
  return toMovement(row, userNames(q, venueId))
}

function toMovement(row: CashMovementRow, names: Map<string, string>): CashMovement {
  return {
    id: row.id,
    type: row.type,
    amount_fen: row.amountFen,
    user_id: row.userId,
    user_name: names.get(row.userId) ?? '—',
    created_by: row.createdBy,
    created_by_name: names.get(row.createdBy) ?? '—',
    reason: row.reason,
    note: row.note,
    status: row.status,
    decided_by: row.decidedBy,
    decided_at: row.decidedAt,
    created_at: row.createdAt,
  }
}

/** Every movement of a shift, or only one person's. */
export function listCashMovements(
  q: Queryable, venueId: string, shiftId: string, userId?: string,
): CashMovement[] {
  const names = userNames(q, venueId)
  return q.select().from(schema.cashMovements)
    .where(and(
      eq(schema.cashMovements.venueId, venueId),
      eq(schema.cashMovements.shiftId, shiftId),
      ...(userId ? [eq(schema.cashMovements.userId, userId)] : []),
    ))
    .orderBy(schema.cashMovements.createdAt)
    .all()
    .map(row => toMovement(row, names))
}

/** The pending `payout` and `float_out` rows — somebody has to say yes or no. */
export function pendingFor(q: Queryable, venueId: string, _now: string): AttentionItem[] {
  const names = userNames(q, venueId)
  return q.select().from(schema.cashMovements)
    .where(and(
      eq(schema.cashMovements.venueId, venueId),
      eq(schema.cashMovements.status, 'pending'),
      inArray(schema.cashMovements.type, ['payout', 'float_out']),
    ))
    .orderBy(schema.cashMovements.createdAt)
    .all()
    .map(row => ({
      kind: row.type === 'payout' ? 'payout' as const : 'float_out' as const,
      ref_type: 'cash_movement' as const,
      ref_id: row.id,
      title_bs: row.type === 'payout'
        ? `Isplata iz kase · ${names.get(row.userId) ?? '—'}`
        : `Pazar iz kase · ${names.get(row.createdBy) ?? '—'} → ${names.get(row.userId) ?? '—'}`,
      amount_fen: row.amountFen,
      at: row.createdAt,
      actions: ['approve', 'reject'] as ('approve' | 'reject' | 'note')[],
    }))
}

// ===========================================================================
// Writes
// ===========================================================================

/**
 * `POST /api/shifts/:id/opening-float` — the admin corrects what the derived
 * float says was in the drawer. Recorded with the number it replaced, because
 * "the float was wrong" is exactly the sentence a missing 50 KM hides behind.
 */
export function setOpeningFloat(
  db: Db, venueId: string, actor: Actor, shiftId: string, body: { fen: number },
): Shift {
  requireAdmin(actor)

  return db.transaction((tx) => {
    const shift = requireOpenShift(tx, venueId, shiftId)
    const before = openingFloat(tx, venueId, shift).fen ?? 0

    tx.update(schema.shifts)
      .set({ openingFloatOverrideFen: body.fen })
      .where(eq(schema.shifts.id, shiftId))
      .run()

    log(tx, venueId, {
      kind: 'float_override',
      body: { shift_id: shiftId, before, after: body.fen },
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
 * `POST /api/shifts/:id/float` — cash into the drawer (`float_in`), or out of it
 * into a waiter's pocket (`float_out`).
 *
 * A `float_out` is born **pending**: it is an obligation landing on somebody
 * else, and it counts towards his expected cash only once he has said he has it
 * — either by tapping *Primio sam* on his own phone or by typing his PIN on the
 * giver's at hand-over.
 */
export function moveFloat(
  db: Db, venueId: string, actor: Actor, shiftId: string,
  body: { type: 'float_in' | 'float_out', user_id: string, amount_fen: number, note?: string },
): CashMovement {
  const at = nowIso()

  return db.transaction((tx) => {
    const settings = getSettings(tx, venueId)
    requireApprover(settings, actor)
    requireOpenShift(tx, venueId, shiftId)

    const target = tx.select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .where(and(
        eq(schema.users.venueId, venueId),
        eq(schema.users.id, body.user_id),
        eq(schema.users.active, 1),
      ))
      .get()
    if (!target) throw notFound('USER_NOT_FOUND', `user ${body.user_id} not found`)

    const id = newId()
    tx.insert(schema.cashMovements).values({
      id,
      venueId,
      shiftId,
      type: body.type,
      amountFen: body.amount_fen,
      userId: body.user_id,
      createdBy: actor.userId,
      reason: null,
      note: body.note ?? null,
      // `float_in` is the drawer receiving; nobody has to acknowledge that.
      status: body.type === 'float_in' ? 'approved' : 'pending',
      decidedBy: body.type === 'float_in' ? actor.userId : null,
      decidedAt: body.type === 'float_in' ? at : null,
      createdAt: at,
    }).run()

    joinShift(tx, venueId, shiftId, actor.userId, actor.role, at)
    joinShift(tx, venueId, shiftId, target.id, target.role, at)

    log(tx, venueId, {
      kind: 'float_moved',
      body: {
        movement_id: id, type: body.type, user_id: body.user_id,
        created_by: actor.userId, amount_fen: body.amount_fen,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'cash_movement', id },
      shiftId,
    })
    bump(tx, venueId, 'shift', shiftId)

    return cashMovementView(tx, venueId, id)
  })
}

/**
 * `POST /api/cash-movements/:id/ack` — *Primio sam*.
 *
 * The receiver's own door to the same `approved` state the decide route reaches.
 * Two doors because there are two situations: he taps it on his own phone, or he
 * types his PIN on the giver's phone at hand-over.
 */
export function acknowledgeFloat(
  db: Db, venueId: string, actor: Actor, movementId: string,
): CashMovement {
  const at = nowIso()

  return db.transaction((tx) => {
    const movement = requireMovement(tx, venueId, movementId)
    if (movement.type !== 'float_out') {
      throw conflict('NOT_PENDING', `cash movement ${movementId} is not a float_out`)
    }
    if (movement.status !== 'pending') {
      throw conflict('ALREADY_DECIDED', `cash movement ${movementId} is already decided`)
    }
    if (movement.userId !== actor.userId) {
      throw forbidden('NOT_RECEIVER', 'only the receiver can acknowledge a float')
    }

    decide(tx, venueId, movement, 'approved', actor, at)
    return cashMovementView(tx, venueId, movementId)
  })
}

/**
 * `POST /api/shifts/:id/payout` — money out of the drawer for a supplier or for
 * change. Born `pending`; `needs_owner` tells the screen straight away that this
 * one is over the owner's threshold and a bartender cannot decide it.
 */
export function requestPayout(
  db: Db, venueId: string, actor: Actor, shiftId: string,
  body: { amount_fen: number, reason: string, note?: string },
): CashMovement & { needs_owner: boolean } {
  const at = nowIso()

  return db.transaction((tx) => {
    const settings = getSettings(tx, venueId)
    requireOpenShift(tx, venueId, shiftId)

    const id = newId()
    tx.insert(schema.cashMovements).values({
      id,
      venueId,
      shiftId,
      type: 'payout',
      amountFen: body.amount_fen,
      userId: actor.userId,
      createdBy: actor.userId,
      reason: body.reason,
      note: body.note ?? null,
      status: 'pending',
      createdAt: at,
    }).run()

    joinShift(tx, venueId, shiftId, actor.userId, actor.role, at)

    log(tx, venueId, {
      kind: 'payout_requested',
      body: {
        movement_id: id, user_id: actor.userId,
        amount_fen: body.amount_fen, reason: body.reason, note: body.note ?? null,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'cash_movement', id },
      shiftId,
    })
    bump(tx, venueId, 'shift', shiftId)

    return {
      ...cashMovementView(tx, venueId, id),
      needs_owner: body.amount_fen > settings.payout_owner_fen,
    }
  })
}

/**
 * `POST /api/cash-movements/:id/decide` — the two types born `pending`, and only
 * those.
 *
 * `float_in`, `owner_pickup` and `refund` are born `approved` (§3.2) and can
 * never reach this route, so 409 `NOT_PENDING` is all this function has to say
 * about them.
 *
 * The self-approval block is keyed on **whose money it is**, not on who wrote
 * the row. Without it a bartender requests a 49,99 KM payout, approves it
 * himself, the drawer expectation drops by exactly that, and the close
 * reconciles perfectly.
 */
export function decideCashMovement(
  db: Db, venueId: string, actor: Actor, movementId: string,
  body: { outcome: 'approved' | 'rejected', note?: string },
): CashMovement {
  const at = nowIso()

  return db.transaction((tx) => {
    const settings = getSettings(tx, venueId)
    const movement = requireMovement(tx, venueId, movementId)

    if (movement.type !== 'payout' && movement.type !== 'float_out') {
      throw conflict('NOT_PENDING', `a ${movement.type} is born approved and is never decided`)
    }
    if (movement.status !== 'pending') {
      throw conflict('ALREADY_DECIDED', `cash movement ${movementId} is already decided`)
    }
    if (movement.userId === actor.userId && actor.role !== 'admin') {
      throw forbidden('SELF_APPROVAL', 'nobody decides his own cash movement')
    }

    if (movement.type === 'payout') {
      if (!settings.payout_approver_roles.includes(actor.role)) {
        throw forbidden('NOT_APPROVER', 'this role does not decide payouts')
      }
      if (movement.amountFen > settings.payout_owner_fen && actor.role !== 'admin') {
        throw forbidden('OWNER_REQUIRED', 'a payout this size is the owner\'s decision')
      }
    } else {
      requireApprover(settings, actor)
    }

    decide(tx, venueId, movement, body.outcome, actor, at, body.note)

    if (movement.type === 'payout') {
      log(tx, venueId, {
        kind: 'payout_decided',
        body: {
          movement_id: movement.id, user_id: movement.userId, approver_id: actor.userId,
          amount_fen: movement.amountFen, outcome: body.outcome,
        },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'cash_movement', id: movement.id },
        shiftId: movement.shiftId,
      })
    }

    return cashMovementView(tx, venueId, movementId)
  })
}

/**
 * `POST /api/shifts/:id/pickup` — the owner takes the pazar out of the drawer.
 *
 * Born `approved` (he is the approver) and deliberately **outside**
 * `expectedCash`: the money left the building, so it is not "expected" anywhere.
 * What it does drive is the *next* shift's derived opening float.
 */
export function pickup(
  db: Db, venueId: string, actor: Actor, shiftId: string,
  body: { amount_fen: number, note?: string },
): CashMovement {
  requireAdmin(actor)
  const at = nowIso()

  return db.transaction((tx) => {
    const shift = requireShift(tx, venueId, shiftId)

    const id = newId()
    tx.insert(schema.cashMovements).values({
      id,
      venueId,
      shiftId,
      type: 'owner_pickup',
      amountFen: body.amount_fen,
      userId: actor.userId,
      createdBy: actor.userId,
      reason: null,
      note: body.note ?? null,
      status: 'approved',
      decidedBy: actor.userId,
      decidedAt: at,
      createdAt: at,
    }).run()

    log(tx, venueId, {
      kind: 'pickup',
      body: { movement_id: id, amount_fen: body.amount_fen, note: body.note ?? null },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'cash_movement', id },
      shiftId,
    })
    // A pickup on a shift that is already closed moves the next float, so the
    // closed shift's numbers get a new version rather than a silent edit.
    if (shift.status === 'closed' || shift.status === 'reviewed') {
      writeSummaryVersion(tx, venueId, shiftId, 'decision', at)
    }
    bump(tx, venueId, 'shift', shiftId)

    return cashMovementView(tx, venueId, id)
  })
}

/**
 * The drawer's half of a refund (`refund_kind='from_drawer'`, §6.4): the guest
 * is handed cash back out of the till rather than out of the waiter's envelope.
 * Born `approved` — the decision that produced it *is* the approval — and it
 * lowers `drawerExpected`.
 *
 * Called from inside WP3's adjustment decision, which owns the transaction.
 */
export function insertRefund(
  tx: Tx, venueId: string, actor: Actor, shiftId: string,
  args: { amountFen: number, adjustmentId?: string, note?: string, at: string },
): string {
  const id = newId()
  tx.insert(schema.cashMovements).values({
    id,
    venueId,
    shiftId,
    type: 'refund',
    amountFen: args.amountFen,
    userId: actor.userId,
    createdBy: actor.userId,
    reason: null,
    note: args.note ?? null,
    status: 'approved',
    decidedBy: actor.userId,
    decidedAt: args.at,
    refType: args.adjustmentId ? 'line_adjustment' : null,
    refId: args.adjustmentId ?? null,
    createdAt: args.at,
  }).run()
  return id
}

// ===========================================================================
// Internals
// ===========================================================================

function requireMovement(q: Queryable, venueId: string, id: string): CashMovementRow {
  const row = q.select().from(schema.cashMovements)
    .where(and(eq(schema.cashMovements.venueId, venueId), eq(schema.cashMovements.id, id)))
    .get()
  if (!row) throw notFound('MOVEMENT_NOT_FOUND', `cash movement ${id} not found`)
  return row
}

/**
 * The one write both doors go through, so `ack` and `decide` can never end in
 * two different states. A decision on a shift that has already closed writes a
 * new summary version: the night's numbers move with it.
 */
function decide(
  tx: Tx, venueId: string, movement: CashMovementRow,
  outcome: 'approved' | 'rejected', actor: Actor, at: string, note?: string,
): void {
  tx.update(schema.cashMovements)
    .set({
      status: outcome,
      decidedBy: actor.userId,
      decidedAt: at,
      ...(note === undefined ? {} : { note }),
    })
    .where(eq(schema.cashMovements.id, movement.id))
    .run()

  const shift = requireShift(tx, venueId, movement.shiftId)
  if (shift.status === 'closed' || shift.status === 'reviewed') {
    writeSummaryVersion(tx, venueId, movement.shiftId, 'decision', at)
  }
  bump(tx, venueId, 'shift', movement.shiftId)
}

function requireAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw forbidden('FORBIDDEN', 'this is the owner\'s to do')
}
