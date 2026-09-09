/**
 * *Naplati* — money in.
 *
 * `payments` is append-only. A refund is a **negative row** with an
 * `approved_by`, never an edit of the original, so `SUM(amount_fen)` is what was
 * taken and always was, and a trigger refuses a negative row that nobody signed.
 *
 * Two things here are worth reading before changing anything:
 *
 *   - **the duplicate-payment entry is written outside the rejected
 *     transaction.** A `log()` inside the transaction that then throws would be
 *     rolled back with it, and the whole point of that entry is that it survives
 *     the refusal — it is the evidence that two people tried to charge one table.
 *   - **taking money after your own settlement is accepted, not refused.** The
 *     guest has paid; refusing would leave the café with the cash and no row.
 *     The payment is stamped `post_settle`, `expectedCash` reports the movement
 *     separately, and the owner is told (§6.3, open decision 4).
 */
import { and, desc, eq, gt } from 'drizzle-orm'
import { schema } from '../database/client'
import { badRequest, conflict, notFound, unprocessable } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { clampEventAt } from '#shared/dates'
import type { CreatePaymentBody, PaymentMethod, PaymentResult } from '#shared/types'
import type { Actor, Db, Queryable, Tx } from './types'
import { bump, currentShift, getSettings, hasLiveSettlement, joinShift, log } from './contracts'
import { maxSeq } from './changes'
import { emitChange } from '../utils/bus'
import { tabMoney } from './tabs'

type TabRow = typeof schema.tabs.$inferSelect
type AdjustmentRow = typeof schema.lineAdjustments.$inferSelect

/**
 * Which shift a payment belongs to.
 *
 * The tab's own shift while that shift is still taking money — a tab opened at
 * 23:00 and paid at 00:30 is one night's takings, not two. Once it has closed,
 * the money lands on whatever shift is open now, because that is the drawer it
 * physically went into.
 */
export function resolvePaymentShift(
  tx: Tx, venueId: string, tab: TabRow, _clientAtAdj: string,
): string {
  if (tab.shiftId) {
    const shift = tx.select({ status: schema.shifts.status }).from(schema.shifts)
      .where(and(eq(schema.shifts.venueId, venueId), eq(schema.shifts.id, tab.shiftId)))
      .get()
    if (shift && (shift.status === 'open' || shift.status === 'closing')) return tab.shiftId
  }

  const open = currentShift(tx, venueId)
  if (open) return open.id
  if (tab.shiftId) return tab.shiftId
  throw conflict('SHIFT_CLOSED', 'no shift is open and the tab has none')
}

export function createPayment(
  db: Db, venueId: string, actor: Actor, body: CreatePaymentBody,
): PaymentResult {
  /**
   * The refusal that has to leave a trace.
   *
   * Two waiters, one table, one guest: the second phone posts and the tab is
   * already paid. The 409 tells that waiter what happened; the entry tells the
   * owner, and it has to be written **here**, in its own top-level transaction,
   * because the transaction below is the one that throws (§2).
   */
  const preflight = resolveTabFor(db, venueId, body)
  if (preflight && preflight.status === 'paid'
    && !alreadyApplied(db, venueId, body.client_id)) {
    const last = lastPayment(db, venueId, preflight.id)
    db.transaction((tx) => {
      log(tx, venueId, {
        kind: 'pay_duplicate_attempt',
        body: {
          tab_id: preflight.id,
          table_id: preflight.tableId,
          user_id: actor.userId,
          paid_by: last?.paidBy ?? preflight.closedBy ?? actor.userId,
        },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'tab', id: preflight.id },
        shiftId: preflight.shiftId,
      })
    })
    throw conflict('TAB_ALREADY_PAID', `tab ${preflight.id} is already paid`)
  }

  const result = db.transaction((tx) => {
    // The replay lookup is the first statement, before any insert.
    const existing = tx.select().from(schema.payments)
      .where(and(
        eq(schema.payments.venueId, venueId),
        eq(schema.payments.clientId, body.client_id),
      ))
      .get()
    if (existing) return paymentResult(tx, venueId, existing, true)

    const tab = resolveTabFor(tx, venueId, body)
    if (!tab) throw notFound('TAB_NOT_FOUND', 'no tab for that id')
    if (tab.status === 'paid') throw conflict('TAB_ALREADY_PAID', `tab ${tab.id} is already paid`)
    if (tab.status === 'voided') throw conflict('TAB_VOIDED', `tab ${tab.id} is voided`)

    const settings = getSettings(tx, venueId)
    if (!settings.payment_methods.includes(body.method)) {
      throw badRequest('METHOD_NOT_ALLOWED', `${body.method} is not enabled here`)
    }

    const orders = tx.select({
      id: schema.orders.id, clientId: schema.orders.clientId, lockedBy: schema.orders.lockedBy,
    })
      .from(schema.orders)
      .where(and(eq(schema.orders.venueId, venueId), eq(schema.orders.tabId, tab.id)))
      .all()
    const covers = new Set(body.covers_order_client_ids)
    const known = new Set(orders.map(o => o.clientId))
    for (const id of covers) {
      if (!known.has(id)) throw badRequest('INVALID_COVERS', `order ${id} is not on this tab`)
    }

    const money = tabMoney(tx, venueId, tab.id)
    if (body.amount_fen > money.remaining_fen) {
      throw unprocessable('OVERPAY', 'more than what is left to pay', {
        remaining_fen: money.remaining_fen,
      })
    }

    const at = nowIso()
    const clientAt = clampEventAt(body.client_created_at, at, settings.max_sync_lag_h)
    const shiftId = resolvePaymentShift(tx, venueId, tab, clientAt)
    joinShift(tx, venueId, shiftId, actor.userId, actor.role, at)
    const postSettle = hasLiveSettlement(tx, venueId, shiftId, actor.userId)

    const paymentId = newId()
    tx.insert(schema.payments).values({
      id: paymentId,
      venueId,
      tabId: tab.id,
      shiftId,
      clientId: body.client_id,
      method: body.method,
      amountFen: body.amount_fen,
      receivedFen: body.received_fen ?? null,
      tipFen: body.tip_fen,
      coversJson: JSON.stringify(body.covers_order_client_ids),
      paidBy: actor.userId,
      approvedBy: null,
      deviceId: actor.deviceId,
      reversesId: null,
      adjustmentId: null,
      postSettle: postSettle ? 1 : 0,
      clientCreatedAt: body.client_created_at ?? null,
      clientCreatedAtAdj: clientAt,
      createdAt: at,
    }).run()

    // Somebody else's round on this tab that this payment does not claim to
    // cover. Not an error — a table often pays in two halves — but somebody
    // has to look at it before the tab disappears off the floor plan.
    const uncovered = orders.some(o => o.lockedBy !== actor.userId && !covers.has(o.clientId))
    const paidNow = money.remaining_fen - body.amount_fen === 0

    const patch: Partial<typeof schema.tabs.$inferInsert> = {}
    if (uncovered) patch.pendingReview = 1
    if (paidNow) {
      patch.status = 'paid'
      if (tab.status === 'unpaid') {
        // `unpaid → paid`: the original close stands exactly as written, and
        // clearing the review flag is the whole of the change.
        patch.pendingReview = 0
      } else {
        patch.closedAt = at
        patch.closedBy = actor.userId
      }
    }
    if (Object.keys(patch).length > 0) {
      tx.update(schema.tabs).set(patch).where(eq(schema.tabs.id, tab.id)).run()
    }

    if (uncovered) {
      log(tx, venueId, {
        kind: 'pay_uncovered',
        body: { tab_id: tab.id, table_id: tab.tableId, user_id: actor.userId },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'tab', id: tab.id },
        shiftId,
        at,
      })
    }

    if (postSettle) {
      log(tx, venueId, {
        kind: 'late_after_settle',
        body: {
          payment_id: paymentId,
          tab_id: tab.id,
          table_id: tab.tableId,
          user_id: actor.userId,
          amount_fen: body.amount_fen,
          method: body.method,
        },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'payment', id: paymentId },
        shiftId,
        at,
      })
    }

    // `log('payment_taken')` is deliberately not written: thousands a week, and
    // the ledger row *is* the record (PLAN F13).
    bump(tx, venueId, 'table', tab.id)
    bump(tx, venueId, 'shift', shiftId)

    const stored = tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).get()!
    return paymentResult(tx, venueId, stored, false)
  })

  emitChange(venueId, { seq: maxSeq(db, venueId), entity: 'table', entityId: result.tab_id })
  return result
}

/**
 * The reversing row a `from_waiter` refund writes: the waiter physically hands
 * cash back out of his own envelope, so his `waiterExpected` drops by the
 * amount and the row carries a **second** name — the person who decided it.
 *
 * Called only from an adjustment decision, inside its transaction. It is the
 * whole story of that refund: `expectedCash` has no separate term subtracting a
 * post-settlement void, because this negative row is already in term 2 and
 * subtracting again took the money off him twice.
 */
export function insertReversal(
  tx: Tx, venueId: string, adj: AdjustmentRow, approvedBy: string, at: string,
): string {
  const tab = tx.select().from(schema.tabs)
    .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.id, adj.tabId)))
    .get()
  if (!tab) throw notFound('TAB_NOT_FOUND', `tab ${adj.tabId} not found`)

  // Give back what was taken: cash when the guest paid cash, otherwise card.
  const cash = tx.select({ id: schema.payments.id }).from(schema.payments)
    .where(and(
      eq(schema.payments.venueId, venueId),
      eq(schema.payments.tabId, adj.tabId),
      eq(schema.payments.method, 'cash'),
      gt(schema.payments.amountFen, 0),
    ))
    .get()
  const method: PaymentMethod = cash ? 'cash' : 'card'

  const original = tx.select({ id: schema.payments.id }).from(schema.payments)
    .where(and(
      eq(schema.payments.venueId, venueId),
      eq(schema.payments.tabId, adj.tabId),
      eq(schema.payments.method, method),
      gt(schema.payments.amountFen, 0),
    ))
    .orderBy(desc(schema.payments.createdAt))
    .get()

  const id = newId()
  tx.insert(schema.payments).values({
    id,
    venueId,
    tabId: adj.tabId,
    shiftId: resolvePaymentShift(tx, venueId, tab, at),
    // Derived, not minted: a decision carries no client id of its own, and the
    // adjustment can only be decided once.
    clientId: `${adj.id}:reversal`,
    method,
    amountFen: -adj.amountFen,
    receivedFen: null,
    tipFen: 0,
    coversJson: '[]',
    paidBy: adj.requestedBy,
    // The trigger refuses a negative row without one, and that is the point:
    // money going back to a guest is somebody's decision and the row says whose.
    approvedBy,
    deviceId: null,
    reversesId: original?.id ?? null,
    adjustmentId: adj.id,
    postSettle: 0,
    clientCreatedAt: null,
    clientCreatedAtAdj: null,
    createdAt: at,
  }).run()

  log(tx, venueId, {
    kind: 'payment_reversed',
    body: {
      payment_id: id,
      tab_id: adj.tabId,
      table_id: tab.tableId,
      amount_fen: adj.amountFen,
      method,
      adjustment_id: adj.id,
      refund_kind: 'from_waiter',
    },
    actorId: approvedBy,
    ref: { type: 'payment', id },
    shiftId: tab.shiftId,
    at,
  })

  return id
}

// ===========================================================================
// Internals
// ===========================================================================

/** By the phone's own id first, then by the server's. One of the two is required. */
function resolveTabFor(
  q: Queryable, venueId: string, body: CreatePaymentBody,
): TabRow | undefined {
  if (body.tab_client_id) {
    const byClient = q.select().from(schema.tabs)
      .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.clientId, body.tab_client_id)))
      .get()
    if (byClient) return byClient
  }
  if (!body.tab_id) return undefined
  return q.select().from(schema.tabs)
    .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.id, body.tab_id)))
    .get()
}

function alreadyApplied(q: Queryable, venueId: string, clientId: string): boolean {
  return q.select({ id: schema.payments.id }).from(schema.payments)
    .where(and(eq(schema.payments.venueId, venueId), eq(schema.payments.clientId, clientId)))
    .get() !== undefined
}

function lastPayment(q: Queryable, venueId: string, tabId: string) {
  return q.select().from(schema.payments)
    .where(and(
      eq(schema.payments.venueId, venueId),
      eq(schema.payments.tabId, tabId),
      gt(schema.payments.amountFen, 0),
    ))
    .orderBy(desc(schema.payments.createdAt))
    .get()
}

function paymentResult(
  q: Queryable, venueId: string, row: typeof schema.payments.$inferSelect, replay: boolean,
): PaymentResult {
  const tab = q.select().from(schema.tabs).where(eq(schema.tabs.id, row.tabId)).get()!
  const money = tabMoney(q, venueId, row.tabId)
  return {
    payment_id: row.id,
    tab_id: tab.id,
    tab_client_id: tab.clientId,
    tab_status: tab.status,
    total_fen: money.total_fen,
    paid_fen: money.paid_fen,
    remaining_fen: money.remaining_fen,
    // Neither the change nor the tip is the café's money, and neither moves what
    // is still owed.
    change_fen: Math.max(0, (row.receivedFen ?? row.amountFen) - row.amountFen),
    post_settle: row.postSettle === 1,
    already_applied: replay,
  }
}
