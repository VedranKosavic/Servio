/**
 * The shelf: deliveries, opening stock, waste, corrections and counts
 * (`docs/BACKEND.md` §6.8, §11).
 *
 * Four ideas carry most of the assertions here, and each one is a rule that
 * would be invisible if it broke.
 *
 * **On hand is `SUM(qty_delta)`, with no bounds.** Nothing stores a balance, so
 * every feature has to keep that sum true — which is why a restocked void
 * mirrors its sale rows exactly, and why a movement dated before a confirmed
 * count gets a `late_sync` row that cancels it instead of being refused.
 *
 * **A cost is never silently zero.** `unitCost` falls back to `last_cost_mfen`
 * and flags the row *procijenjeno*; only an item with neither is unpriced, and
 * that is the one a confirm refuses with `PRICE_MISSING`. A zero cost switches
 * off variance, waste value and *utrošak* all at once, and a report of zeroes
 * reads like good news.
 *
 * **The theoretical figure is bounded by `occurred_at`, not `created_at`.** A
 * round served at 23:40 and synced at 01:15 was off the shelf when the shelf was
 * counted at midnight. Both the submit and the confirm use the same bound, and
 * the difference between them is reported as `late_delta` rather than absorbed.
 *
 * **The ledger is written even when nobody approved it.** A broken bottle is
 * broken; `needs_approval` puts it on the bartender's list and never blocks the
 * row (§14.10).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createOrder } from '../../server/services/orders'
import { requestAdjustment } from '../../server/services/adjustments'
import {
  approveWaste, correctStock, createDelivery, getStock, insertMovement, logWaste, onHand,
  recomputeAvgCost, reverseDelivery, setOpeningStock, theoreticalAt, unitCost,
} from '../../server/services/stock'
import { confirmCount, listCounts, pendingCounts, submitCount } from '../../server/services/counts'
import { createDeliveryBody } from '#shared/schemas'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { refuses } from '../helpers/shifts'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

// ---------------------------------------------------------------------------

const line = (product: string, qty = 1, flavours?: string[]) => ({
  id: randomUUID(),
  product_id: f.productId(product),
  qty,
  ...(flavours ? { flavour_ids: flavours.map(f.stockItemId) } : {}),
})

function lock(who: string, table: string, lines: ReturnType<typeof line>[], clientAt?: string) {
  return createOrder(f.db, f.venueId, f.actor(who), {
    client_id: randomUUID(),
    table_id: f.tableId(table),
    lines,
    ...(clientAt ? { client_created_at: clientAt } : {}),
  } as Parameters<typeof createOrder>[3])
}

function movements(type?: string) {
  return f.db.select().from(schema.stockMovements)
    .where(and(
      eq(schema.stockMovements.venueId, f.venueId),
      type ? eq(schema.stockMovements.type, type as 'sale') : sql`1 = 1`,
    ))
    .all()
}

function entries(kind: string) {
  return f.db.select().from(schema.logEntries)
    .where(and(eq(schema.logEntries.venueId, f.venueId), eq(schema.logEntries.kind, kind)))
    .all()
}

function itemRow(name: string) {
  return f.db.select().from(schema.stockItems)
    .where(eq(schema.stockItems.id, f.stockItemId(name))).get()!
}

function setCosts(name: string, avgMfen: number, lastMfen: number) {
  f.db.update(schema.stockItems)
    .set({ avgCostMfen: avgMfen, lastCostMfen: lastMfen })
    .where(eq(schema.stockItems.id, f.stockItemId(name)))
    .run()
}

/** One enrolled phone, written straight into the table (no route under test). */
function enrol(label: string, opts: { pending?: number, lastSeenAt?: string } = {}): string {
  const id = randomUUID()
  f.db.insert(schema.devices).values({
    id,
    venueId: f.venueId,
    label,
    tokenHash: randomUUID(),
    mode: 'shared',
    enrolledAt: f.clock.now(),
    lastSeenAt: opts.lastSeenAt ?? f.clock.now(),
    pendingCount: opts.pending ?? 0,
    clockSkewS: 0,
  }).run()
  return id
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

// ===========================================================================
// On hand
// ===========================================================================

describe('on hand is SUM(qty_delta)', () => {
  it('splits a two-aroma bowl and puts every gram back when the void restocks', () => {
    f.openShift({ members: ['Dino'] })
    const before = {
      jabuka: f.onHand('Al Fakher · Jabuka'),
      menta: f.onHand('Al Fakher · Menta'),
      ugalj: f.onHand('Ugalj (kocke)'),
    }

    const order = lock('Dino', 'Sto 16', [
      line('Nargila', 1, ['Al Fakher · Jabuka', 'Al Fakher · Menta']),
    ])

    // 20 g over two aromas is 10 g + 10 g, and three pieces of coal.
    expect(f.onHand('Al Fakher · Jabuka')).toBe(before.jabuka - 10)
    expect(f.onHand('Al Fakher · Menta')).toBe(before.menta - 10)
    expect(f.onHand('Ugalj (kocke)')).toBe(before.ugalj - 3)

    const lineId = f.db.select().from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, order.order_id)).all()[0]!.id
    const result = requestAdjustment(f.db, f.venueId, f.actor('Dino', { device: null }), {
      client_id: randomUUID(),
      order_line_id: lineId,
      kind: 'void',
      reason: 'wrong_entry',
    } as Parameters<typeof requestAdjustment>[3])
    expect(result.applied).toBe(true)

    // Three sale rows, three mirror rows, and the shelf exactly where it was.
    expect(movements('sale_storno')).toHaveLength(3)
    expect(f.onHand('Al Fakher · Jabuka')).toBe(before.jabuka)
    expect(f.onHand('Al Fakher · Menta')).toBe(before.menta)
    expect(f.onHand('Ugalj (kocke)')).toBe(before.ugalj)
  })

  it('bounds the theoretical figure by occurred_at, not by when the row landed', () => {
    const itemId = f.stockItemId('Coca-Cola 0,25 l')
    // Two sales an hour apart in *business* time, both written in the same
    // transaction: what separates them is `occurred_at`, not `created_at`.
    const first = new Date(Date.now() + 3_600_000).toISOString()
    const second = new Date(Date.now() + 7_200_000).toISOString()
    const at = new Date().toISOString()

    f.db.transaction((tx) => {
      for (const occurredAt of [first, second]) {
        insertMovement(tx, f.venueId, {
          stockItemId: itemId, type: 'sale', qtyDelta: -1, unitCostMfen: 90_000,
          occurredAt, createdAt: at,
        })
      }
    })

    expect(theoreticalAt(f.db, f.venueId, itemId, at)).toBe(79)
    expect(theoreticalAt(f.db, f.venueId, itemId, first)).toBe(78)
    expect(theoreticalAt(f.db, f.venueId, itemId, second)).toBe(77)
    expect(onHand(f.db, f.venueId, itemId)).toBe(77)
  })

  it('reports the four statuses and the estimated flag on GET /api/stock', () => {
    setCosts('Cedevita', 0, 0)
    f.db.update(schema.stockItems)
      .set({ avgCostMfen: 0, parQty: 100 })
      .where(eq(schema.stockItems.id, f.stockItemId('Fanta 0,25 l')))
      .run()

    const stock = getStock(f.db, f.venueId)
    expect(stock.find(i => i.name === 'Cedevita')!.status).toBe('bez_cijene')
    // 72 on hand against a par of 100.
    expect(stock.find(i => i.name === 'Fanta 0,25 l')!.status).toBe('nisko')
    expect(stock.find(i => i.name === 'Fanta 0,25 l')!.estimated).toBe(true)
    expect(stock.find(i => i.name === 'Coca-Cola 0,25 l')!.status).toBe('ok')
    expect(stock.find(i => i.name === 'Coca-Cola 0,25 l')!.estimated).toBe(false)
  })
})

// ===========================================================================
// Deliveries
// ===========================================================================

describe('a delivery', () => {
  it('turns 2 gajbe + 5 into 53 and prices the base unit in milli-feninga', () => {
    const delivery = createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: 'Coca-Cola HBC',
      invoice_no: 'R-77',
      lines: [{
        stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
        packs: 2, loose: 5, line_cost_fen: 5300,
      }],
    })

    expect(delivery.lines[0]!.qty).toBe(53)
    expect(delivery.lines[0]!.unit_cost_mfen).toBe(100_000)
    expect(delivery.total_fen).toBe(5300)
    expect(f.onHand('Coca-Cola 0,25 l')).toBe(79 + 53)
    expect(entries('delivery_posted')).toHaveLength(1)
  })

  it('mixes two prices into the moving average, and agrees with a full replay', () => {
    // The seed's opening: 79 bottles at 90 000 mfen.
    expect(itemRow('Coca-Cola 0,25 l').avgCostMfen).toBe(90_000)

    createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: 'Coca-Cola HBC',
      lines: [{
        stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
        packs: 1, loose: 0, line_cost_fen: 2400,
      }],
    })

    // (79 × 90 000 + 24 × 100 000) / 103 = 92 330,09… → 92 330.
    expect(itemRow('Coca-Cola 0,25 l').avgCostMfen).toBe(92_330)
    expect(itemRow('Coca-Cola 0,25 l').lastCostMfen).toBe(100_000)

    f.clock.advance(3600)
    createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: 'Coca-Cola HBC',
      lines: [{
        stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
        packs: 1, loose: 0, line_cost_fen: 1920,
      }],
    })
    // (103 × 92 330 + 24 × 80 000) / 127 = 89 999,92… → 90 000.
    expect(itemRow('Coca-Cola 0,25 l').avgCostMfen).toBe(90_000)

    // The cached number is a number nothing checks unless something checks it.
    const replayed = recomputeAvgCost(f.db, f.venueId)
    for (const item of f.db.select().from(schema.stockItems).all()) {
      expect(replayed.get(item.id), item.name).toBe(item.avgCostMfen)
    }
  })

  it('refuses a zero-cost line at the schema, before it can touch the average', () => {
    const parsed = createDeliveryBody.safeParse({
      client_id: randomUUID(),
      supplier_name: 'Neko',
      lines: [{ stock_item_id: randomUUID(), packs: 1, loose: 0, line_cost_fen: 0 }],
    })
    expect(parsed.success).toBe(false)
  })

  it('refuses packs on an item with no pack size', () => {
    refuses(() => createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: 'Neko',
      lines: [{
        stock_item_id: f.stockItemId('Red Bull'),
        packs: 2, loose: 0, line_cost_fen: 1000,
      }],
    }), 'INVALID_QTY', 400)
    expect(f.onHand('Red Bull')).toBe(28)
  })

  it('replays a retried post instead of booking the crates twice', () => {
    const clientId = randomUUID()
    const body = {
      client_id: clientId,
      supplier_name: 'Coca-Cola HBC',
      lines: [{
        stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
        packs: 1, loose: 0, line_cost_fen: 2400,
      }],
    }

    const first = createDelivery(f.db, f.venueId, f.adminActor(), body)
    const second = createDelivery(f.db, f.venueId, f.adminActor(), body)

    expect(first.already_applied).toBe(false)
    expect(second.already_applied).toBe(true)
    expect(second.id).toBe(first.id)
    expect(f.onHand('Coca-Cola 0,25 l')).toBe(79 + 24)
    expect(f.db.select().from(schema.deliveries).all()).toHaveLength(1)
  })

  it('lets the bartender receive goods only when the setting says so', () => {
    f.settingsWith({ bartender_can_receive_goods: false })
    const body = () => ({
      client_id: randomUUID(),
      supplier_name: 'Coca-Cola HBC',
      lines: [{
        stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
        packs: 1, loose: 0, line_cost_fen: 2400,
      }],
    })

    refuses(
      () => createDelivery(f.db, f.venueId, f.actor('Emir'), body()),
      'RECEIVING_FORBIDDEN', 403,
    )

    f.settingsWith({ bartender_can_receive_goods: true })
    expect(createDelivery(f.db, f.venueId, f.actor('Emir'), body()).status).toBe('posted')
  })

  it('reverses once, and refuses the second reversal', () => {
    const delivery = createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: 'Coca-Cola HBC',
      lines: [{
        stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
        packs: 1, loose: 0, line_cost_fen: 2400,
      }],
    })
    expect(f.onHand('Coca-Cola 0,25 l')).toBe(103)

    const reversed = reverseDelivery(
      f.db, f.venueId, f.adminActor(), delivery.id, { note: 'pogrešna faktura' },
    )
    expect(reversed.reversed_at).not.toBeNull()
    expect(f.onHand('Coca-Cola 0,25 l')).toBe(79)
    // A reversal is not a purchase price: the average stays where the delivery
    // put it.
    expect(itemRow('Coca-Cola 0,25 l').avgCostMfen).toBe(92_330)
    expect(entries('delivery_reversed')).toHaveLength(1)

    refuses(
      () => reverseDelivery(f.db, f.venueId, f.adminActor(), delivery.id, { note: 'opet' }),
      'DELIVERY_ALREADY_REVERSED', 409,
    )
  })
})

// ===========================================================================
// The late-sync offset
// ===========================================================================

describe('a movement dated before a confirmed count', () => {
  it('gets a late_sync offset, so the count is not charged for it twice', () => {
    const shiftId = f.openShift({ members: ['Emir', 'Amar'] })
    expect(shiftId).toBeTruthy()

    // The shelf is counted at 28 Red Bulls and the count is signed.
    const count = submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full', phase: 'adhoc',
      lines: [{ stock_item_id: f.stockItemId('Red Bull'), packs: 0, loose: 28 }],
    })
    confirmCount(f.db, f.venueId, f.adminActor(), count.id, {})
    const after = f.onHand('Red Bull')

    // A phone in a coat pocket flushes a round it locked before the count.
    f.clock.advance(120)
    lock('Amar', 'Sto 7', [line('Red Bull', 1)], iso(600_000))

    const offsets = movements('late_sync')
    expect(offsets).toHaveLength(1)
    expect(offsets[0]!.qtyDelta).toBe(1)
    expect(offsets[0]!.refType).toBe('stock_movement')
    expect(offsets[0]!.note).toMatch(/kasno sinhronizovano · popis/)

    // The sale is in the ledger and the shelf did not move: the count already
    // knew about that bottle.
    expect(movements('sale').some(m => m.stockItemId === f.stockItemId('Red Bull'))).toBe(true)
    expect(f.onHand('Red Bull')).toBe(after)
  })
})

// ===========================================================================
// Opening stock
// ===========================================================================

describe('POST /api/stock/opening', () => {
  it('prices every zero-cost item, once, and then refuses one that has been sold', () => {
    // The live venue's rows, as they really are before this screen runs.
    f.db.update(schema.stockItems).set({ avgCostMfen: 0, lastCostMfen: 0 }).run()
    const items = f.db.select().from(schema.stockItems).all()
    expect(items).toHaveLength(19)

    const result = setOpeningStock(f.db, f.venueId, f.adminActor(), {
      note: 'prvo čitanje',
      lines: items.map(item => ({
        stock_item_id: item.id,
        qty: onHand(f.db, f.venueId, item.id),
        unit_cost_mfen: 12_345,
      })),
    })

    expect(result).toHaveLength(19)
    expect(result.every(i => i.avg_cost_mfen === 12_345)).toBe(true)
    expect(result.every(i => !i.estimated_cost)).toBe(true)
    expect(entries('opening_set')).toHaveLength(1)
    expect(getStock(f.db, f.venueId).every(i => i.status !== 'bez_cijene')).toBe(true)

    // Once a bowl has been sold against an item its history is real.
    f.openShift({ members: ['Amar'] })
    lock('Amar', 'Sto 7', [line('Coca-Cola', 1)])
    refuses(() => setOpeningStock(f.db, f.venueId, f.adminActor(), {
      lines: [{
        stock_item_id: f.stockItemId('Coca-Cola 0,25 l'), qty: 79, unit_cost_mfen: 90_000,
      }],
    }), 'OPENING_LOCKED', 409)
  })

  it('corrects the quantity when the first read-out had a typo', () => {
    setOpeningStock(f.db, f.venueId, f.adminActor(), {
      lines: [{ stock_item_id: f.stockItemId('Limun'), qty: 30, unit_cost_mfen: 50_000 }],
    })

    expect(f.onHand('Limun')).toBe(30)
    expect(movements('correction')).toHaveLength(1)
    expect(movements('correction')[0]!.qtyDelta).toBe(10)
  })
})

// ===========================================================================
// Waste
// ===========================================================================

describe('otpis', () => {
  it('writes the movement immediately and prices it from the moving average', () => {
    f.openShift({ members: ['Amar'] })
    const waste = logWaste(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      stock_item_id: f.stockItemId('Šećer'),
      qty: 100,
      reason: 'prosuto',
    })

    // 200 mfen a gram × 100 g = 20 000 mfen = 20 fen.
    expect(waste.cost_fen).toBe(20)
    expect(waste.needs_approval).toBe(false)
    expect(waste.estimated).toBe(false)
    expect(f.onHand('Šećer')).toBe(4100)
    expect(entries('waste_logged')).toHaveLength(1)
  })

  it('replays a retried post', () => {
    f.openShift({ members: ['Amar'] })
    const clientId = randomUUID()
    const body = {
      client_id: clientId,
      stock_item_id: f.stockItemId('Šećer'),
      qty: 50,
      reason: 'prosuto' as const,
    }

    const first = logWaste(f.db, f.venueId, f.actor('Amar'), body)
    const second = logWaste(f.db, f.venueId, f.actor('Amar'), body)

    expect(second.id).toBe(first.id)
    expect(second.already_applied).toBe(true)
    expect(f.onHand('Šećer')).toBe(4150)
  })

  it('keeps a waiter to the two reasons that are visibly accidents', () => {
    f.openShift({ members: ['Amar'] })
    refuses(() => logWaste(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
      qty: 1,
      reason: 'degustacija',
    }), 'REASON_FORBIDDEN', 403)

    // The bartender is a default approver, so he may write any of them.
    expect(logWaste(f.db, f.venueId, f.actor('Emir'), {
      client_id: randomUUID(),
      stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
      qty: 1,
      reason: 'degustacija',
    }).id).toBeTruthy()
  })

  it('flags a waiter breaking a bottle, and a big enough loss whoever writes it', () => {
    f.openShift({ members: ['Amar', 'Emir'] })

    const bottle = logWaste(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
      qty: 1,
      reason: 'razbijeno',
    })
    expect(bottle.needs_approval).toBe(true)

    // 10,00 KM is the default `waste_pin_threshold_fen`: 84 g of tobacco at
    // 12 fen a gram is 10,08 KM, which crosses it even for the bartender.
    const tin = logWaste(f.db, f.venueId, f.actor('Emir'), {
      client_id: randomUUID(),
      stock_item_id: f.stockItemId('Al Fakher · Jabuka'),
      qty: 84,
      reason: 'isteklo',
    })
    expect(tin.cost_fen).toBe(1008)
    expect(tin.needs_approval).toBe(true)
  })

  it('flags the fourth otpis of one person\'s shift and says so in the Dnevnik', () => {
    f.openShift({ members: ['Emir'] })
    const sugar = (n: number) => logWaste(f.db, f.venueId, f.actor('Emir'), {
      client_id: randomUUID(),
      stock_item_id: f.stockItemId('Šećer'),
      qty: n,
      reason: 'prosuto',
    })

    expect(sugar(10).needs_approval).toBe(false)
    expect(sugar(10).needs_approval).toBe(false)
    expect(sugar(10).needs_approval).toBe(false)
    const fourth = sugar(10)

    expect(fourth.needs_approval).toBe(true)
    expect(entries('waste_capped')).toHaveLength(1)
    expect(JSON.parse(entries('waste_capped')[0]!.bodyJson).count).toBe(4)
    // And the ledger has all four of them: the sugar was spilled either way.
    expect(f.onHand('Šećer')).toBe(4200 - 40)
  })

  it('acknowledges once', () => {
    f.openShift({ members: ['Amar', 'Emir'] })
    const waste = logWaste(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
      qty: 1,
      reason: 'razbijeno',
    })

    const approved = approveWaste(f.db, f.venueId, f.actor('Emir'), waste.id)
    expect(approved.approved_by_name).toBe('Emir')

    refuses(
      () => approveWaste(f.db, f.venueId, f.actor('Emir'), waste.id),
      'WASTE_ALREADY_APPROVED', 409,
    )
  })
})

// ===========================================================================
// Corrections
// ===========================================================================

describe('a correction', () => {
  it('moves the shelf and names itself in the Dnevnik', () => {
    const item = correctStock(f.db, f.venueId, f.adminActor(), {
      stock_item_id: f.stockItemId('Limun'),
      type: 'correction',
      qty_delta: -4,
      note: 'četiri su se pokvarila',
    })

    expect(item.on_hand).toBe(16)
    expect(entries('stock_corrected')).toHaveLength(1)
    expect(movements('correction')[0]!.unitCostMfen).toBe(50_000)
  })

  it('insists a return to the supplier leaves the shelf', () => {
    refuses(() => correctStock(f.db, f.venueId, f.adminActor(), {
      stock_item_id: f.stockItemId('Limun'),
      type: 'return_supplier',
      qty_delta: 4,
      note: 'vraćeno dobavljaču',
    }), 'INVALID_QTY', 400)
  })
})

// ===========================================================================
// Counts
// ===========================================================================

describe('a count', () => {
  it('opens the shift itself when the opening count is the first tap of the night', () => {
    const count = submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full', phase: 'open',
      lines: [{ stock_item_id: f.stockItemId('Red Bull'), packs: 0, loose: 28 }],
    })

    expect(count.shift_id).not.toBeNull()
    expect(entries('shift_opened')).toHaveLength(1)
    // Whoever submitted the opening count answers for the stock this shift.
    const shift = f.db.select().from(schema.shifts)
      .where(eq(schema.shifts.id, count.shift_id!)).get()!
    expect(shift.stockCustodianId).toBe(f.userId('Emir'))
  })

  it('refuses a closing count when there is nothing to close against', () => {
    refuses(() => submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full', phase: 'close',
      lines: [{ stock_item_id: f.stockItemId('Red Bull'), packs: 0, loose: 28 }],
    }), 'NO_OPEN_SHIFT', 409)
  })

  it('allows one opening count per shift and any number of spot checks', () => {
    f.openShift({ members: ['Emir'] })
    const body = (phase: 'open' | 'adhoc') => ({
      kind: 'full' as const, phase,
      lines: [{ stock_item_id: f.stockItemId('Red Bull'), packs: 0, loose: 28 }],
    })

    submitCount(f.db, f.venueId, f.actor('Emir'), body('open'))
    refuses(
      () => submitCount(f.db, f.venueId, f.actor('Emir'), body('open')),
      'COUNT_EXISTS', 409,
    )

    submitCount(f.db, f.venueId, f.actor('Emir'), body('adhoc'))
    submitCount(f.db, f.venueId, f.actor('Emir'), body('adhoc'))
    expect(listCounts(f.db, f.venueId).filter(c => c.phase === 'adhoc')).toHaveLength(2)
  })

  it('subtracts the tare from what the scale said', () => {
    f.db.update(schema.stockItems).set({ tareG: 45 })
      .where(eq(schema.stockItems.id, f.stockItemId('Al Fakher · Jabuka'))).run()
    f.openShift({ members: ['Emir'] })

    const count = submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full', phase: 'adhoc',
      lines: [{
        stock_item_id: f.stockItemId('Al Fakher · Jabuka'),
        weighed_g: 688, note: 'kutija na vagi',
      }],
    })

    expect(count.lines[0]!.counted_qty).toBe(643)
    expect(count.lines[0]!.variance_qty).toBe(0)
  })

  it('wants a note on anything past the tolerance', () => {
    f.openShift({ members: ['Emir'] })
    refuses(() => submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full', phase: 'adhoc',
      lines: [{ stock_item_id: f.stockItemId('Red Bull'), packs: 0, loose: 26 }],
    }), 'NOTE_REQUIRED', 422)

    expect(f.db.select().from(schema.stockCounts).all()).toHaveLength(0)
  })

  it('insists a spot count carries every spot item', () => {
    f.openShift({ members: ['Emir'] })
    refuses(() => submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'spot', phase: 'adhoc',
      lines: [{ stock_item_id: f.stockItemId('Red Bull'), packs: 0, loose: 28 }],
    }), 'LINES_MISSING', 422)
  })

  it('writes exactly the non-zero adjust rows, dated at the submit', () => {
    f.openShift({ members: ['Emir'] })

    const count = submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full', phase: 'adhoc',
      lines: [
        { stock_item_id: f.stockItemId('Red Bull'), packs: 0, loose: 26, note: 'fale dva' },
        { stock_item_id: f.stockItemId('Cedevita'), packs: 0, loose: 30 },
        { stock_item_id: f.stockItemId('Limun'), packs: 0, loose: 22, note: 'našla se dva' },
      ],
    })

    expect(count.status).toBe('submitted')
    expect(count.totals.out_of_tolerance).toBe(2)
    // Red Bull is 200 000 mfen a can: two missing is −4,00 KM. Two extra lemons
    // at 50 000 mfen is +1,00 KM.
    expect(count.totals.variance_fen).toBe(-400 + 100)
    expect(count.lines.every(l => l.applied_adjust === null)).toBe(true)
    expect(pendingCounts(f.db, f.venueId)).toHaveLength(1)

    f.clock.advance(300)
    const result = confirmCount(f.db, f.venueId, f.adminActor(), count.id, {})

    const adjusts = movements('count_adjust')
    expect(adjusts).toHaveLength(2)
    for (const row of adjusts) {
      expect(row.occurredAt).toBe(count.submitted_at)
      expect(row.refType).toBe('stock_count_line')
    }
    expect(adjusts.find(r => r.stockItemId === f.stockItemId('Red Bull'))!.qtyDelta).toBe(-2)
    expect(adjusts.find(r => r.stockItemId === f.stockItemId('Limun'))!.qtyDelta).toBe(2)

    expect(f.onHand('Red Bull')).toBe(26)
    expect(f.onHand('Limun')).toBe(22)
    expect(f.onHand('Cedevita')).toBe(30)

    expect(result.count.status).toBe('confirmed')
    expect(result.lines.every(l => l.late_delta === 0)).toBe(true)
    // A confirmed line records `0` rather than `null`: "counted, and the shelf
    // was right" is not the same fact as "never confirmed".
    expect(result.count.lines.find(l => l.item_name === 'Cedevita')!.applied_adjust).toBe(0)

    expect(entries('count_confirmed')).toHaveLength(1)
    expect(entries('count_confirmed')[0]!.resolvesId).toBe(entries('count_submitted')[0]!.id)

    refuses(
      () => confirmCount(f.db, f.venueId, f.adminActor(), count.id, {}),
      'COUNT_ALREADY_CONFIRMED', 409,
    )
  })

  it('folds a round that synced between submit and confirm into late_delta', () => {
    f.openShift({ members: ['Emir', 'Amar'] })

    const count = submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full', phase: 'adhoc',
      lines: [{ stock_item_id: f.stockItemId('Red Bull'), packs: 0, loose: 27, note: 'fali jedan' }],
    })
    expect(count.lines[0]!.variance_qty).toBe(-1)

    // A phone flushes a round it locked ten minutes before the count.
    f.clock.advance(120)
    lock('Amar', 'Sto 7', [line('Red Bull', 1)], iso(600_000))

    const result = confirmCount(f.db, f.venueId, f.adminActor(), count.id, {})

    // The theoretical figure at `submitted_at` now includes that can, so the
    // shelf was right after all and the count adjusts nothing.
    expect(result.lines[0]!.submitted_variance).toBe(-1)
    expect(result.lines[0]!.applied_adjust).toBe(0)
    expect(result.lines[0]!.late_delta).toBe(1)
    expect(movements('count_adjust')).toHaveLength(0)
    expect(f.onHand('Red Bull')).toBe(27)
  })

  it('refuses to confirm a variance it cannot price, and names the item', () => {
    setCosts('Cedevita', 0, 0)
    f.openShift({ members: ['Emir'] })

    const count = submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full', phase: 'adhoc',
      lines: [{ stock_item_id: f.stockItemId('Cedevita'), packs: 0, loose: 25, note: 'fali pet' }],
    })

    try {
      confirmCount(f.db, f.venueId, f.adminActor(), count.id, {})
      throw new Error('expected PRICE_MISSING')
    } catch (err) {
      const e = err as { code: string, data?: { item_ids?: string[] } }
      expect(e.code).toBe('PRICE_MISSING')
      expect(e.data?.item_ids).toEqual([f.stockItemId('Cedevita')])
    }
    expect(movements('count_adjust')).toHaveLength(0)
  })

  it('confirms an item priced only by its last cost, and says it is estimated', () => {
    // What the shelf cost last time is a far better answer than 0,00 KM.
    setCosts('Cedevita', 0, 70_000)
    f.openShift({ members: ['Emir'] })

    const count = submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full', phase: 'adhoc',
      lines: [{ stock_item_id: f.stockItemId('Cedevita'), packs: 0, loose: 25, note: 'fali pet' }],
    })

    expect(count.lines[0]!.estimated).toBe(true)
    expect(count.lines[0]!.unit_cost_mfen).toBe(70_000)
    expect(count.lines[0]!.variance_fen).toBe(-350)

    const result = confirmCount(f.db, f.venueId, f.adminActor(), count.id, {})
    expect(result.lines[0]!.applied_adjust).toBe(-5)
    expect(unitCost(itemRow('Cedevita')).estimated).toBe(true)
  })
})

// ===========================================================================
// The outbox gate
// ===========================================================================

describe('a phone that still holds rounds', () => {
  /** Amar locks a round on `deviceId`, which then reports an outbox. */
  function shiftWithOutbox(opts: { lastSeenAt?: string }): string {
    f.openShift({ members: ['Amar', 'Emir'] })
    const deviceId = enrol('Amarov telefon', { lastSeenAt: opts.lastSeenAt })
    createOrder(f.db, f.venueId, f.actor('Amar', { device: deviceId }), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [line('Kafa', 1)],
    })
    f.db.update(schema.devices).set({ pendingCount: 1 })
      .where(eq(schema.devices.id, deviceId)).run()
    return deviceId
  }

  /** A one-line count of the Red Bull fridge. */
  const countBody = (loose: number, note?: string) => ({
    kind: 'full' as const,
    phase: 'adhoc' as const,
    lines: [{ stock_item_id: f.stockItemId('Red Bull'), packs: 0, loose, note }],
  })

  it('blocks the submit while it is fresh', () => {
    shiftWithOutbox({})
    refuses(
      () => submitCount(f.db, f.venueId, f.actor('Emir'), countBody(28)),
      'PENDING_OUTBOX', 409,
    )
  })

  it('reports a phone in a coat pocket instead of blocking on it', () => {
    // `heartbeat_fresh_s` is 600 s; this one has not been heard from in an hour.
    shiftWithOutbox({ lastSeenAt: iso(3_600_000) })

    const count = submitCount(f.db, f.venueId, f.actor('Emir'), countBody(28))

    expect(count.stale_devices).toHaveLength(1)
    expect(count.stale_devices[0]!.label).toBe('Amarov telefon')
    expect(count.stale_devices[0]!.pending_count).toBe(1)
  })

  it('lets an admin override, and writes down that he did', () => {
    shiftWithOutbox({})

    const count = submitCount(f.db, f.venueId, f.adminActor(), {
      ...countBody(28), override: true,
    })

    expect(count.override_by).toBe(f.userId('Haris'))
    expect(entries('override').some(e => JSON.parse(e.bodyJson).what === 'unsent')).toBe(true)
  })

  it('blocks the confirm too — that is the one that writes the adjustment', () => {
    const deviceId = shiftWithOutbox({ lastSeenAt: iso(3_600_000) })

    const count = submitCount(f.db, f.venueId, f.actor('Emir'), countBody(26, 'fale dva'))

    // The phone comes back on wifi with the round still queued.
    f.db.update(schema.devices).set({ lastSeenAt: new Date().toISOString() })
      .where(eq(schema.devices.id, deviceId)).run()

    refuses(
      () => confirmCount(f.db, f.venueId, f.adminActor(), count.id, {}),
      'PENDING_OUTBOX', 409,
    )
    expect(movements('count_adjust')).toHaveLength(0)

    // With the override it goes through.
    confirmCount(f.db, f.venueId, f.adminActor(), count.id, { override: true })
    expect(movements('count_adjust')).toHaveLength(1)
  })
})
