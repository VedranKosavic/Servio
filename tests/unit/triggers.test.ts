/**
 * The ledger rules, tested against the real triggers on a real database.
 *
 * These prove that the rules hold even when the code is wrong: the statements
 * below go straight to SQLite, bypassing every service, and are still refused.
 * That is the point of a trigger over a check in a service — a service can be
 * rewritten by somebody who does not know the rule, and a migration script or a
 * console session never goes through one at all.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createOrder } from '../../server/services/orders'
import { tabMoney } from '../../server/services/tabs'
import { markPrepared } from '../../server/services/prep'
import { createPayment } from '../../server/services/payments'
import { makeFixture, schema, type Fixture } from '../helpers/db'

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

/** A SQL string literal, with quotes doubled. */
const q = (s: string) => `'${s.replace(/'/g, "''")}'`

function anOrder() {
  return createOrder(f.db, f.venueId, f.actor('Amar'), {
    client_id: randomUUID(),
    table_id: f.tableId('Sto 9'),
    lines: [{ id: randomUUID(), product_id: f.productId('Kafa'), qty: 1 }],
  })
}

// ===========================================================================
// Korak 1 — unchanged rules, unchanged tests
// ===========================================================================

describe('append-only ledgers', () => {
  it('refuses UPDATE and DELETE on order_lines', () => {
    const order = anOrder()
    const line = f.db.select().from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, order.order_id)).get()!

    expect(() => f.db.update(schema.orderLines)
      .set({ chargedFen: 1 })
      .where(eq(schema.orderLines.id, line.id))
      .run()).toThrow(/append-only/)

    expect(() => f.db.delete(schema.orderLines)
      .where(eq(schema.orderLines.id, line.id))
      .run()).toThrow(/append-only/)
  })

  it('refuses UPDATE and DELETE on stock_movements', () => {
    anOrder()
    const movement = f.db.select().from(schema.stockMovements)
      .where(eq(schema.stockMovements.type, 'sale')).get()!

    expect(() => f.db.update(schema.stockMovements)
      .set({ qtyDelta: 0 })
      .where(eq(schema.stockMovements.id, movement.id))
      .run()).toThrow(/append-only/)

    expect(() => f.db.delete(schema.stockMovements)
      .where(eq(schema.stockMovements.id, movement.id))
      .run()).toThrow(/append-only/)
  })

  it('refuses DELETE on orders and tabs', () => {
    const order = anOrder()
    expect(() => f.db.delete(schema.orders)
      .where(eq(schema.orders.id, order.order_id)).run()).toThrow(/append-only/)
    expect(() => f.db.delete(schema.tabs)
      .where(eq(schema.tabs.id, order.tab_id)).run()).toThrow(/append-only/)
  })
})

describe('orders — the one allowed transition', () => {
  it('accepts prepared once and refuses it twice', () => {
    const order = anOrder()
    const emir = f.userId('Emir')

    const done = markPrepared(f.db, f.venueId, order.order_id, emir)
    expect(done.prepared_at).not.toBeNull()
    expect(done.prepared_by_name).toBe('Emir')

    // The service says 409 …
    expect(() => markPrepared(f.db, f.venueId, order.order_id, emir))
      .toThrow(/already prepared/)

    // … and so does the database, to a statement that skips the service.
    expect(() => f.db.update(schema.orders)
      .set({ preparedAt: new Date().toISOString(), preparedBy: emir })
      .where(eq(schema.orders.id, order.order_id))
      .run()).toThrow(/prepared_at/)
  })

  it('refuses an UPDATE that changes anything else', () => {
    const order = anOrder()
    expect(() => f.db.update(schema.orders)
      .set({ note: 'promijenjeno' })
      .where(eq(schema.orders.id, order.order_id))
      .run()).toThrow(/prepared_at/)
  })

  // The nine Korak 2 columns are in the frozen list too, not just the old ones.
  it('refuses an UPDATE that moves a Korak 2 column', () => {
    const order = anOrder()
    expect(() => f.db.update(schema.orders)
      .set({ postSettle: 1 })
      .where(eq(schema.orders.id, order.order_id))
      .run()).toThrow(/prepared_at/)
  })
})

/** Naplati the whole tab in cash — WP3's replacement for Korak 1's `payTab`. */
function pay(tabId: string) {
  const money = tabMoney(f.db, f.venueId, tabId)
  return createPayment(f.db, f.venueId, f.actor('Amar'), {
    client_id: randomUUID(),
    tab_id: tabId,
    method: 'cash',
    amount_fen: money.remaining_fen,
    tip_fen: 0,
    covers_order_client_ids: [],
  })
}

describe('tabs — open to paid, and no further', () => {
  it('pays once and refuses a second payment', () => {
    const order = anOrder()
    const result = pay(order.tab_id)

    expect(result.tab_status).toBe('paid')
    expect(result.total_fen).toBe(150)
    expect(result.remaining_fen).toBe(0)

    // WP3 replaced `POST /api/tabs/:id/pay` with `POST /api/payments`; the
    // invariant it proves is unchanged — one tab, one settlement.
    expect(() => pay(order.tab_id)).toThrow(/already paid/)
  })

  /**
   * The invariant has not moved — a paid tab still never reopens. Only the
   * refusal's wording did: Korak 1's single "open -> paid" boolean is now
   * `tabs_frozen_cols` + `tabs_status_guard`, which has four legal branches and
   * one message for everything outside them (docs/BACKEND.md §3.4).
   */
  it('refuses reopening a paid tab', () => {
    const order = anOrder()
    pay(order.tab_id)

    expect(() => f.db.update(schema.tabs)
      .set({ status: 'open', closedAt: null, closedBy: null })
      .where(eq(schema.tabs.id, order.tab_id))
      .run()).toThrow(/illegal transition/)
  })

  it('frees the table for a new tab once the old one is paid', () => {
    const tableId = f.tableId('Sto 9')
    const first = anOrder()
    pay(first.tab_id)

    const second = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: tableId,
      lines: [{ id: randomUUID(), product_id: f.productId('Čaj'), qty: 1 }],
    })
    expect(second.tab_id).not.toBe(first.tab_id)
  })
})

// ===========================================================================
// Korak 2 — one raw-SQL refusal per new rule
// ===========================================================================

describe('tabs — the rest of the transitions', () => {
  it('refuses unpaid → open', () => {
    const { tabId } = f.lock('Amar', 'Sto 3', [{ product: 'Kafa' }])
    f.sqlite.exec(
      `UPDATE tabs SET status='unpaid', closed_at=${q(f.clock.now())}, `
      + `closed_by=${q(f.userId('Amar'))} WHERE id=${q(tabId)}`,
    )
    f.expectRefused(
      `UPDATE tabs SET status='open', closed_at=NULL, closed_by=NULL WHERE id=${q(tabId)}`,
      /illegal transition/,
    )
  })

  it('refuses moving a paid tab to another table', () => {
    const { tabId } = f.lock('Amar', 'Sto 3', [{ product: 'Kafa' }])
    f.sqlite.exec(
      `UPDATE tabs SET status='paid', closed_at=${q(f.clock.now())}, `
      + `closed_by=${q(f.userId('Amar'))} WHERE id=${q(tabId)}`,
    )
    f.expectRefused(
      `UPDATE tabs SET table_id=${q(f.tableId('Sto 4'))} WHERE id=${q(tabId)}`,
      /illegal transition/,
    )
  })

  it('allows unpaid → paid, and leaves the original close untouched', () => {
    const { tabId } = f.lock('Amar', 'Sto 3', [{ product: 'Kafa' }])
    const at = f.clock.now()
    f.sqlite.exec(
      `UPDATE tabs SET status='unpaid', closed_at=${q(at)}, `
      + `closed_by=${q(f.userId('Amar'))}, unpaid_by=${q(f.userId('Amar'))}, `
      + `unpaid_reason='walked_out' WHERE id=${q(tabId)}`,
    )
    f.sqlite.exec(`UPDATE tabs SET status='paid' WHERE id=${q(tabId)}`)

    const tab = f.db.select().from(schema.tabs).where(eq(schema.tabs.id, tabId)).get()!
    expect(tab.status).toBe('paid')
    expect(tab.closedAt).toBe(at)
    expect(tab.unpaidReason).toBe('walked_out')
  })

  it('refuses changing a frozen column', () => {
    const { tabId } = f.lock('Amar', 'Sto 3', [{ product: 'Kafa' }])
    f.expectRefused(
      `UPDATE tabs SET opened_by=${q(f.userId('Lejla'))} WHERE id=${q(tabId)}`,
      /frozen column/,
    )
  })

  it('refuses a tab with no assignee', () => {
    f.expectRefused(
      `INSERT INTO tabs (id, venue_id, table_id, client_id, status, opened_by, opened_at, `
      + `late_sync, pending_review, fiscal_status) VALUES (${q(randomUUID())}, `
      + `${q(f.venueId)}, ${q(f.tableId('Sto 5'))}, ${q(randomUUID())}, 'open', `
      + `${q(f.userId('Amar'))}, ${q(f.clock.now())}, 0, 0, 'none')`,
      /assigned_to required/,
    )
  })
})

describe('orders — a round belongs to a shift', () => {
  it('refuses an insert with no shift_id', () => {
    const { tabId } = f.lock('Amar', 'Sto 6', [{ product: 'Kafa' }])
    f.expectRefused(
      `INSERT INTO orders (id, venue_id, tab_id, client_id, locked_by, created_at, `
      + `sync_lag_s, late_sync, post_settle, source) VALUES (${q(randomUUID())}, `
      + `${q(f.venueId)}, ${q(tabId)}, ${q(randomUUID())}, ${q(f.userId('Amar'))}, `
      + `${q(f.clock.now())}, 0, 0, 0, 'app')`,
      /shift_id and shift_seq required/,
    )
  })
})

describe('payments — append-only, and a reversal names its approver', () => {
  it('refuses UPDATE and DELETE', () => {
    const { tabId } = f.lock('Amar', 'Sto 7', [{ product: 'Kafa' }])
    const paymentId = f.pay('Amar', tabId, 150)

    f.expectRefused(`UPDATE payments SET amount_fen = 1 WHERE id=${q(paymentId)}`, /append-only/)
    f.expectRefused(`DELETE FROM payments WHERE id=${q(paymentId)}`, /append-only/)
  })

  it('refuses a negative payment with no approved_by', () => {
    const { tabId } = f.lock('Amar', 'Sto 7', [{ product: 'Kafa' }])
    const shiftId = f.db.select({ id: schema.shifts.id }).from(schema.shifts).get()!.id
    f.expectRefused(
      `INSERT INTO payments (id, venue_id, tab_id, shift_id, client_id, method, amount_fen, `
      + `tip_fen, covers_json, paid_by, post_settle, created_at) VALUES (${q(randomUUID())}, `
      + `${q(f.venueId)}, ${q(tabId)}, ${q(shiftId)}, ${q(randomUUID())}, 'cash', -150, `
      + `0, '[]', ${q(f.userId('Amar'))}, 0, ${q(f.clock.now())})`,
      /reversal needs approved_by/,
    )
  })

  it('refuses a payment with no shift_id', () => {
    const { tabId } = f.lock('Amar', 'Sto 7', [{ product: 'Kafa' }])
    f.expectRefused(
      `INSERT INTO payments (id, venue_id, tab_id, client_id, method, amount_fen, `
      + `tip_fen, covers_json, paid_by, post_settle, created_at) VALUES (${q(randomUUID())}, `
      + `${q(f.venueId)}, ${q(tabId)}, ${q(randomUUID())}, 'cash', 150, `
      + `0, '[]', ${q(f.userId('Amar'))}, 0, ${q(f.clock.now())})`,
      /shift_id required/,
    )
  })
})

describe('line_adjustments — one transition, and the amount does not move with it', () => {
  it('refuses applied → pending and applied → rejected', () => {
    const { lineIds } = f.lock('Amar', 'Sto 8', [{ product: 'Kafa' }])
    const adjId = f.voidLine('Amar', lineIds[0]!, { status: 'applied' })

    f.expectRefused(
      `UPDATE line_adjustments SET status='pending' WHERE id=${q(adjId)}`,
      /pending -> applied/,
    )
    f.expectRefused(
      `UPDATE line_adjustments SET status='rejected' WHERE id=${q(adjId)}`,
      /pending -> applied/,
    )
  })

  it('refuses changing the amount while deciding', () => {
    const { lineIds } = f.lock('Amar', 'Sto 8', [{ product: 'Kafa' }])
    const adjId = f.voidLine('Amar', lineIds[0]!)

    f.expectRefused(
      `UPDATE line_adjustments SET status='applied', amount_fen=1, `
      + `approved_by=${q(f.userId('Emir'))}, decided_at=${q(f.clock.now())} `
      + `WHERE id=${q(adjId)}`,
      /pending -> applied/,
    )
  })

  it('refuses DELETE', () => {
    const { lineIds } = f.lock('Amar', 'Sto 8', [{ product: 'Kafa' }])
    const adjId = f.voidLine('Amar', lineIds[0]!)
    f.expectRefused(`DELETE FROM line_adjustments WHERE id=${q(adjId)}`, /append-only/)
  })
})

describe('shifts — one open, and never reopened', () => {
  it('refuses a second open shift', () => {
    f.openShift()
    f.expectRefused(
      `INSERT INTO shifts (id, venue_id, business_date, opened_at, opened_by, auto_opened, `
      + `status, created_at) VALUES (${q(randomUUID())}, ${q(f.venueId)}, '2026-09-09', `
      + `${q(f.clock.now())}, ${q(f.userId('Amar'))}, 0, 'open', ${q(f.clock.now())})`,
      /UNIQUE constraint failed/,
    )
  })

  it('refuses closed → open', () => {
    const shiftId = f.openShift()
    f.sqlite.exec(
      `UPDATE shifts SET status='closed', closed_at=${q(f.clock.now())}, `
      + `closed_by=${q(f.userId('Haris'))} WHERE id=${q(shiftId)}`,
    )
    f.expectRefused(
      `UPDATE shifts SET status='open' WHERE id=${q(shiftId)}`,
      /illegal transition/,
    )
  })

  it('refuses changing the business date', () => {
    const shiftId = f.openShift()
    f.expectRefused(
      `UPDATE shifts SET business_date='2020-01-01' WHERE id=${q(shiftId)}`,
      /frozen column/,
    )
  })

  it('refuses leaving a shift twice', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    f.sqlite.exec(
      `UPDATE shift_members SET left_at=${q(f.clock.now())}, left_at_source='manual' `
      + `WHERE shift_id=${q(shiftId)}`,
    )
    f.expectRefused(
      `UPDATE shift_members SET left_at=${q(f.clock.now())} WHERE shift_id=${q(shiftId)}`,
      /only left_at/,
    )
  })
})

describe('shift_summaries — versioned, never rewritten', () => {
  it('refuses UPDATE and DELETE', () => {
    const shiftId = f.openShift()
    const at = f.clock.now()
    f.sqlite.exec(
      `INSERT INTO shift_summaries (shift_id, venue_id, version, reason, promet_fen, cash_fen, `
      + `card_fen, comp_fen, void_count, void_fen, self_void_count, self_void_fen, unpaid_fen, `
      + `expected_cash_fen, outstanding_fen, stock_variance_fen, waste_fen, bowls, tobacco_g, `
      + `coals, by_category_json, by_user_json, computed_at) VALUES (${q(shiftId)}, `
      + `${q(f.venueId)}, 1, 'close', 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,'[]','[]',${q(at)})`,
    )
    f.expectRefused(
      `UPDATE shift_summaries SET promet_fen = 1 WHERE shift_id=${q(shiftId)}`,
      /append-only/,
    )
    f.expectRefused(`DELETE FROM shift_summaries WHERE shift_id=${q(shiftId)}`, /append-only/)
  })
})

describe('cash — a decision happens once', () => {
  it('refuses approved → pending', () => {
    f.openShift()
    const movementId = f.cashMovement({ type: 'payout', amountFen: 500, user: 'Amar', status: 'pending' })
    f.sqlite.exec(
      `UPDATE cash_movements SET status='approved', decided_by=${q(f.userId('Haris'))}, `
      + `decided_at=${q(f.clock.now())} WHERE id=${q(movementId)}`,
    )
    f.expectRefused(
      `UPDATE cash_movements SET status='pending' WHERE id=${q(movementId)}`,
      /pending -> approved/,
    )
  })

  it('refuses accepting a settlement twice', () => {
    f.openShift()
    const settlementId = f.settle('Amar', { declaredFen: 20_000 })
    f.sqlite.exec(
      `UPDATE waiter_settlements SET accepted_by=${q(f.userId('Emir'))}, `
      + `accepted_at=${q(f.clock.now())} WHERE id=${q(settlementId)}`,
    )
    f.expectRefused(
      `UPDATE waiter_settlements SET accepted_by=${q(f.userId('Haris'))}, `
      + `accepted_at=${q(f.clock.now())} WHERE id=${q(settlementId)}`,
      /only accepted_by/,
    )
  })

  it('refuses changing what a waiter declared', () => {
    f.openShift()
    const settlementId = f.settle('Amar', { declaredFen: 20_000 })
    f.expectRefused(
      `UPDATE waiter_settlements SET declared_fen = 1 WHERE id=${q(settlementId)}`,
      /only accepted_by/,
    )
  })
})

describe('counts — submitted, then confirmed, and that is all', () => {
  it('refuses confirmed → submitted', () => {
    f.openShift()
    const { countId } = f.submitCount('Emir', ['Coca-Cola 0,25 l'])
    f.sqlite.exec(
      `UPDATE stock_counts SET status='confirmed', confirmed_by=${q(f.userId('Haris'))}, `
      + `confirmed_at=${q(f.clock.now())} WHERE id=${q(countId)}`,
    )
    f.expectRefused(
      `UPDATE stock_counts SET status='submitted' WHERE id=${q(countId)}`,
      /submitted -> confirmed/,
    )
  })

  it('refuses editing a counted quantity', () => {
    f.openShift()
    const { lineIds } = f.submitCount('Emir', ['Coca-Cola 0,25 l'])
    f.expectRefused(
      `UPDATE stock_count_lines SET counted_qty = 999 WHERE id=${q(lineIds[0]!)}`,
      /only applied_adjust/,
    )
  })

  it('allows the confirm to write applied_adjust, once', () => {
    f.openShift()
    const { lineIds } = f.submitCount('Emir', ['Coca-Cola 0,25 l'])
    f.sqlite.exec(`UPDATE stock_count_lines SET applied_adjust = -2 WHERE id=${q(lineIds[0]!)}`)
    f.expectRefused(
      `UPDATE stock_count_lines SET applied_adjust = -3 WHERE id=${q(lineIds[0]!)}`,
      /only applied_adjust/,
    )
  })
})

describe('deliveries — an invoice does not change', () => {
  it('refuses editing a posted header', () => {
    const { deliveryId } = f.postDelivery('Emir', [{ item: 'Coca-Cola 0,25 l', qty: 48, costFen: 4320 }])
    f.expectRefused(
      `UPDATE deliveries SET supplier_name='Drugi' WHERE id=${q(deliveryId)}`,
      /draft -> posted, or one reversal/,
    )
  })

  it('refuses reversing twice', () => {
    const { deliveryId } = f.postDelivery('Emir', [{ item: 'Coca-Cola 0,25 l', qty: 48, costFen: 4320 }])
    f.sqlite.exec(
      `UPDATE deliveries SET reversed_at=${q(f.clock.now())}, `
      + `reversed_by=${q(f.userId('Haris'))} WHERE id=${q(deliveryId)}`,
    )
    f.expectRefused(
      `UPDATE deliveries SET reversed_at=${q(f.clock.now())}, `
      + `reversed_by=${q(f.userId('Haris'))} WHERE id=${q(deliveryId)}`,
      /draft -> posted, or one reversal/,
    )
  })

  it('refuses UPDATE and DELETE on delivery_lines', () => {
    const { lineIds } = f.postDelivery('Emir', [{ item: 'Coca-Cola 0,25 l', qty: 48, costFen: 4320 }])
    f.expectRefused(`UPDATE delivery_lines SET qty = 1 WHERE id=${q(lineIds[0]!)}`, /append-only/)
    f.expectRefused(`DELETE FROM delivery_lines WHERE id=${q(lineIds[0]!)}`, /append-only/)
  })
})

describe('waste — the bottle stays broken', () => {
  it('refuses editing the quantity', () => {
    f.openShift()
    const wasteId = f.wasteEvent('Amar', 'Coca-Cola 0,25 l', 2)
    f.expectRefused(
      `UPDATE waste_events SET qty = 0 WHERE id=${q(wasteId)}`,
      /only approved_by/,
    )
  })

  it('allows the approval, once', () => {
    f.openShift()
    const wasteId = f.wasteEvent('Amar', 'Coca-Cola 0,25 l', 2, { needsApproval: true })
    f.sqlite.exec(
      `UPDATE waste_events SET approved_by=${q(f.userId('Emir'))}, `
      + `approved_at=${q(f.clock.now())} WHERE id=${q(wasteId)}`,
    )
    f.expectRefused(
      `UPDATE waste_events SET approved_by=${q(f.userId('Haris'))}, `
      + `approved_at=${q(f.clock.now())} WHERE id=${q(wasteId)}`,
      /only approved_by/,
    )
  })
})

describe('the log and its evidence', () => {
  it('refuses rewriting a title without a redaction', () => {
    const entryId = f.logEntry()
    f.expectRefused(
      `UPDATE log_entries SET title_bs='drugo' WHERE id=${q(entryId)}`,
      /only a redaction/,
    )
  })

  it('allows a redaction that says so', () => {
    const entryId = f.logEntry()
    f.sqlite.exec(
      `UPDATE log_entries SET title_bs='uklonjeno', body_json='{}', `
      + `redacted_at=${q(f.clock.now())} WHERE id=${q(entryId)}`,
    )
    const entry = f.db.select().from(schema.logEntries)
      .where(eq(schema.logEntries.id, entryId)).get()!
    expect(entry.redactedAt).not.toBeNull()
  })

  it('refuses DELETE on log_entries', () => {
    const entryId = f.logEntry()
    f.expectRefused(`DELETE FROM log_entries WHERE id=${q(entryId)}`, /append-only/)
  })

  it('lets an alert record its own delivery attempts and nothing else', () => {
    const eventId = f.alertEvent()
    f.sqlite.exec(
      `UPDATE alert_events SET attempts = 1, last_error='timeout' WHERE id=${q(eventId)}`,
    )
    f.expectRefused(
      `UPDATE alert_events SET rule_key='shift_forced' WHERE id=${q(eventId)}`,
      /only sent_at/,
    )
  })

  it('refuses UPDATE and DELETE on auth_attempts', () => {
    const attemptId = f.authAttempt('Amar', false)
    f.expectRefused(`UPDATE auth_attempts SET ok = 1 WHERE id=${q(attemptId)}`, /append-only/)
    f.expectRefused(`DELETE FROM auth_attempts WHERE id=${q(attemptId)}`, /append-only/)
  })
})

describe('price_history — a price row is closed, never re-priced', () => {
  it('refuses changing a price, and allows closing the row once', () => {
    const row = f.db.select().from(schema.priceHistory).limit(1).get()!
    f.expectRefused(
      `UPDATE price_history SET price_fen = 1 WHERE id=${q(row.id)}`,
      /only valid_to/,
    )
    f.sqlite.exec(`UPDATE price_history SET valid_to=${q(f.clock.now())} WHERE id=${q(row.id)}`)
    f.expectRefused(
      `UPDATE price_history SET valid_to=${q(f.clock.now())} WHERE id=${q(row.id)}`,
      /only valid_to/,
    )
  })
})
