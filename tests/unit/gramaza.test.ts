/**
 * *Gramaža* — the owner's two doses (16.09.2026), and what a sale takes off
 * *Stanje šanka* because of them.
 *
 * One coffee is `grams_per_coffee` grams of the coffee article a menu article
 * names (*troši kafu*); one bowl is `grams_per_bowl_default` grams split across
 * the aromas the guest chose. Both are venue settings, so changing the figure
 * once changes it for every article — from the next round on.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { refuses } from '../helpers/shifts'
import { createOrder } from '../../server/services/orders'
import { createProduct, createStockItem } from '../../server/services/admin'
import { DEFAULT_SETTINGS } from '#shared/settings'

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

function onHand(stockItemId: string): number {
  return f.db.select().from(schema.stockMovements).all()
    .filter(m => m.stockItemId === stockItemId)
    .reduce((sum, m) => sum + m.qtyDelta, 0)
}

function sell(productId: string, qty: number, table = 'Sto 7', flavourIds?: string[]) {
  createOrder(f.db, f.venueId, f.actor('Amar'), {
    client_id: randomUUID(),
    table_id: f.tableId(table),
    lines: [{ id: randomUUID(), product_id: productId, qty, ...(flavourIds ? { flavour_ids: flavourIds } : {}) }],
  })
}

/** A coffee article on the shelf, and a menu article that uses it. */
function coffee(): { beans: string, espresso: string } {
  const beans = createStockItem(f.db, f.venueId, f.adminActor(), {
    name: 'Kafa u zrnu', kind: 'kafa', base_unit: 'g', last_cost_mfen: 30_000,
  }).id
  const categoryId = f.db.select().from(schema.categories).all()[0]!.id
  const espresso = createProduct(f.db, f.venueId, f.adminActor(), {
    category_id: categoryId, name: 'Espresso test', price_fen: 250, coffee_stock_item_id: beans,
  }).id
  return { beans, espresso }
}

describe('troši kafu', () => {
  it('takes one dose of coffee per cup off the coffee article', () => {
    f.openShift({ members: ['Amar'] })
    const { beans, espresso } = coffee()

    sell(espresso, 3)

    expect(DEFAULT_SETTINGS.grams_per_coffee).toBe(8)
    expect(onHand(beans)).toBe(-24)
  })

  it('follows a changed dose from the next round, and leaves the last one as it was', () => {
    f.openShift({ members: ['Amar'] })
    const { beans, espresso } = coffee()

    sell(espresso, 1, 'Sto 7')
    f.settingsWith({ grams_per_coffee: 9 })
    sell(espresso, 1, 'Sto 8')

    expect(onHand(beans)).toBe(-(8 + 9))
  })

  it('refuses to point a coffee at something that is not coffee', () => {
    const categoryId = f.db.select().from(schema.categories).all()[0]!.id
    refuses(() => createProduct(f.db, f.venueId, f.adminActor(), {
      category_id: categoryId,
      name: 'Kafa od Coca-Cole',
      price_fen: 250,
      coffee_stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
    }), 'NOT_COFFEE', 400)
  })
})

describe('grama po luli', () => {
  it('splits the venue dose across the aromas, whatever the product once said', () => {
    f.openShift({ members: ['Amar'] })
    f.settingsWith({ grams_per_bowl_default: 24 })
    const jabuka = f.stockItemId('Al Fakher · Jabuka')
    const menta = f.stockItemId('Al Fakher · Menta')
    const jabukaBefore = onHand(jabuka)
    const mentaBefore = onHand(menta)

    sell(f.productId('Nargila'), 1, 'Sto 7', [jabuka, menta])

    expect(jabukaBefore - onHand(jabuka)).toBeCloseTo(12, 6)
    expect(mentaBefore - onHand(menta)).toBeCloseTo(12, 6)
  })
})

describe('what the menu strikes through', () => {
  it('follows the shelf: pieces at zero, coffee under a dose, nargila with no aroma', async () => {
    const { menuAvailability } = await import('../../server/services/stock')
    f.openShift({ members: ['Amar'] })
    const { beans, espresso } = coffee()

    // A brand-new coffee article has no movement at all: nothing to pour.
    expect(menuAvailability(f.db, f.venueId).products).toContain(espresso)

    // One dose on the shelf, and it is back.
    f.db.insert(schema.stockMovements).values({
      id: randomUUID(), venueId: f.venueId, stockItemId: beans, type: 'opening',
      qtyDelta: 8, occurredAt: f.clock.now(), createdAt: f.clock.now(), unitCostMfen: 0,
    }).run()
    expect(menuAvailability(f.db, f.venueId).products).not.toContain(espresso)

    // …and sold, it is gone again: 0 g is less than 8 g.
    sell(espresso, 1)
    expect(menuAvailability(f.db, f.venueId).products).toContain(espresso)
  })
})

describe('potrošeno u smjeni', () => {
  it('counts what the shift sold, positive, and not goods that arrived during it', async () => {
    const { getStock } = await import('../../server/services/stock')
    const { createDelivery } = await import('../../server/services/stock')
    f.openShift({ members: ['Amar'] })
    const { beans, espresso } = coffee()

    sell(espresso, 2)
    createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      lines: [{ stock_item_id: beans, packs: 0, loose: 1000, line_cost_fen: 3_000 }],
    })

    const row = getStock(f.db, f.venueId).find(item => item.id === beans)!
    expect(row.consumed).toBe(16)
    // On hand already has the sale taken off and the delivery added.
    expect(row.on_hand).toBe(1000 - 16)
  })
})
