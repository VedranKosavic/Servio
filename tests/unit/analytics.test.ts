/**
 * *Analitika* — one month, and where every line of it comes from (16.09.2026).
 *
 * What this file pins is provenance, not layout: pazar **is** the shifts'
 * promet by business day, *Za predati* and *Dnevnice* **are** the closings,
 * *Roba / Okusi / Žar* **are** posted deliveries cut by stock kind, and the three
 * typed costs behave as the owner described them — *Kirija* carried month to
 * month until it is changed, *Struja* and *Voda* never carried.
 *
 * The fixture clock is the real "now", so the month under test is the café's
 * current one: a delivery cannot be back-dated into another month (its time is
 * clamped), and a test that pretended otherwise would be testing the clamp.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { closeTab } from '../helpers/shifts'
import { closeByBar } from '../../server/services/closings'
import { markUnpaid } from '../../server/services/tabs'
import { createDelivery } from '../../server/services/stock'
import {
  addMonthExtraCost, deleteMonthExtraCost, monthAnalytics, setMonthCost,
} from '../../server/services/analytics'
import { addMonths, monthOf, totalCostFen, totalUnpaidFen } from '#shared/analytics'
import { businessDate } from '#shared/dates'
import { putMonthCostBody } from '#shared/schemas'

let f: Fixture
let month: string

beforeEach(() => {
  f = makeFixture()
  month = monthOf(businessDate(f.clock.now()))
})

afterEach(() => {
  f.close()
})

const sanker = () => f.actor('Emir', { mode: 'sanker' })
const NOTHING_PAID = {
  roba_fen: 0, okusi_fen: 0, zar_fen: 0, kafa_fen: 0, merkator_fen: 0, extras: [],
}

/**
 * One whole shift: opened on `day` at a UTC hour that is inside *Prva smjena*
 * (07–15 local) or *Druga smjena* (15–23 local) whatever the DST offset, the
 * rounds locked and paid, and the šanker's close.
 */
function night(
  day: number, slot: 'prva' | 'druga', rounds: { product: string, qty?: number }[],
): string {
  const date = `${month}-${String(day).padStart(2, '0')}`
  const hour = slot === 'prva' ? '10' : '16'
  const shiftId = f.openShift({
    members: ['Amar', 'Emir'], businessDate: date, at: `${date}T${hour}:00:00.000Z`,
  })
  const round = f.lock('Amar', 'Sto 1', rounds)
  f.pay('Amar', round.tabId, round.totalFen)
  closeTab(f, round.tabId, 'Amar')
  closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: randomUUID(), ...NOTHING_PAID })
  return shiftId
}

describe('pazar, za predati and dnevnice', () => {
  it('folds the month\'s shifts by business day, and the closings for the rest', () => {
    night(1, 'prva', [{ product: 'Red Bull' }]) //                         500
    night(1, 'druga', [{ product: 'Nargila' }, { product: 'Kafa' }]) //  1 650
    night(2, 'prva', [{ product: 'Kafa', qty: 2 }]) //                     300

    const a = monthAnalytics(f.db, f.venueId, month)

    expect(a.pazar_fen).toBe(2_450)
    expect(a.shifts).toBe(3)
    expect(a.closed_shifts).toBe(3)
    // Three closes, the default 90,00 KM each.
    expect(a.costs.dnevnice).toBe(27_000)

    // Every day of the month is on the chart, the ones with nothing at zero.
    expect(a.days[0]).toEqual({ business_date: `${month}-01`, pazar_fen: 2_150, shifts: 2 })
    expect(a.days[1]).toEqual({ business_date: `${month}-02`, pazar_fen: 300, shifts: 1 })
    expect(a.days.at(-1)!.pazar_fen).toBe(0)

    expect(a.best_days.map(d => d.business_date)).toEqual([`${month}-01`, `${month}-02`])
  })

  it('finds the record night of each slot, in the month and ever', () => {
    const bigMorning = night(1, 'prva', [{ product: 'Red Bull' }, { product: 'Red Bull' }])
    night(2, 'prva', [{ product: 'Kafa' }])
    const evening = night(2, 'druga', [{ product: 'Nargila' }])

    const a = monthAnalytics(f.db, f.venueId, month)
    const [prva, druga] = a.records

    expect(prva!.name).toBe('Prva smjena')
    expect(prva!.month).toEqual({ shift_id: bigMorning, business_date: `${month}-01`, pazar_fen: 1_000 })
    expect(prva!.all_time?.shift_id).toBe(bigMorning)
    expect(druga!.name).toBe('Druga smjena')
    expect(druga!.month?.shift_id).toBe(evening)
    expect(druga!.month?.pazar_fen).toBe(1_500)

    // Another month has no record of its own, and the all-time one still stands.
    const earlier = monthAnalytics(f.db, f.venueId, addMonths(month, -1))
    expect(earlier.records[0]!.month).toBeNull()
    expect(earlier.records[0]!.all_time?.pazar_fen).toBe(1_000)
  })

  it('lists the month\'s articles by category, most sold first', () => {
    night(1, 'prva', [{ product: 'Kafa', qty: 3 }, { product: 'Red Bull' }])
    night(2, 'druga', [{ product: 'Kafa' }, { product: 'Nargila' }])

    const a = monthAnalytics(f.db, f.venueId, month)
    const all = a.sold_by_category.flatMap(c => c.items.map(i => [i.name, i.qty, i.fen]))
    expect(all).toEqual(expect.arrayContaining([
      ['Kafa', 4, 600], ['Red Bull', 1, 500], ['Nargila', 1, 1_500],
    ]))
    // Biggest category by KM first; the categories add up to the pazar.
    const fens = a.sold_by_category.map(c => c.fen)
    expect([...fens].sort((x, y) => y - x)).toEqual(fens)
    expect(fens.reduce((sum, fen) => sum + fen, 0)).toBe(a.pazar_fen)
  })

  it('draws twelve months ending with this one', () => {
    night(1, 'prva', [{ product: 'Red Bull' }])
    const a = monthAnalytics(f.db, f.venueId, month)
    expect(a.trend).toHaveLength(12)
    expect(a.trend.at(-1)).toEqual({ month, pazar_fen: 500 })
    expect(a.trend[0]!.month).toBe(addMonths(month, -11))
  })
})

describe('neplaćeno and the till payouts', () => {
  /**
   * The owner's correction of the first *Analitika* (16.09.2026): *Ostaje* was
   * too high, because it kept rounds nobody paid for inside the pazar and did
   * not see what the šanker paid out of the till that is not goods.
   */
  it('takes the unpaid categories off the pazar and the payouts as costs', () => {
    const date = `${month}-01`
    const shiftId = f.openShift({
      members: ['Amar', 'Emir'], businessDate: date, at: `${date}T16:00:00.000Z`,
    })

    const paid = f.lock('Amar', 'Sto 1', [{ product: 'Nargila' }]) //   1 500
    f.pay('Amar', paid.tabId, paid.totalFen)
    closeTab(f, paid.tabId, 'Amar')

    // Two rounds that were drunk and paid for by nobody.
    const mark = (tabId: string, reason: 'policija' | 'osoblje') => {
      const tab = f.db.select().from(schema.tabs).where(eq(schema.tabs.id, tabId)).get()!
      markUnpaid(f.db, f.venueId, f.actor('Amar'), {
        client_id: randomUUID(), tab_client_id: tab.clientId, reason,
      })
    }
    mark(f.lock('Amar', 'Sto 2', [{ product: 'Red Bull' }]).tabId, 'policija') // 500
    mark(f.lock('Amar', 'Sto 3', [{ product: 'Kafa' }]).tabId, 'osoblje') //      150

    // A shift still open counts for nothing — not its pazar, not its unpaid.
    const open = monthAnalytics(f.db, f.venueId, month)
    expect(open.pazar_fen).toBe(0)
    expect(open.shifts).toBe(0)
    expect(open.unpaid_fen).toBe(0)

    closeByBar(f.db, f.venueId, sanker(), shiftId, {
      client_id: randomUUID(),
      ...NOTHING_PAID,
      roba_fen: 1_000, // goods paid from the till: NOT a cost here — Prijem robe is
      kafa_fen: 400,
      merkator_fen: 250,
      extras: [{ label: 'config', amount_fen: 1_500 }],
    })

    const a = monthAnalytics(f.db, f.venueId, month)
    expect(a.pazar_fen).toBe(2_150)
    expect(a.unpaid_fen).toBe(650)
    expect(a.unpaid_fen).toBe(totalUnpaidFen(a.unpaid))

    expect(a.costs.kafa).toBe(400)
    expect(a.costs.merkator).toBe(250)
    expect(a.costs.dodatna).toBe(1_500)
    // The crates paid out of the till are counted once, from the delivery.
    expect(a.costs.roba).toBe(0)

    expect(a.total_cost_fen).toBe(9_000 + 400 + 250 + 1_500)
    expect(a.neto_fen).toBe(2_150 - 650 - a.total_cost_fen)
  })
})

describe('goods from Prijem robe', () => {
  it('cuts posted deliveries into roba, okusi and žar by stock kind', () => {
    createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: 'Veletrgovina',
      lines: [
        { stock_item_id: f.stockItemId('Coca-Cola 0,25 l'), packs: 0, loose: 24, line_cost_fen: 2_400 },
        { stock_item_id: f.stockItemId('Al Fakher · Jabuka'), packs: 0, loose: 250, line_cost_fen: 3_000 },
        { stock_item_id: f.stockItemId('Ugalj (kocke)'), packs: 0, loose: 100, line_cost_fen: 800 },
      ],
    })

    const a = monthAnalytics(f.db, f.venueId, month)
    expect(a.costs.roba).toBe(2_400)
    expect(a.costs.okusi).toBe(3_000)
    expect(a.costs.zar).toBe(800)

    // Next month bought nothing.
    const next = monthAnalytics(f.db, f.venueId, addMonths(month, 1))
    expect(next.costs.roba + next.costs.okusi + next.costs.zar).toBe(0)
  })
})

describe('the costs the owner types', () => {
  it('carries kirija forward, never struja or voda, and takes all of it off the pazar', () => {
    const before = addMonths(month, -1)
    setMonthCost(f.db, f.venueId, f.adminActor(), { month: before, kind: 'kirija', amount_fen: 50_000 })
    setMonthCost(f.db, f.venueId, f.adminActor(), { month: before, kind: 'struja', amount_fen: 9_900 })
    setMonthCost(f.db, f.venueId, f.adminActor(), { month, kind: 'struja', amount_fen: 12_000 })
    night(1, 'prva', [{ product: 'Red Bull' }])

    const a = monthAnalytics(f.db, f.venueId, month)
    expect(a.manual.kirija).toEqual({ amount_fen: 50_000, carried: true, from_month: before })
    expect(a.costs.kirija).toBe(50_000)
    expect(a.costs.struja).toBe(12_000)
    // Last month's electricity is not this month's.
    expect(a.manual.voda).toEqual({ amount_fen: 0, carried: false, from_month: null })

    expect(a.total_cost_fen).toBe(totalCostFen(a.costs))
    expect(a.total_cost_fen).toBe(9_000 + 12_000 + 50_000)
    expect(a.neto_fen).toBe(500 - a.unpaid_fen - a.total_cost_fen)

    // Raising the rent this month does not rewrite last month.
    setMonthCost(f.db, f.venueId, f.adminActor(), { month, kind: 'kirija', amount_fen: 60_000 })
    expect(monthAnalytics(f.db, f.venueId, month).manual.kirija)
      .toEqual({ amount_fen: 60_000, carried: false, from_month: month })
    expect(monthAnalytics(f.db, f.venueId, before).costs.kirija).toBe(50_000)
  })

  it('overwrites rather than adds, and leaves a Dnevnik line with before and after', () => {
    setMonthCost(f.db, f.venueId, f.adminActor(), { month, kind: 'voda', amount_fen: 3_000 })
    const answer = setMonthCost(f.db, f.venueId, f.adminActor(), { month, kind: 'voda', amount_fen: 3_500 })
    expect(answer.costs.voda).toBe(3_500)

    const rows = f.db.select().from(schema.monthCosts)
      .where(and(eq(schema.monthCosts.venueId, f.venueId), eq(schema.monthCosts.kind, 'voda')))
      .all()
    expect(rows).toHaveLength(1)

    const entries = f.db.select().from(schema.logEntries)
      .where(eq(schema.logEntries.kind, 'settings_changed'))
      .all()
      .map(e => JSON.parse(e.bodyJson) as { key: string, before: number, after: number })
      .filter(b => b.key.startsWith('month_cost.'))
    expect(entries.map(b => [b.before, b.after])).toEqual([[0, 3_000], [3_000, 3_500]])
  })

  it('adds named extra costs, once per tap, and takes them off Ostaje', () => {
    night(1, 'prva', [{ product: 'Nargila' }]) // 1 500

    const clientId = randomUUID()
    const body = { client_id: clientId, month, label: '  popravka aparata ', amount_fen: 8_000 }
    addMonthExtraCost(f.db, f.venueId, f.adminActor(), body)
    // The same tap again, on bad wifi: the same cost, not a second one.
    const again = addMonthExtraCost(f.db, f.venueId, f.adminActor(), body)
    const withTaxi = addMonthExtraCost(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(), month, label: 'taksi', amount_fen: 1_200,
    })

    expect(again.extra_costs).toHaveLength(1)
    expect(withTaxi.extra_costs.map(e => [e.label, e.amount_fen]))
      .toEqual([['popravka aparata', 8_000], ['taksi', 1_200]])
    expect(withTaxi.costs.dodatni).toBe(9_200)
    expect(withTaxi.total_cost_fen).toBe(9_000 + 9_200)
    expect(withTaxi.neto_fen).toBe(1_500 - 9_000 - 9_200)

    // Another month has none of them.
    expect(monthAnalytics(f.db, f.venueId, addMonths(month, -1)).costs.dodatni).toBe(0)

    const removed = deleteMonthExtraCost(
      f.db, f.venueId, f.adminActor(), withTaxi.extra_costs[0]!.id,
    )
    expect(removed.extra_costs.map(e => e.label)).toEqual(['taksi'])
    expect(removed.costs.dodatni).toBe(1_200)
  })

  it('refuses a month that is not YYYY-MM and a kind the ledger already knows', () => {
    expect(putMonthCostBody.safeParse({ month: '2026-13', kind: 'voda', amount_fen: 1 }).success).toBe(false)
    expect(putMonthCostBody.safeParse({ month: '2026-9', kind: 'voda', amount_fen: 1 }).success).toBe(false)
    expect(putMonthCostBody.safeParse({ month, kind: 'roba', amount_fen: 1 }).success).toBe(false)
    expect(putMonthCostBody.safeParse({ month, kind: 'struja', amount_fen: -1 }).success).toBe(false)
  })
})
