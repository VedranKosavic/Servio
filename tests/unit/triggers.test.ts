/**
 * The ledger rules, tested against the real triggers on a real database.
 *
 * These prove that the rules hold even when the code is wrong: the statements
 * below go straight to SQLite, bypassing every service, and are still refused.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createOrder } from '../../server/services/orders'
import { markPrepared } from '../../server/services/prep'
import { payTab } from '../../server/services/tabs'
import { makeFixture, schema, type Fixture } from '../helpers/db'

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

function anOrder() {
  return createOrder(f.db, f.venueId, {
    client_id: randomUUID(),
    table_id: f.tableId('Sto 9'),
    user_id: f.userId('Amar'),
    lines: [{ product_id: f.productId('Kafa'), qty: 1 }],
  })
}

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
})

describe('tabs — open to paid, and no further', () => {
  it('pays once and refuses a second payment', () => {
    const order = anOrder()
    const tab = payTab(f.db, f.venueId, order.tab_id, f.userId('Amar'))

    expect(tab.status).toBe('paid')
    expect(tab.closed_at).not.toBeNull()
    expect(tab.total_fen).toBe(150)

    expect(() => payTab(f.db, f.venueId, order.tab_id, f.userId('Amar')))
      .toThrow(/already paid/)
  })

  it('refuses reopening a paid tab', () => {
    const order = anOrder()
    payTab(f.db, f.venueId, order.tab_id, f.userId('Amar'))

    expect(() => f.db.update(schema.tabs)
      .set({ status: 'open', closedAt: null, closedBy: null })
      .where(eq(schema.tabs.id, order.tab_id))
      .run()).toThrow(/open -> paid/)
  })

  it('frees the table for a new tab once the old one is paid', () => {
    const tableId = f.tableId('Sto 9')
    const first = anOrder()
    payTab(f.db, f.venueId, first.tab_id, f.userId('Amar'))

    const second = createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: tableId,
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Čaj'), qty: 1 }],
    })
    expect(second.tab_id).not.toBe(first.tab_id)
  })
})
