/**
 * The order lock: atomicity, stock resolution and idempotency.
 *
 * These are the Phase 0 invariants. They are the guardrail, not a formality —
 * never weaken one to fit a feature.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createOrder } from '../../server/services/orders'
import { makeFixture, schema, type Fixture } from '../helpers/db'

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

function countRows() {
  return {
    tabs: f.db.select().from(schema.tabs).all().length,
    orders: f.db.select().from(schema.orders).all().length,
    lines: f.db.select().from(schema.orderLines).all().length,
    sales: f.db.select().from(schema.stockMovements)
      .where(eq(schema.stockMovements.type, 'sale')).all().length,
  }
}

describe('createOrder — atomicity', () => {
  it('writes tab, order, lines and movements together', () => {
    const before = countRows()

    const result = createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Kafa'), qty: 2 }],
    })

    const after = countRows()
    expect(after.tabs).toBe(before.tabs + 1)
    expect(after.orders).toBe(before.orders + 1)
    expect(after.lines).toBe(before.lines + 1)
    // Kafa's normativ is two ingredients, so one line is two movements.
    expect(after.sales).toBe(before.sales + 2)
    expect(result.order_total_fen).toBe(300)
    expect(result.tab_total_fen).toBe(300)
    expect(result.already_applied).toBe(false)
  })

  it('leaves zero rows when anything inside the transaction fails', () => {
    const before = countRows()

    expect(() => createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      user_id: f.userId('Amar'),
      lines: [
        { product_id: f.productId('Kafa'), qty: 2 },
        // A product that does not exist. It is the SECOND line: by the time it
        // throws, the tab, the order and the first line's rows are already
        // written — and the transaction must undo every one of them.
        { product_id: randomUUID(), qty: 1 },
      ],
    })).toThrow()

    expect(countRows()).toEqual(before)
  })
})

describe('createOrder — stock resolution', () => {
  it('deducts a normativ and a 1:1 item', () => {
    const kafaBefore = f.onHand('Kafa (mljevena)')
    const secerBefore = f.onHand('Šećer')
    const colaBefore = f.onHand('Coca-Cola 0,25 l')

    createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 3'),
      user_id: f.userId('Lejla'),
      lines: [
        { product_id: f.productId('Kafa'), qty: 2 },
        { product_id: f.productId('Coca-Cola'), qty: 1 },
      ],
    })

    // 2 × (7 g kafa + 5 g šećera), and one bottle.
    expect(f.onHand('Kafa (mljevena)')).toBe(kafaBefore - 14)
    expect(f.onHand('Šećer')).toBe(secerBefore - 10)
    expect(f.onHand('Coca-Cola 0,25 l')).toBe(colaBefore - 1)
  })

  it('splits a mixed bowl evenly and burns the coal', () => {
    const jabukaBefore = f.onHand('Al Fakher · Jabuka')
    const mentaBefore = f.onHand('Al Fakher · Menta')
    const ugaljBefore = f.onHand('Ugalj (kocke)')

    createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 16'),
      user_id: f.userId('Dino'),
      lines: [{
        product_id: f.productId('Nargila'),
        qty: 1,
        flavour_ids: [f.stockItemId('Al Fakher · Jabuka'), f.stockItemId('Al Fakher · Menta')],
      }],
    })

    // 20 g over two aromas is 10 g + 10 g; three pieces of coal.
    expect(f.onHand('Al Fakher · Jabuka')).toBe(jabukaBefore - 10)
    expect(f.onHand('Al Fakher · Menta')).toBe(mentaBefore - 10)
    expect(f.onHand('Ugalj (kocke)')).toBe(ugaljBefore - 3)
  })

  it('lets stock go negative — a sale is never blocked', () => {
    // Only 20 lemons on hand; sell 30 lemonades.
    createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 20'),
      user_id: f.userId('Tarik'),
      lines: [{ product_id: f.productId('Limunada'), qty: 30 }],
    })
    expect(f.onHand('Limun')).toBe(-10)
  })

  it('charges nothing for Dodatni žar but still takes the coal', () => {
    const before = f.onHand('Ugalj (kocke)')
    const result = createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 1'),
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Dodatni žar'), qty: 1 }],
    })
    expect(result.order_total_fen).toBe(0)
    expect(f.onHand('Ugalj (kocke)')).toBe(before - 2)
  })
})

describe('createOrder — idempotency', () => {
  it('a replayed client_id writes nothing and reports already_applied', () => {
    const clientId = randomUUID()
    const body = {
      client_id: clientId,
      table_id: f.tableId('Sto 12'),
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Kafa'), qty: 1 }],
    }

    const first = createOrder(f.db, f.venueId, body)
    const after = countRows()
    const kafaAfterFirst = f.onHand('Kafa (mljevena)')

    const second = createOrder(f.db, f.venueId, body)

    expect(second.order_id).toBe(first.order_id)
    expect(second.tab_id).toBe(first.tab_id)
    expect(second.order_total_fen).toBe(first.order_total_fen)
    expect(second.already_applied).toBe(true)
    expect(first.already_applied).toBe(false)
    expect(countRows()).toEqual(after)
    expect(f.onHand('Kafa (mljevena)')).toBe(kafaAfterFirst)
  })

  it('a second round joins the table\'s open tab instead of opening another', () => {
    const tableId = f.tableId('Sto 21')
    const first = createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: tableId,
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Kafa'), qty: 1 }],
    })
    const second = createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: tableId,
      // A different waiter, the same table: one tab, and he adopts its id.
      user_id: f.userId('Lejla'),
      lines: [{ product_id: f.productId('Red Bull'), qty: 2 }],
    })

    expect(second.tab_id).toBe(first.tab_id)
    expect(second.order_total_fen).toBe(1000)
    expect(second.tab_total_fen).toBe(1150)

    const tabsOnTable = f.db.select().from(schema.tabs)
      .where(and(eq(schema.tabs.venueId, f.venueId), eq(schema.tabs.tableId, tableId)))
      .all()
    expect(tabsOnTable).toHaveLength(1)
  })
})

describe('createOrder — the server owns the price', () => {
  it('snapshots name and price from the product at lock time', () => {
    const result = createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 5'),
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Red Bull'), qty: 3 }],
    })

    const line = f.db.select().from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, result.order_id))
      .get()!

    expect(line.nameSnapshot).toBe('Red Bull')
    expect(line.unitPriceFen).toBe(500)
    expect(line.chargedFen).toBe(1500)
  })
})
