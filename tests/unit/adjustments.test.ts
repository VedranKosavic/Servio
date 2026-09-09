/**
 * *Storno* and *gratis*: the ladder, the shelf, and whose cash gives it back.
 *
 * Three groups of assertions here are worth more than the rest.
 *
 * **The ladder falls through, it does not refuse.** A self-void at minute six,
 * on a bowl the bartender has already lit, or past the sixth of the night — none
 * of those is an error. Each one lands as `pending` with the same sheet copy, and
 * the amount stays on the requester's expected cash until somebody decides. A
 * refusal there would teach a waiter to stop asking, which is the opposite of
 * what the whole feature is for.
 *
 * **The shelf mirrors, it does not guess.** A restocked void writes one
 * `sale_storno` per component of the sale, with the same `unit_cost_mfen` the
 * sale carried, so on hand comes back to the number it had before the round and
 * COGS does not drift.
 *
 * **`refund_kind` is the whole of the money.** `none` writes no money row at all.
 * The old design credited the requester automatically on every paid void, which
 * let a waiter collect 50 KM, record it honestly, and have the void hand the
 * 50 KM back to him on paper.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createOrder } from '../../server/services/orders'
import { createPayment } from '../../server/services/payments'
import { decideAdjustment, listPending, requestAdjustment } from '../../server/services/adjustments'
import { expectedCash } from '../../server/services/cash'
import { tabMoney } from '../../server/services/tabs'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { expectReconciled, rawClose, refuses } from '../helpers/shifts'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

const AMAR_PIN = '1111'
const EMIR_PIN = '123456'
const HARIS_PIN = '123456'

const line = (product: string, qty = 1) => ({
  id: randomUUID(), product_id: f.productId(product), qty,
})

function lock(who: string, table: string, lines = [line('Kafa', 1)]) {
  return createOrder(f.db, f.venueId, f.actor(who), {
    client_id: randomUUID(), table_id: f.tableId(table), lines,
  })
}

/** The one line of a round. */
function lineOf(orderId: string): string {
  return f.db.select().from(schema.orderLines)
    .where(eq(schema.orderLines.orderId, orderId)).all()[0]!.id
}

function request(who: string, lineId: string, extra: Record<string, unknown> = {}) {
  return requestAdjustment(f.db, f.venueId, f.actor(who, { device: 'dev-1', bound: true }), {
    client_id: randomUUID(),
    order_line_id: lineId,
    kind: 'void',
    reason: 'wrong_entry',
    ...extra,
  } as Parameters<typeof requestAdjustment>[3])
}

function payCash(who: string, tabId: string, fen: number) {
  return createPayment(f.db, f.venueId, f.actor(who), {
    client_id: randomUUID(),
    tab_id: tabId,
    method: 'cash',
    amount_fen: fen,
    tip_fen: 0,
    covers_order_client_ids: [],
  })
}

function entries(kind: string) {
  return f.db.select().from(schema.logEntries)
    .where(and(eq(schema.logEntries.venueId, f.venueId), eq(schema.logEntries.kind, kind)))
    .all()
}

const stornoRows = () => f.db.select().from(schema.stockMovements)
  .where(eq(schema.stockMovements.type, 'sale_storno')).all()

// ===========================================================================
// Rule 1 — the self-void
// ===========================================================================

describe('the self-void', () => {
  it('applies his own unprepared line inside the window, and puts the goods back', () => {
    f.openShift({ members: ['Amar'] })
    const before = { kafa: f.onHand('Kafa (mljevena)'), secer: f.onHand('Šećer') }
    const order = lock('Amar', 'Sto 7')
    expect(f.onHand('Kafa (mljevena)')).toBe(before.kafa - 7)

    const result = request('Amar', lineOf(order.order_id))

    expect(result.applied).toBe(true)
    expect(result.adjustment.status).toBe('applied')
    expect(result.adjustment.auto).toBe(true)
    expect(result.adjustment.restock).toBe(true)
    expect(result.tab_total_fen).toBe(0)

    // One mirror row per component of the sale, carrying the sale's own cost.
    const sales = f.db.select().from(schema.stockMovements)
      .where(eq(schema.stockMovements.type, 'sale')).all()
    const stornos = stornoRows()
    expect(stornos).toHaveLength(sales.length)
    for (const storno of stornos) {
      const sale = sales.find(s => s.stockItemId === storno.stockItemId)!
      expect(storno.qtyDelta).toBe(-sale.qtyDelta)
      expect(storno.unitCostMfen).toBe(sale.unitCostMfen)
      expect(storno.refType).toBe('line_adjustment')
    }
    expect(f.onHand('Kafa (mljevena)')).toBe(before.kafa)
    expect(f.onHand('Šećer')).toBe(before.secer)
  })

  it('sends a bowl the bartender has already lit to the queue, and restocks nothing', () => {
    f.openShift({ members: ['Amar', 'Emir'] })
    const order = lock('Amar', 'Sto 7')
    f.db.update(schema.orders)
      .set({ preparedAt: f.clock.now(), preparedBy: f.userId('Emir') })
      .where(eq(schema.orders.id, order.order_id))
      .run()

    const result = request('Amar', lineOf(order.order_id))

    expect(result.applied).toBe(false)
    expect(result.adjustment.status).toBe('pending')
    expect(stornoRows()).toHaveLength(0)
    expect(entries('void_requested')).toHaveLength(1)
  })

  it('sends the sixth of the night to the bartender and says the cap was crossed', () => {
    f.openShift({ members: ['Amar'] })
    const tables = ['Sto 1', 'Sto 2', 'Sto 3', 'Sto 4', 'Sto 5']
    for (const table of tables) {
      const order = lock('Amar', table)
      expect(request('Amar', lineOf(order.order_id)).applied).toBe(true)
    }

    const sixth = lock('Amar', 'Sto 6')
    const result = request('Amar', lineOf(sixth.order_id))

    expect(result.applied).toBe(false)
    expect(result.adjustment.status).toBe('pending')
    const capped = entries('self_void_capped')
    expect(capped).toHaveLength(1)
    expect(JSON.parse(capped[0]!.bodyJson).max).toBe(5)
  })

  it('sends a request past the window to the queue', () => {
    f.openShift({ members: ['Amar'] })
    // Locked ten minutes ago. The row is written straight into the ledger,
    // because `orders.created_at` is frozen — `orders_update_guard` allows only
    // `prepared_at`, which is exactly the invariant this test relies on.
    const old = f.lock('Amar', 'Sto 7', [{ product: 'Kafa' }], {
      at: new Date(Date.now() - 600_000).toISOString(),
    })

    expect(request('Amar', old.lineIds[0]!).adjustment.status).toBe('pending')
  })

  it('never applies itself on somebody else\'s line', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    const order = lock('Amar', 'Sto 7')
    const result = request('Lejla', lineOf(order.order_id))
    expect(result.adjustment.status).toBe('pending')
  })
})

// ===========================================================================
// Rules 2 and 3 — the allowance and the PIN
// ===========================================================================

describe('the approver\'s PIN', () => {
  it('a bartender inside his window grants it on the spot', () => {
    f.openShift({ members: ['Amar', 'Emir'] })
    const order = lock('Amar', 'Sto 7')

    const result = request('Lejla', lineOf(order.order_id), {
      approver_user_id: f.userId('Emir'), pin: EMIR_PIN,
    })

    expect(result.applied).toBe(true)
    expect(result.adjustment.auto).toBe(false)
    expect(result.adjustment.approved_by).toBe(f.userId('Emir'))
    // Lejla's phone, Emir's PIN: allowed, and always recorded.
    expect(f.db.select().from(schema.lineAdjustments).get()!.foreignDevice).toBe(1)
  })

  it('a bartender past his window falls through to pending, not to an error', () => {
    f.openShift({ members: ['Amar', 'Emir'] })
    const old = f.lock('Amar', 'Sto 7', [{ product: 'Kafa' }], {
      at: new Date(Date.now() - 3_600_000).toISOString(),
    })

    const result = request('Lejla', old.lineIds[0]!, {
      approver_user_id: f.userId('Emir'), pin: EMIR_PIN,
    })
    expect(result.adjustment.status).toBe('pending')
  })

  it('refuses a waiter approving his own request', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')
    f.settingsWith({ approver_roles: ['admin', 'bartender', 'waiter'] })

    refuses(() => request('Amar', lineOf(order.order_id), {
      approver_user_id: f.userId('Amar'), pin: AMAR_PIN,
    }), 'SELF_APPROVAL', 403)
  })

  it('refuses the owner\'s PIN on somebody else\'s phone', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')

    refuses(() => requestAdjustment(
      f.db, f.venueId, f.actor('Lejla', { device: 'lejla-phone', bound: true }), {
        client_id: randomUUID(),
        order_line_id: lineOf(order.order_id),
        kind: 'void',
        reason: 'wrong_entry',
        approver_user_id: f.userId('Haris'),
        pin: HARIS_PIN,
      }), 'ADMIN_PIN_FOREIGN_DEVICE', 403)

    // The refusal writes no adjustment — and the attempt row the PIN check makes
    // lives in its own transaction, so it survives (auth.test.ts pins that).
    expect(f.db.select().from(schema.lineAdjustments).all()).toHaveLength(0)
  })

  it('a wrong PIN leaves no adjustment', () => {
    f.openShift({ members: ['Amar', 'Emir'] })
    const order = lock('Amar', 'Sto 7')

    refuses(() => request('Lejla', lineOf(order.order_id), {
      approver_user_id: f.userId('Emir'), pin: '999999',
    }), 'INVALID_PIN', 401)
    expect(f.db.select().from(schema.lineAdjustments).all()).toHaveLength(0)
  })
})

describe('a gratis', () => {
  it('a staff drink inside the allowance authorises itself', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7', [line('Voda 0,5 l', 1)])

    const result = request('Amar', lineOf(order.order_id), {
      kind: 'comp', reason: 'staff_drink',
    })

    expect(result.applied).toBe(true)
    expect(result.adjustment.auto).toBe(true)
    // A comp never puts anything back on the shelf: the water was drunk.
    expect(result.adjustment.restock).toBe(false)
    expect(stornoRows()).toHaveLength(0)
    expect(result.tab_total_fen).toBe(0)
  })

  it('anything else waits for a decision', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7', [line('Red Bull', 1)])

    const result = request('Amar', lineOf(order.order_id), {
      kind: 'comp', reason: 'promo',
    })
    expect(result.adjustment.status).toBe('pending')
    expect(entries('comp_requested')).toHaveLength(1)
    expect(result.tab_total_fen).toBe(500)
  })
})

// ===========================================================================
// One live adjustment per line, and one replay
// ===========================================================================

describe('one line, one adjustment', () => {
  it('refuses a second live request on the same line', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    const order = lock('Amar', 'Sto 7')
    request('Lejla', lineOf(order.order_id))

    refuses(() => request('Lejla', lineOf(order.order_id)), 'LINE_ALREADY_ADJUSTED', 409)
  })

  it('a replayed client_id answers with the stored row', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    const order = lock('Amar', 'Sto 7')
    const clientId = randomUUID()
    const body = {
      client_id: clientId,
      order_line_id: lineOf(order.order_id),
      kind: 'void' as const,
      reason: 'wrong_entry' as const,
    }

    const first = requestAdjustment(f.db, f.venueId, f.actor('Lejla'), body)
    const second = requestAdjustment(f.db, f.venueId, f.actor('Lejla'), body)

    expect(second.adjustment.id).toBe(first.adjustment.id)
    expect(second.already_applied).toBe(true)
    expect(f.db.select().from(schema.lineAdjustments).all()).toHaveLength(1)
  })
})

// ===========================================================================
// The decision
// ===========================================================================

describe('decideAdjustment', () => {
  function pending() {
    f.openShift({ members: ['Amar', 'Emir'] })
    const order = lock('Amar', 'Sto 7')
    const result = request('Lejla', lineOf(order.order_id))
    return { order, adjustmentId: result.adjustment.id }
  }

  it('applies it, restocks and links the decision to the request', () => {
    const before = f.onHand('Kafa (mljevena)')
    const { adjustmentId } = pending()
    expect(f.onHand('Kafa (mljevena)')).toBe(before - 7)

    const result = decideAdjustment(f.db, f.venueId, f.adminActor(), adjustmentId, {
      outcome: 'applied',
    })

    expect(result.adjustment.status).toBe('applied')
    expect(result.tab_total_fen).toBe(0)
    expect(f.onHand('Kafa (mljevena)')).toBe(before)

    const decided = entries('void_decided')
    expect(decided).toHaveLength(1)
    expect(decided[0]!.resolvesId).toBe(entries('void_requested')[0]!.id)
  })

  it('rejects it, and the line stays on the tab', () => {
    const { adjustmentId } = pending()
    const result = decideAdjustment(f.db, f.venueId, f.adminActor(), adjustmentId, {
      outcome: 'rejected', note: 'kafa je popijena',
    })
    expect(result.adjustment.status).toBe('rejected')
    expect(result.tab_total_fen).toBe(150)
    expect(stornoRows()).toHaveLength(0)

    // The requester's own sentence is frozen by `line_adjustments_update_guard`,
    // so the decider's words go into the Dnevnik rather than over the request.
    expect(result.adjustment.note).toBeNull()
    expect(JSON.parse(entries('void_decided')[0]!.bodyJson).decided_note)
      .toBe('kafa je popijena')
  })

  it('decides once and no more', () => {
    const { adjustmentId } = pending()
    decideAdjustment(f.db, f.venueId, f.adminActor(), adjustmentId, { outcome: 'applied' })
    refuses(() => decideAdjustment(f.db, f.venueId, f.adminActor(), adjustmentId, {
      outcome: 'rejected',
    }), 'ALREADY_DECIDED', 409)
  })

  it('refuses the requester deciding his own', () => {
    f.openShift({ members: ['Amar', 'Emir'] })
    const order = lock('Amar', 'Sto 7')
    const result = request('Emir', lineOf(order.order_id))
    // Emir is a bartender and an approver — and still not his own.
    refuses(() => decideAdjustment(
      f.db, f.venueId, f.actor('Emir', { device: 'dev-1', bound: true }),
      result.adjustment.id, { outcome: 'applied' },
    ), 'SELF_APPROVAL', 403)
  })

  it('refuses a waiter deciding anybody\'s', () => {
    const { adjustmentId } = pending()
    refuses(() => decideAdjustment(f.db, f.venueId, f.actor('Tarik'), adjustmentId, {
      outcome: 'applied',
    }), 'FORBIDDEN', 403)
  })

  it('refuses a bartender once his window has passed — "Ide vlasniku"', () => {
    f.openShift({ members: ['Amar', 'Emir'] })
    const old = f.lock('Amar', 'Sto 7', [{ product: 'Kafa' }], {
      at: new Date(Date.now() - 3_600_000).toISOString(),
    })
    const adjustmentId = request('Lejla', old.lineIds[0]!).adjustment.id

    refuses(() => decideAdjustment(
      f.db, f.venueId, f.actor('Emir', { device: 'dev-1', bound: true }),
      adjustmentId, { outcome: 'applied' },
    ), 'WINDOW_EXPIRED', 403)

    // …and the owner still can.
    expect(decideAdjustment(f.db, f.venueId, f.adminActor(), adjustmentId, {
      outcome: 'applied',
    }).adjustment.status).toBe('applied')
  })

  it('refuses an admin deciding from a phone that is not his', () => {
    const { adjustmentId } = pending()
    refuses(() => decideAdjustment(
      f.db, f.venueId, f.actor('Haris', { device: 'amar-phone' }),
      adjustmentId, { outcome: 'applied' },
    ), 'ADMIN_FOREIGN_DEVICE', 403)
  })

  it('lets the approver flip what the reason said about the shelf', () => {
    const before = f.onHand('Kafa (mljevena)')
    const { adjustmentId } = pending()
    decideAdjustment(f.db, f.venueId, f.adminActor(), adjustmentId, {
      outcome: 'applied', restock: false,
    })
    // `wrong_entry` suggested a restock; the owner knows the coffee was poured.
    expect(f.onHand('Kafa (mljevena)')).toBe(before - 7)
    expect(stornoRows()).toHaveLength(0)
  })
})

describe('listPending', () => {
  it('shows an admin everything and a waiter only his own', () => {
    f.openShift({ members: ['Amar', 'Lejla', 'Emir'] })
    const a = lock('Amar', 'Sto 1')
    const b = lock('Lejla', 'Sto 2')
    request('Emir', lineOf(a.order_id))
    request('Tarik', lineOf(b.order_id))

    expect(listPending(f.db, f.venueId, f.adminActor())).toHaveLength(2)
    const tarik = listPending(f.db, f.venueId, f.actor('Tarik'))
    expect(tarik).toHaveLength(1)
    expect(tarik[0]!.requested_by_name).toBe('Tarik')
    expect(tarik[0]!.can_decide).toBe(false)
    expect(listPending(f.db, f.venueId, f.adminActor())[0]!.line_name).toBe('Kafa')
  })
})

// ===========================================================================
// Whose cash gives it back — §11's reconciliation cases
// ===========================================================================

describe('a void on a tab the guest already paid', () => {
  /** Amar serves and collects 300 in cash; Lejla asks for the line to go. */
  function paidAndPending() {
    const shiftId = f.openShift({ members: ['Amar', 'Lejla', 'Emir'] })
    const order = lock('Amar', 'Sto 7')
    payCash('Amar', order.tab_id, 150)
    const result = request('Lejla', lineOf(order.order_id))
    expect(result.adjustment.was_paid).toBe(true)
    return { shiftId, order, adjustmentId: result.adjustment.id }
  }

  it('keeps the money in the requester\'s expected while it is pending', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Lejla'] })
    const order = lock('Amar', 'Sto 7')
    const result = request('Lejla', lineOf(order.order_id))
    expect(result.adjustment.status).toBe('pending')

    const ec = expectedCash(f.db, f.venueId, shiftId)
    const lejla = ec.waiters.find(w => w.name === 'Lejla')!
    // A void nobody has granted is still owed: "5,00 KM ostaje u tvom pazaru".
    expect(lejla.void_held_fen).toBe(150)
    expectReconciled(ec)
  })

  it('with refund `none` moves nobody\'s cash', () => {
    const { shiftId, adjustmentId } = paidAndPending()
    const before = expectedCash(f.db, f.venueId, shiftId)

    decideAdjustment(f.db, f.venueId, f.adminActor(), adjustmentId, {
      outcome: 'applied', refund: 'none',
    })

    const after = expectedCash(f.db, f.venueId, shiftId)
    expect(after.venue_expected_fen).toBe(before.venue_expected_fen)
    expect(after.waiters.find(w => w.name === 'Amar')!.cash_fen).toBe(300 - 150)
    expect(f.db.select().from(schema.payments).all().filter(p => p.amountFen < 0)).toHaveLength(0)
    expect(f.db.select().from(schema.cashMovements).all()).toHaveLength(0)
    expectReconciled(after)
  })

  it('with `from_waiter` writes the reversal, signed by a second name', () => {
    const { shiftId, adjustmentId } = paidAndPending()
    // Lejla has no term at all yet: a `was_paid` void is not `void_held`.
    const before = expectedCash(f.db, f.venueId, shiftId)
      .waiters.find(w => w.name === 'Lejla')?.expected_fen ?? 0

    decideAdjustment(f.db, f.venueId, f.adminActor(), adjustmentId, {
      outcome: 'applied', refund: 'from_waiter',
    })

    const reversal = f.db.select().from(schema.payments).all().find(p => p.amountFen < 0)!
    expect(reversal.amountFen).toBe(-150)
    expect(reversal.method).toBe('cash')
    expect(reversal.paidBy).toBe(f.userId('Lejla'))
    // A trigger refuses a negative row without one, and that is the point.
    expect(reversal.approvedBy).toBe(f.userId('Haris'))
    expect(reversal.approvedBy).not.toBe(reversal.paidBy)
    expect(reversal.adjustmentId).toBe(adjustmentId)

    const after = expectedCash(f.db, f.venueId, shiftId)
    const lejla = after.waiters.find(w => w.name === 'Lejla')!
    // Exactly once. The double subtraction the old sixth term made was invisible
    // to a sign test, so assert the number.
    expect(lejla.expected_fen).toBe(before - 150)
    expect(lejla.cash_fen).toBe(-150)
    expect(entries('payment_reversed')).toHaveLength(1)
    expectReconciled(after)
  })

  it('with `from_drawer` the till drops instead of the waiter', () => {
    const { shiftId, adjustmentId } = paidAndPending()
    const before = expectedCash(f.db, f.venueId, shiftId)

    decideAdjustment(f.db, f.venueId, f.adminActor(), adjustmentId, {
      outcome: 'applied', refund: 'from_drawer',
    })

    const after = expectedCash(f.db, f.venueId, shiftId)
    expect(after.drawer_expected_fen).toBe(before.drawer_expected_fen - 150)
    expect(after.waiters.find(w => w.name === 'Amar')!.cash_fen).toBe(150)
    const movement = f.db.select().from(schema.cashMovements).get()!
    expect(movement.type).toBe('refund')
    expect(movement.amountFen).toBe(150)
    expect(movement.status).toBe('approved')
    expect(entries('payment_reversed')).toHaveLength(1)
    expectReconciled(after)
  })

  it('mirrors the money on the Telegram rail and the Dnevnik', () => {
    const { adjustmentId } = paidAndPending()
    decideAdjustment(f.db, f.venueId, f.adminActor(), adjustmentId, { outcome: 'applied' })

    const keys = f.db.select().from(schema.alertEvents).all().map(a => a.ruleKey)
    expect(keys).toContain('void_after_payment')
  })

  it('after the shift has closed, the night gets a new version of its numbers', () => {
    const { shiftId, adjustmentId } = paidAndPending()
    rawClose(f, shiftId, { countedFen: 150 })
    const before = f.db.select().from(schema.shiftSummaries)
      .where(eq(schema.shiftSummaries.shiftId, shiftId)).all().length

    decideAdjustment(f.db, f.venueId, f.adminActor(), adjustmentId, {
      outcome: 'applied', refund: 'from_waiter',
    })

    const versions = f.db.select().from(schema.shiftSummaries)
      .where(eq(schema.shiftSummaries.shiftId, shiftId)).all()
    expect(versions.length).toBe(before + 1)
    expect(versions.at(-1)!.reason).toBe('decision')
  })

  it('after the requester has settled, his derived diff moves by the amount', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Lejla'] })
    const order = lock('Amar', 'Sto 7')
    payCash('Lejla', order.tab_id, 150)
    const result = request('Lejla', lineOf(order.order_id))
    f.settle('Lejla', { declaredFen: 150, expectedFen: 150 })

    const before = expectedCash(f.db, f.venueId, shiftId)
      .waiters.find(w => w.name === 'Lejla')!.expected_fen

    decideAdjustment(f.db, f.venueId, f.adminActor(), result.adjustment.id, {
      outcome: 'applied', refund: 'from_waiter',
    })

    const after = expectedCash(f.db, f.venueId, shiftId)
    const lejla = after.waiters.find(w => w.name === 'Lejla')!
    // The reversal row is the whole story: `expectedCash` has no second term
    // subtracting a post-settlement void, and this asserts the exact number
    // rather than the direction, because the double subtraction had the right
    // sign.
    expect(lejla.expected_fen).toBe(before - 150)
    // The signed settlement itself is untouched — it is what he declared.
    const settlement = f.db.select().from(schema.waiterSettlements).get()!
    expect(settlement.declaredFen).toBe(150)
    expect(settlement.expectedAtDeclareFen).toBe(150)
    expectReconciled(after)
  })
})

describe('atomicity', () => {
  it('a decision that throws leaves the row pending and the shelf untouched', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    const before = f.onHand('Kafa (mljevena)')
    const order = lock('Amar', 'Sto 7')
    const result = request('Lejla', lineOf(order.order_id))

    /**
     * Make the **last** write of the decision fail, so everything before it has
     * already been written when it does. `insertReversal` derives its client id
     * from the adjustment (`<id>:reversal`), and `payments_client_uq` is unique
     * — so a row already sitting on that key makes the reversal throw after the
     * status update and after the storno rows.
     */
    f.db.insert(schema.payments).values({
      id: randomUUID(),
      venueId: f.venueId,
      tabId: order.tab_id,
      shiftId: f.db.select().from(schema.shifts).get()!.id,
      clientId: `${result.adjustment.id}:reversal`,
      method: 'cash',
      amountFen: 1,
      paidBy: f.userId('Amar'),
      createdAt: f.clock.now(),
    }).run()

    expect(() => decideAdjustment(f.db, f.venueId, f.adminActor(), result.adjustment.id, {
      outcome: 'applied', refund: 'from_waiter',
    })).toThrow()

    const row = f.db.select().from(schema.lineAdjustments).get()!
    expect(row.status).toBe('pending')
    expect(row.decidedAt).toBeNull()
    expect(stornoRows()).toHaveLength(0)
    expect(f.onHand('Kafa (mljevena)')).toBe(before - 7)
  })
})

describe('a void on a comped line', () => {
  it('moves nothing, because there was nothing to move', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    const order = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [{ id: randomUUID(), product_id: f.productId('Voda 0,5 l'), qty: 1,
        comp_reason: 'staff_drink' }],
    })
    expect(tabMoney(f.db, f.venueId, order.tab_id).total_fen).toBe(0)

    const result = request('Lejla', lineOf(order.order_id))
    expect(result.adjustment.amount_fen).toBe(0)
    expect(result.tab_total_fen).toBe(0)
  })
})
