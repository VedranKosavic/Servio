/**
 * *Naplati* — money in, and the four ways it is allowed to go wrong.
 *
 * The two tests that carry the most weight are the ones about things that
 * **survive a refusal**: a second waiter charging a table somebody else already
 * closed must get a 409 *and* leave an entry, because the 409 tells him and the
 * entry tells the owner; and an overpay must leave nothing at all, because a
 * rejected transaction that wrote a row is a rejected transaction that charged
 * a guest.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createOrder } from '../../server/services/orders'
import { createPayment } from '../../server/services/payments'
import { markUnpaid, tabMoney } from '../../server/services/tabs'
import { expectedCash } from '../../server/services/cash'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { expectReconciled, refuses } from '../helpers/shifts'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

const line = (product: string, qty = 1) => ({
  id: randomUUID(), product_id: f.productId(product), qty,
})

function lock(who: string, table: string, lines = [line('Kafa', 2)]) {
  return createOrder(f.db, f.venueId, f.actor(who), {
    client_id: randomUUID(), table_id: f.tableId(table), lines,
  })
}

function pay(who: string, opts: {
  tabId?: string, tabClientId?: string, fen: number,
  method?: 'cash' | 'card', clientId?: string, received?: number, tip?: number,
  covers?: string[],
}) {
  return createPayment(f.db, f.venueId, f.actor(who), {
    client_id: opts.clientId ?? randomUUID(),
    ...(opts.tabId ? { tab_id: opts.tabId } : {}),
    ...(opts.tabClientId ? { tab_client_id: opts.tabClientId } : {}),
    method: opts.method ?? 'cash',
    amount_fen: opts.fen,
    ...(opts.received === undefined ? {} : { received_fen: opts.received }),
    tip_fen: opts.tip ?? 0,
    covers_order_client_ids: opts.covers ?? [],
  })
}

function entries(kind: string) {
  return f.db.select().from(schema.logEntries)
    .where(and(eq(schema.logEntries.venueId, f.venueId), eq(schema.logEntries.kind, kind)))
    .all()
}

const payments = () => f.db.select().from(schema.payments).all()

// ===========================================================================

describe('createPayment — the ordinary night', () => {
  it('exact cash closes the tab', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')

    const result = pay('Amar', { tabId: order.tab_id, fen: 300 })

    expect(result.tab_status).toBe('paid')
    expect(result.total_fen).toBe(300)
    expect(result.paid_fen).toBe(300)
    expect(result.remaining_fen).toBe(0)
    expect(result.change_fen).toBe(0)
    expect(result.post_settle).toBe(false)

    const tab = f.db.select().from(schema.tabs).where(eq(schema.tabs.id, order.tab_id)).get()!
    expect(tab.status).toBe('paid')
    expect(tab.closedBy).toBe(f.userId('Amar'))
    // Thousands a week: the ledger row is the record, not a Dnevnik entry.
    expect(entries('pay_uncovered')).toHaveLength(0)
  })

  it('takes a part now and the rest later', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')

    const first = pay('Amar', { tabId: order.tab_id, fen: 100 })
    expect(first.tab_status).toBe('open')
    expect(first.remaining_fen).toBe(200)

    const second = pay('Amar', { tabId: order.tab_id, fen: 200 })
    expect(second.tab_status).toBe('paid')
    expect(second.remaining_fen).toBe(0)
    expect(payments()).toHaveLength(2)
  })

  it('gives change without taking it, and never counts a tip as takings', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')

    const result = pay('Amar', { tabId: order.tab_id, fen: 300, received: 500, tip: 50 })

    expect(result.change_fen).toBe(200)
    expect(result.remaining_fen).toBe(0)
    // Neither the change nor the tip is the café's money.
    expect(tabMoney(f.db, f.venueId, order.tab_id).paid_fen).toBe(300)
  })

  it('finds the tab by the phone\'s own id', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')
    const result = pay('Amar', { tabClientId: order.tab_client_id, fen: 300 })
    expect(result.tab_id).toBe(order.tab_id)
  })
})

describe('createPayment — the refusals', () => {
  it('OVERPAY writes nothing at all', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')

    refuses(() => pay('Amar', { tabId: order.tab_id, fen: 400 }), 'OVERPAY', 422)

    expect(payments()).toHaveLength(0)
    expect(f.db.select().from(schema.tabs).get()!.status).toBe('open')
  })

  it('a second naplata is a 409 and leaves the entry that explains it', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    const order = lock('Amar', 'Sto 7')
    pay('Amar', { tabId: order.tab_id, fen: 300 })

    refuses(() => pay('Lejla', { tabId: order.tab_id, fen: 300 }), 'TAB_ALREADY_PAID', 409)

    // The 409 tells the waiter; the entry tells the owner. It is written in its
    // own transaction precisely so the refusal cannot roll it back.
    const logged = entries('pay_duplicate_attempt')
    expect(logged).toHaveLength(1)
    const body = JSON.parse(logged[0]!.bodyJson)
    expect(body.user_id).toBe(f.userId('Lejla'))
    expect(body.paid_by).toBe(f.userId('Amar'))
    expect(payments()).toHaveLength(1)
  })

  it('refuses a method the owner has not enabled', () => {
    f.settingsWith({ payment_methods: ['cash'] })
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')

    refuses(() => pay('Amar', { tabId: order.tab_id, fen: 300, method: 'card' }),
      'METHOD_NOT_ALLOWED', 400)
    expect(payments()).toHaveLength(0)
  })

  it('refuses a covers list naming a round from another tab', () => {
    f.openShift({ members: ['Amar'] })
    const mine = lock('Amar', 'Sto 7')
    const other = lock('Amar', 'Sto 8')
    const otherOrder = f.db.select().from(schema.orders)
      .where(eq(schema.orders.tabId, other.tab_id)).get()!

    refuses(() => pay('Amar', {
      tabId: mine.tab_id, fen: 300, covers: [otherOrder.clientId],
    }), 'INVALID_COVERS', 400)
  })

  it('refuses a tab nobody has', () => {
    f.openShift({ members: ['Amar'] })
    refuses(() => pay('Amar', { tabId: randomUUID(), fen: 100 }), 'TAB_NOT_FOUND', 404)
  })
})

describe('createPayment — idempotency', () => {
  it('a replayed client_id answers with the stored row and writes no second one', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')
    const clientId = randomUUID()

    const first = pay('Amar', { tabId: order.tab_id, fen: 300, clientId })
    const second = pay('Amar', { tabId: order.tab_id, fen: 300, clientId })

    expect(second.payment_id).toBe(first.payment_id)
    expect(second.already_applied).toBe(true)
    expect(first.already_applied).toBe(false)
    expect(payments()).toHaveLength(1)
    // A replay against a tab that is now paid must not be mistaken for a second
    // waiter charging it — the replay check runs first.
    expect(entries('pay_duplicate_attempt')).toHaveLength(0)
  })
})

describe('createPayment — naplata bez pokrića', () => {
  it('flags the tab when a colleague\'s round is left uncovered', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    const first = lock('Amar', 'Sto 7', [line('Kafa', 1)])
    lock('Lejla', 'Sto 7', [line('Kafa', 1)])
    const lejlaOrder = f.db.select().from(schema.orders)
      .where(eq(schema.orders.lockedBy, f.userId('Lejla'))).get()!

    const result = pay('Lejla', {
      tabId: first.tab_id, fen: 150, covers: [lejlaOrder.clientId],
    })

    expect(result.tab_status).toBe('open')
    const tab = f.db.select().from(schema.tabs).where(eq(schema.tabs.id, first.tab_id)).get()!
    expect(tab.pendingReview).toBe(1)
    expect(entries('pay_uncovered')).toHaveLength(1)
  })

  it('collecting an unpaid tab clears the review flag', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')
    markUnpaid(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(), tab_client_id: order.tab_client_id, reason: 'walked_out',
    })

    const result = pay('Amar', { tabId: order.tab_id, fen: 300 })
    expect(result.tab_status).toBe('paid')
    const tab = f.db.select().from(schema.tabs).where(eq(schema.tabs.id, order.tab_id)).get()!
    expect(tab.pendingReview).toBe(0)
  })
})

// ===========================================================================
// Where the money lands
// ===========================================================================

describe('createPayment — the shift it belongs to', () => {
  it('keeps a tab opened before midnight on the shift that opened it', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')

    const result = pay('Amar', { tabId: order.tab_id, fen: 300 })
    const row = f.db.select().from(schema.payments)
      .where(eq(schema.payments.id, result.payment_id)).get()!
    expect(row.shiftId).toBe(shiftId)

    const ec = expectedCash(f.db, f.venueId, shiftId, f.userId('Amar'))
    expect(ec.waiters[0]!.cash_fen).toBe(300)
  })

  it('taking money after your own settlement is accepted, stamped and alerted', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')
    f.settle('Amar')

    const before = expectedCash(f.db, f.venueId, shiftId, f.userId('Amar')).waiters[0]!
    const result = pay('Amar', { tabId: order.tab_id, fen: 300 })

    expect(result.post_settle).toBe(true)
    const after = expectedCash(f.db, f.venueId, shiftId, f.userId('Amar')).waiters[0]!
    expect(after.cash_fen).toBe(before.cash_fen + 300)
    // Reported separately so the *Smjena* strip can say "nakon predaje: +3,00 KM"
    // rather than leaving a bare discrepancy — and never added twice.
    expect(after.post_settle_cash_fen).toBe(300)
    expect(after.expected_fen).toBe(before.expected_fen + 300)

    expect(entries('late_after_settle')).toHaveLength(1)
    expect(f.db.select().from(schema.alertEvents).all().map(a => a.ruleKey))
      .toContain('late_after_settle')
  })

  /**
   * §11's reconciliation case, and the reason `expectedCash`'s fifth term counts
   * what the *tab* owes rather than what the round charged. Summing
   * `orders.charged_fen` would count the same 300 twice the moment anybody paid
   * the tab in cash — once in the settler's term 5 and once in the payer's
   * term 2 — and `venueExpected` would quietly overstate by the amount.
   */
  it('a colleague paying a post-settlement tab leaves venueExpected where it was', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Lejla'] })
    f.settle('Amar')
    const order = lock('Amar', 'Sto 7')

    const before = expectedCash(f.db, f.venueId, shiftId)
    expectReconciled(before)
    const amarBefore = before.waiters.find(w => w.name === 'Amar')!
    expect(amarBefore.post_settle_lock_fen).toBe(300)

    pay('Lejla', { tabId: order.tab_id, fen: 300 })

    const after = expectedCash(f.db, f.venueId, shiftId)
    expect(after.venue_expected_fen).toBe(before.venue_expected_fen)
    // The money moved into the pocket it is physically in.
    expect(after.waiters.find(w => w.name === 'Amar')!.post_settle_lock_fen).toBe(0)
    expect(after.waiters.find(w => w.name === 'Lejla')!.cash_fen).toBe(300)
    expectReconciled(after)
  })
})
