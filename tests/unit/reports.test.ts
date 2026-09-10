/**
 * The owner's three stock reads (`docs/BACKEND.md` §6.8, §11).
 *
 * Two of the assertions here are the *reason* the reports exist, and both are
 * the owner's own arithmetic rather than a developer's:
 *
 * **Nargila.** *"Petnaest kila duhana je ušlo, četiri kile su ostale — znači
 * jedanaest kila je otišlo, a to je 550 lula. Prodali smo 500."* The fifty bowls
 * between those two numbers are what he wants to see every month, and they are
 * priced at the cheapest bowl on the menu, because the honest reading of a
 * missing bowl is the least it could have been worth.
 *
 * **Kategorije.** Its *prodaja* column and `summaries.ts`'s `promet_fen` are the
 * same money counted two ways — by category over a period, and by shift. If they
 * ever disagree, one of the two screens is lying to the owner about his own
 * takings, and there is no way to tell which from the outside. So the test adds
 * them both up over the same nights and insists on the fen.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createOrder } from '../../server/services/orders'
import { requestAdjustment } from '../../server/services/adjustments'
import { summarizeShift } from '../../server/services/summaries'
import { correctStock, createDelivery } from '../../server/services/stock'
import { confirmCount, submitCount } from '../../server/services/counts'
import {
  categoriesReport, itemMovements, monthBounds, nargilaReport, ownerStock, periodBounds,
} from '../../server/services/reports'
import { businessDate, nextBusinessDate } from '#shared/dates'
import { makeFixture, schema, type Fixture } from '../helpers/db'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

/** The business month we are in right now — 02:30 on the 1st is still last month. */
function thisMonth(): string {
  return businessDate(new Date().toISOString()).slice(0, 7)
}

function period(month = thisMonth()) {
  const { fromDay, toDay } = monthBounds(month)
  return periodBounds(f.db, f.venueId, fromDay, toDay)
}

const TOBACCO = [
  'Al Fakher · Jabuka', 'Al Fakher · Menta', 'Al Fakher · Grožđe',
  'Al Fakher · Limun-menta', 'Al Fakher · Lubenica', 'Al Fakher · Borovnica',
]

const line = (product: string, qty = 1, flavours?: string[]) => ({
  id: randomUUID(),
  product_id: f.productId(product),
  qty,
  ...(flavours ? { flavour_ids: flavours.map(f.stockItemId) } : {}),
})

function lock(who: string, table: string, lines: ReturnType<typeof line>[]) {
  return createOrder(f.db, f.venueId, f.actor(who), {
    client_id: randomUUID(), table_id: f.tableId(table), lines,
  } as Parameters<typeof createOrder>[3])
}

// ===========================================================================
// Nargila
// ===========================================================================

/** The empty Al Fakher jar, as `server/database/seed.ts` sets it. */
const TOBACCO_TARE_G = 40

describe('the nargila report', () => {
  /**
   * The owner's month: 15 kg of tobacco in, 4 kg counted at the end, 500 bowls
   * on the till.
   */
  function ownersMonth(): void {
    f.openShift({ members: ['Emir', 'Dino'] })

    // Last month closed on an empty cupboard, counted and signed. That is what
    // opens this one — a count before `from` beats every computed figure.
    const before = new Date(Date.parse(period().from) - 3_600_000).toISOString()
    const lastMonth = submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full',
      phase: 'adhoc',
      lines: TOBACCO.map(name => ({ stock_item_id: f.stockItemId(name), weighed_g: 0 })),
    }, before)
    confirmCount(f.db, f.venueId, f.adminActor(), lastMonth.id, {}, before)

    // 15 000 g across the six aromas, 2 500 g each at 12 fen a gram.
    createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: 'Al Fakher BiH',
      invoice_no: 'AF-9',
      lines: TOBACCO.map(name => ({
        stock_item_id: f.stockItemId(name),
        packs: 0, loose: 2500, line_cost_fen: 30_000,
      })),
    })

    // 500 bowls: `qty` is capped at 99 a line, so five full lines and a short one.
    lock('Dino', 'Sto 16', [
      ...[0, 1, 2, 3, 4].map(() => line('Nova lula', 99, ['Al Fakher · Jabuka'])),
      line('Nova lula', 5, ['Al Fakher · Jabuka']),
    ])

    // The closing count: 4 000 g left across the six tins. `weighed_g` is what
    // the scale reads — the tin **and** what is in it — so each line carries the
    // seed's 40 g jar on top, and `submitCount` subtracts it (PHASE3 §1.3).
    const left = [700, 700, 700, 700, 600, 600]
    const count = submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full',
      phase: 'adhoc',
      lines: TOBACCO.map((name, i) => ({
        stock_item_id: f.stockItemId(name),
        weighed_g: left[i]! + TOBACCO_TARE_G,
        note: 'izvagano na kraju mjeseca',
      })),
    })
    confirmCount(f.db, f.venueId, f.adminActor(), count.id, {})
  }

  it('reproduces 15 kg in, 4 kg left, 550 expected bowls against 500 sold', () => {
    ownersMonth()
    const { from, to } = period()
    const report = nargilaReport(f.db, f.venueId, from, to, thisMonth())

    expect(report.pocetno_g).toBe(0)
    expect(report.primljeno_g).toBe(15_000)
    expect(report.zavrsno_g).toBe(4000)
    expect(report.potroseno_g).toBe(11_000)
    expect(report.prodano_lula).toBe(500)
    // 11 000 g at the venue's 20 g norm is 550 bowls; the till says 500.
    expect(report.ocekivano_lula).toBe(550)
    expect(report.razlika_lula).toBe(50)
    // Priced at the cheapest bowl on the menu — *Nova lula*, 10,00 KM.
    expect(report.razlika_fen).toBe(50 * 1000)
    // 22 g a bowl against a 20 g norm, inside the ±15 % band.
    expect(report.grams_per_bowl).toBe(22)
    expect(report.within_band).toBe(true)
    // The closing figure was counted, not computed.
    expect(report.estimated).toBe(false)
    expect(report.items).toHaveLength(6)
  })

  it('opens the next month on the figure this one closed with', () => {
    ownersMonth()
    const nextMonth = nextBusinessDate(monthBounds(thisMonth()).toDay).slice(0, 7)
    const { from, to } = period(nextMonth)

    const report = nargilaReport(f.db, f.venueId, from, to, nextMonth)

    expect(report.pocetno_g).toBe(4000)
    expect(report.primljeno_g).toBe(0)
    expect(report.prodano_lula).toBe(0)
    // Nothing was counted inside the new month, so the closing figure is the
    // theoretical one and the report says so rather than pretending.
    expect(report.estimated).toBe(true)
  })

  it('reads the shelf the owner found as opening stock, not as a delivery', () => {
    // The seed's `opening` rows are the *Početno stanje* screen's: 2 243 g of
    // tobacco already in the cupboard the evening the app was switched on. With
    // no count before the period they belong to `pocetno_g` — counting them as
    // *primljeno* would claim two kilos arrived that never did, and dropping
    // them makes *potrošeno* negative.
    const { from, to } = period()
    const report = nargilaReport(f.db, f.venueId, from, to)

    expect(report.pocetno_g).toBe(2243)
    expect(report.primljeno_g).toBe(0)
    expect(report.zavrsno_g).toBe(2243)
    expect(report.potroseno_g).toBe(0)
  })

  it('answers "no answer" rather than 0 g a bowl when nothing was sold', () => {
    const { from, to } = period()
    expect(nargilaReport(f.db, f.venueId, from, to).grams_per_bowl).toBeNull()
  })
})

// ===========================================================================
// Kategorije
// ===========================================================================

describe('the categories report', () => {
  it('reconciles prodaja to the shift summaries, to the fen', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Dino', 'Emir'] })

    lock('Amar', 'Sto 7', [line('Kafa', 3), line('Coca-Cola', 2)])
    lock('Dino', 'Sto 16', [line('Nargila', 1, ['Al Fakher · Menta']), line('Čaj', 1)])
    const voided = lock('Amar', 'Sto 8', [line('Red Bull', 2)])

    // One applied self-void, so the "− applied void" term is not vacuous.
    const lineId = f.db.select().from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, voided.order_id)).all()[0]!.id
    const result = requestAdjustment(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      order_line_id: lineId,
      kind: 'void',
      reason: 'wrong_entry',
    } as Parameters<typeof requestAdjustment>[3])
    expect(result.applied).toBe(true)

    const { from, to } = period()
    const report = categoriesReport(f.db, f.venueId, from, to)
    const summary = summarizeShift(f.db, f.venueId, shiftId, new Date().toISOString())

    expect(report.totals.prodaja_fen).toBe(summary.promet_fen)
    // …and the split matches category for category, not just in total. A
    // category the report drops (every column zero — the voided Red Bull's) is
    // a zero row on the summary too, which is the same statement.
    for (const row of summary.by_category) {
      expect(
        report.rows.find(r => r.category_id === row.category_id)?.prodaja_fen ?? 0,
        row.category_id,
      ).toBe(row.fen)
    }
  })

  it('counts a delivery as nabavka and gives a reversal back', () => {
    createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: 'Coca-Cola HBC',
      lines: [{
        stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
        packs: 2, loose: 0, line_cost_fen: 4800,
      }],
    })

    const { from, to } = period()
    const bezalkoholna = () => categoriesReport(f.db, f.venueId, from, to)
      .rows.find(r => r.category_name === 'Bezalkoholna')!

    expect(bezalkoholna().nabavka_fen).toBe(4800)

    // Goods that go back to the supplier are money that never left.
    correctStock(f.db, f.venueId, f.adminActor(), {
      stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
      type: 'return_supplier',
      qty_delta: -24,
      note: 'polovina gajbe je bila razbijena',
    })
    // 24 bottles at the new 100 000 mfen average… the moving average moved, so
    // read what the movement actually carried rather than assuming.
    const returned = f.db.select().from(schema.stockMovements)
      .where(eq(schema.stockMovements.type, 'return_supplier')).all()[0]!
    expect(bezalkoholna().nabavka_fen)
      .toBe(4800 + Math.round((returned.qtyDelta * returned.unitCostMfen) / 1000))
  })

  it('prices utrošak and otpis off the movements, rounding once at the end', () => {
    f.openShift({ members: ['Amar'] })
    lock('Amar', 'Sto 7', [line('Kafa', 1)])

    const { from, to } = period()
    const report = categoriesReport(f.db, f.venueId, from, to)

    // A kafa is 7 g of coffee at 1 800 mfen and 5 g of sugar at 200 mfen: the
    // coffee sits in *Kafa*, the sugar in *Ostalo*.
    expect(report.rows.find(r => r.category_name === 'Kafa')!.utrosak_fen).toBe(13)
    expect(report.rows.find(r => r.category_name === 'Ostalo')!.utrosak_fen).toBe(1)
    expect(report.rows.find(r => r.category_name === 'Kafa')!.marza_fen).toBe(150 - 13)
  })
})

// ===========================================================================
// Roba
// ===========================================================================

describe('the owner stock read', () => {
  it('values the shelf and counts what needs attention', () => {
    const report = ownerStock(f.db, f.venueId)

    expect(report.items).toHaveLength(20)
    expect(report.totals.items).toBe(20)
    expect(report.totals.bez_cijene).toBe(0)

    const cola = report.items.find(i => i.name === 'Coca-Cola 0,25 l')!
    expect(cola.on_hand).toBe(79)
    // 79 × 90 000 mfen = 7 110 000 mfen = 7 110 fen = 71,10 KM.
    expect(cola.value_fen).toBe(7110)
    expect(cola.status).toBe('ok')
  })

  it('pages one item\'s ledger, newest first, with the on-hand after each row', () => {
    f.openShift({ members: ['Amar'] })
    lock('Amar', 'Sto 7', [line('Coca-Cola', 1)])
    createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: 'Coca-Cola HBC',
      lines: [{
        stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
        packs: 1, loose: 0, line_cost_fen: 2400,
      }],
    })

    const page = itemMovements(f.db, f.venueId, f.stockItemId('Coca-Cola 0,25 l'))

    expect(page.item.on_hand).toBe(102)
    expect(page.rows).toHaveLength(3)
    expect(page.rows[0]!.running_on_hand).toBe(102)
    expect(page.rows[0]!.type).toBe('delivery')
    expect(page.rows.at(-1)!.type).toBe('opening')
    expect(page.rows.at(-1)!.running_on_hand).toBe(79)
    expect(page.rows[1]!.ref_label).toBe('Sto 7 · narudžba')
    expect(page.next_cursor).toBeNull()
  })
})
