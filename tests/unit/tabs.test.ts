/**
 * The tab: what it owes, who is answerable for it, and the three ways it changes
 * hands.
 *
 * `tabMoney` is the first describe because everything else in WP3 leans on it —
 * the floor plan's tile, the overpay guard, the waiter's expected cash and the
 * unpaid decision all read one function, so a mistake here is a mistake in four
 * places at once.
 *
 * The handover tests carry the rule that is easiest to get wrong and hardest to
 * notice: **money does not follow the tab.** Rounds stay attributed to whoever
 * locked them, so passing a table to a colleague moves responsibility for what
 * happens next and moves nobody's promet.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createOrder } from '../../server/services/orders'
import { createPayment } from '../../server/services/payments'
import { requestAdjustment } from '../../server/services/adjustments'
import {
  acceptTab, assignTab, decideUnpaid, getTab, getTablesState, markUnpaid, moveTab, tabMoney,
} from '../../server/services/tabs'
import { summarizeUser } from '../../server/services/summaries'
import { expectedCash } from '../../server/services/cash'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { refuses } from '../helpers/shifts'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

const line = (product: string, qty = 1, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(), product_id: f.productId(product), qty, ...extra,
})

function lock(who: string, table: string, lines = [line('Kafa', 1)]) {
  return createOrder(f.db, f.venueId, f.actor(who), {
    client_id: randomUUID(), table_id: f.tableId(table), lines,
  })
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

// ===========================================================================

describe('tabMoney', () => {
  it('adds the lines, subtracts an applied comp, holds a pending void and the payments', () => {
    const order = lock('Amar', 'Sto 7', [
      line('Kafa', 2), // 300
      line('Red Bull', 1), // 500
      line('Voda 0,5 l', 1, { comp_reason: 'staff_drink' }), // free at lock
    ])
    expect(tabMoney(f.db, f.venueId, order.tab_id).total_fen).toBe(800)

    // A pending void leaves `remaining` but not `total`: the guest is not asked
    // for money that is about to be cancelled, and the line is still on the tab.
    const redBull = f.db.select().from(schema.orderLines)
      .where(eq(schema.orderLines.nameSnapshot, 'Red Bull')).get()!
    f.voidLine('Amar', redBull.id, { status: 'pending', amountFen: 500 })

    let money = tabMoney(f.db, f.venueId, order.tab_id)
    expect(money.total_fen).toBe(800)
    expect(money.pending_void_fen).toBe(500)
    expect(money.remaining_fen).toBe(300)

    payCash('Amar', order.tab_id, 100)
    money = tabMoney(f.db, f.venueId, order.tab_id)
    expect(money.paid_fen).toBe(100)
    expect(money.remaining_fen).toBe(200)
  })

  it('takes an applied void off the total, not just off what is owed', () => {
    const order = lock('Amar', 'Sto 7', [line('Kafa', 2)])
    const row = f.db.select().from(schema.orderLines).get()!
    f.voidLine('Amar', row.id, { status: 'applied', amountFen: 300 })

    const money = tabMoney(f.db, f.venueId, order.tab_id)
    expect(money.total_fen).toBe(0)
    expect(money.remaining_fen).toBe(0)
  })

  it('goes negative after a void on a tab the guest already paid', () => {
    const order = lock('Amar', 'Sto 7', [line('Kafa', 2)])
    payCash('Amar', order.tab_id, 300)
    const row = f.db.select().from(schema.orderLines).get()!
    f.voidLine('Amar', row.id, { status: 'applied', amountFen: 300, wasPaid: true })

    // Documented, not corrected: the guest was charged, the guest paid, and the
    // café then decided the line should not have been there.
    expect(tabMoney(f.db, f.venueId, order.tab_id).remaining_fen).toBe(-300)
  })
})

describe('getTab', () => {
  it('paints every line with the status the sheet shows', () => {
    const order = lock('Amar', 'Sto 7', [
      line('Kafa', 1),
      line('Red Bull', 1),
      line('Voda 0,5 l', 1, { comp_reason: 'staff_drink' }),
    ])
    const redBull = f.db.select().from(schema.orderLines)
      .where(eq(schema.orderLines.nameSnapshot, 'Red Bull')).get()!
    f.voidLine('Amar', redBull.id, { status: 'pending' })

    const detail = getTab(f.db, f.venueId, order.tab_id, f.actor('Amar'))
    const lines = detail.orders[0]!.lines
    expect(lines.find(l => l.name_snapshot === 'Kafa')!.status).toBe('ok')
    expect(lines.find(l => l.name_snapshot === 'Red Bull')!.status).toBe('storno_na_cekanju')
    expect(lines.find(l => l.name_snapshot === 'Voda 0,5 l')!.status).toBe('gratis')
    expect(detail.tab.table_name).toBe('Sto 7')
    expect(detail.orders[0]!.locked_by_name).toBe('Amar')
  })

  it('joins aroma names from the ids on the line', () => {
    const order = lock('Dino', 'Sto 16', [line('Nargila', 1, {
      flavour_ids: [f.stockItemId('Al Fakher · Jabuka'), f.stockItemId('Al Fakher · Menta')],
    })])
    const detail = getTab(f.db, f.venueId, order.tab_id, f.actor('Dino'))
    expect(detail.orders[0]!.lines[0]!.flavour_names)
      .toEqual(['Al Fakher · Jabuka', 'Al Fakher · Menta'])
  })
})

// ===========================================================================
// Nije plaćeno
// ===========================================================================

describe('markUnpaid', () => {
  it('closes the tab, keeps the money on the waiter and waits for the owner', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7', [line('Kafa', 2)])

    const result = markUnpaid(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      tab_client_id: order.tab_client_id,
      reason: 'walked_out',
    })

    expect(result.tab.status).toBe('unpaid')
    expect(result.tab.pending_review).toBe(true)
    expect(result.tab.unpaid_by).toBe(f.userId('Amar'))
    expect(result.already_applied).toBe(false)

    // The table is free again — an unpaid tab frees it exactly like a paid one.
    const state = getTablesState(f.db, f.venueId, f.actor('Amar'))
    expect(state.tables.find(t => t.table_id === f.tableId('Sto 7'))!.tab_id).toBeNull()

    // And the amount is his until somebody decides (term 3).
    const ec = expectedCash(f.db, f.venueId, shiftId, f.userId('Amar'))
    expect(ec.waiters[0]!.unpaid_fen).toBe(300)
    expect(entries('unpaid_marked')).toHaveLength(1)
  })

  it('refuses a colleague\'s tab', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    const order = lock('Amar', 'Sto 7')

    refuses(() => markUnpaid(f.db, f.venueId, f.actor('Lejla'), {
      client_id: randomUUID(),
      tab_client_id: order.tab_client_id,
      reason: 'walked_out',
    }), 'NOT_ASSIGNED', 403)
  })

  it('replays to one row, by the mark\'s own client id', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')
    const body = {
      client_id: randomUUID(),
      tab_client_id: order.tab_client_id,
      reason: 'walked_out' as const,
    }

    const first = markUnpaid(f.db, f.venueId, f.actor('Amar'), body)
    const second = markUnpaid(f.db, f.venueId, f.actor('Amar'), body)

    expect(second.tab.id).toBe(first.tab.id)
    expect(second.already_applied).toBe(true)
    expect(entries('unpaid_marked')).toHaveLength(1)
    expect(f.db.select().from(schema.tabs).all()).toHaveLength(1)
  })

  it('refuses a tab that owes nothing', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7', [line('Kafa', 1)])
    payCash('Amar', order.tab_id, 150)

    refuses(() => markUnpaid(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      tab_client_id: order.tab_client_id,
      reason: 'walked_out',
    }), 'TAB_ALREADY_PAID', 409)
  })
})

describe('decideUnpaid', () => {
  it('otpis clears the review and takes the amount off the waiter', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7', [line('Kafa', 2)])
    markUnpaid(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(), tab_client_id: order.tab_client_id, reason: 'walked_out',
    })

    const tab = decideUnpaid(f.db, f.venueId, f.adminActor(), order.tab_id, { outcome: 'otpis' })
    expect(tab.pending_review).toBe(false)
    expect(tab.status).toBe('unpaid')

    const ec = expectedCash(f.db, f.venueId, shiftId, f.userId('Amar'))
    expect(ec.waiters[0]!.unpaid_fen).toBe(0)
    expect(entries('unpaid_decided')).toHaveLength(1)
  })

  it('naplatiti writes only the entry and leaves the money on him', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7', [line('Kafa', 2)])
    markUnpaid(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(), tab_client_id: order.tab_client_id, reason: 'dispute',
    })

    const tab = decideUnpaid(f.db, f.venueId, f.adminActor(), order.tab_id, {
      outcome: 'naplatiti',
    })
    expect(tab.pending_review).toBe(true)
    expect(expectedCash(f.db, f.venueId, shiftId, f.userId('Amar')).waiters[0]!.unpaid_fen)
      .toBe(300)
  })

  it('refuses a tab nobody marked', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')
    refuses(() => decideUnpaid(f.db, f.venueId, f.adminActor(), order.tab_id, {
      outcome: 'otpis',
    }), 'NOT_PENDING', 409)
  })

  it('collecting an unpaid tab later clears the review by itself', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7', [line('Kafa', 2)])
    markUnpaid(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(), tab_client_id: order.tab_client_id, reason: 'walked_out',
    })

    const result = payCash('Amar', order.tab_id, 300)
    expect(result.tab_status).toBe('paid')
    const tab = f.db.select().from(schema.tabs).where(eq(schema.tabs.id, order.tab_id)).get()!
    expect(tab.pendingReview).toBe(0)
    // The original close stands exactly as it was written.
    expect(tab.unpaidBy).toBe(f.userId('Amar'))
    expect(tab.unpaidReason).toBe('walked_out')
  })
})

// ===========================================================================
// Prebaci sto
// ===========================================================================

describe('moveTab', () => {
  it('moves the guests and records it', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')

    const tab = moveTab(f.db, f.venueId, f.actor('Amar'), order.tab_id, {
      table_id: f.tableId('Sto 8'),
    })
    expect(tab.table_name).toBe('Sto 8')
    expect(entries('tab_moved')).toHaveLength(1)
  })

  it('refuses a table that already has guests', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')
    lock('Lejla', 'Sto 8')

    refuses(() => moveTab(f.db, f.venueId, f.actor('Amar'), order.tab_id, {
      table_id: f.tableId('Sto 8'),
    }), 'TABLE_OCCUPIED', 409)
  })

  it('refuses a tab that has been paid', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7', [line('Kafa', 1)])
    payCash('Amar', order.tab_id, 150)

    refuses(() => moveTab(f.db, f.venueId, f.actor('Amar'), order.tab_id, {
      table_id: f.tableId('Sto 8'),
    }), 'TAB_ALREADY_PAID', 409)
  })
})

// ===========================================================================
// Predaj sto kolegi
// ===========================================================================

describe('the handover', () => {
  it('refuses an offer from somebody who does not hold the table', () => {
    f.openShift({ members: ['Amar', 'Lejla', 'Dino'] })
    const order = lock('Amar', 'Sto 7')

    refuses(() => assignTab(f.db, f.venueId, f.actor('Lejla'), order.tab_id, {
      user_id: f.userId('Dino'),
    }), 'NOT_ASSIGNED', 403)
  })

  it('clears the offer when the holder\'s own id comes back', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    const order = lock('Amar', 'Sto 7')

    assignTab(f.db, f.venueId, f.actor('Amar'), order.tab_id, { user_id: f.userId('Lejla') })
    expect(entries('tab_offered')).toHaveLength(1)

    const tab = assignTab(f.db, f.venueId, f.actor('Amar'), order.tab_id, {
      user_id: f.userId('Amar'),
    })
    expect(tab.offered_to).toBeNull()
    expect(entries('tab_offered')).toHaveLength(1)
  })

  it('refuses an accept by anybody but the person it was offered to', () => {
    f.openShift({ members: ['Amar', 'Lejla', 'Dino'] })
    const order = lock('Amar', 'Sto 7')
    assignTab(f.db, f.venueId, f.actor('Amar'), order.tab_id, { user_id: f.userId('Lejla') })

    refuses(() => acceptTab(f.db, f.venueId, f.actor('Dino'), order.tab_id), 'NOT_OFFERED', 403)
  })

  it('moves the table and the counter, and nobody\'s promet', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Lejla'] })
    const order = lock('Amar', 'Sto 7', [line('Kafa', 2)])
    lock('Lejla', 'Sto 8', [line('Red Bull', 1)])
    const at = f.clock.now()

    const before = {
      amar: summarizeUser(f.db, f.venueId, shiftId, f.userId('Amar'), at).promet_fen,
      lejla: summarizeUser(f.db, f.venueId, shiftId, f.userId('Lejla'), at).promet_fen,
      amarTabs: getTablesState(f.db, f.venueId, f.actor('Amar')).shift!.my_open_tabs,
      lejlaTabs: getTablesState(f.db, f.venueId, f.actor('Lejla')).shift!.my_open_tabs,
    }
    expect(before).toEqual({ amar: 300, lejla: 500, amarTabs: 1, lejlaTabs: 1 })

    assignTab(f.db, f.venueId, f.actor('Amar'), order.tab_id, { user_id: f.userId('Lejla') })
    const tab = acceptTab(f.db, f.venueId, f.actor('Lejla'), order.tab_id)

    expect(tab.assigned_to).toBe(f.userId('Lejla'))
    expect(tab.offered_to).toBeNull()
    expect(entries('tab_handed')).toHaveLength(1)

    // The counter moved…
    expect(getTablesState(f.db, f.venueId, f.actor('Amar')).shift!.my_open_tabs).toBe(0)
    expect(getTablesState(f.db, f.venueId, f.actor('Lejla')).shift!.my_open_tabs).toBe(2)
    // …and the money did not. Rounds follow `orders.locked_by`, not the tab.
    expect(summarizeUser(f.db, f.venueId, shiftId, f.userId('Amar'), at).promet_fen).toBe(300)
    expect(summarizeUser(f.db, f.venueId, shiftId, f.userId('Lejla'), at).promet_fen).toBe(500)
  })

  it('lets the new holder mark it unpaid, which the old one no longer may', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    const order = lock('Amar', 'Sto 7', [line('Kafa', 1)])
    assignTab(f.db, f.venueId, f.actor('Amar'), order.tab_id, { user_id: f.userId('Lejla') })
    acceptTab(f.db, f.venueId, f.actor('Lejla'), order.tab_id)

    refuses(() => markUnpaid(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(), tab_client_id: order.tab_client_id, reason: 'walked_out',
    }), 'NOT_ASSIGNED', 403)

    const result = markUnpaid(f.db, f.venueId, f.actor('Lejla'), {
      client_id: randomUUID(), tab_client_id: order.tab_client_id, reason: 'walked_out',
    })
    expect(result.tab.unpaid_by).toBe(f.userId('Lejla'))
  })

  it('refuses offering a table to yourself', () => {
    f.openShift({ members: ['Amar'] })
    const order = lock('Amar', 'Sto 7')
    refuses(() => assignTab(f.db, f.venueId, f.adminActor(), order.tab_id, {
      user_id: f.userId('Haris'),
    }), 'INVALID_TARGET', 400)
  })
})

describe('getTablesState', () => {
  it('shows the tile a pending review paints yellow', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    const order = lock('Amar', 'Sto 7', [line('Kafa', 1)])
    lock('Lejla', 'Sto 7', [line('Kafa', 1)])
    // Lejla pays and claims to cover only her own round.
    const lejlaOrder = f.db.select().from(schema.orders)
      .where(eq(schema.orders.lockedBy, f.userId('Lejla'))).get()!
    createPayment(f.db, f.venueId, f.actor('Lejla'), {
      client_id: randomUUID(),
      tab_id: order.tab_id,
      method: 'cash',
      amount_fen: 150,
      tip_fen: 0,
      covers_order_client_ids: [lejlaOrder.clientId],
    })

    const tile = getTablesState(f.db, f.venueId, f.actor('Lejla')).tables
      .find(t => t.table_id === f.tableId('Sto 7'))!
    expect(tile.pending_review).toBe(true)
    expect(tile.total_fen).toBe(300)
    expect(tile.remaining_fen).toBe(150)
    expect(tile.assigned_to).toBe(f.userId('Amar'))
    expect(entries('pay_uncovered')).toHaveLength(1)
  })
})

describe('requestAdjustment through the tab', () => {
  it('a pending void keeps the line on the tab and off what is owed', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    const order = lock('Amar', 'Sto 7', [line('Kafa', 2)])
    const row = f.db.select().from(schema.orderLines).get()!

    // Lejla's request on Amar's line: never automatic.
    const result = requestAdjustment(f.db, f.venueId, f.actor('Lejla'), {
      client_id: randomUUID(),
      order_line_id: row.id,
      kind: 'void',
      reason: 'wrong_entry',
    })
    expect(result.adjustment.status).toBe('pending')
    expect(result.tab_total_fen).toBe(300)
    expect(result.tab_remaining_fen).toBe(0)
    expect(getTab(f.db, f.venueId, order.tab_id, f.actor('Amar')).orders[0]!.lines[0]!.status)
      .toBe('storno_na_cekanju')
  })
})

/**
 * A *Bez stola* tab is a tab like any other — that is the point of §1.11. It
 * takes rounds, it takes money, it can be marked unpaid, and *Premjesti sto*
 * seats it at a real table the moment one frees up.
 */
describe('bez stola', () => {
  function lockLoose(who: string, tabClientId?: string) {
    return createOrder(f.db, f.venueId, f.actor(who), {
      client_id: randomUUID(),
      table_id: null,
      ...(tabClientId ? { tab_client_id: tabClientId } : {}),
      lines: [line('Kafa', 2)],
    })
  }

  it('takes a payment and leaves the floor plan alone', () => {
    const order = lockLoose('Amar')
    const paid = payCash('Amar', order.tab_id, 300)

    expect(paid.tab_status).toBe('paid')
    expect(paid.remaining_fen).toBe(0)

    const state = getTablesState(f.db, f.venueId, f.actor('Amar'))
    // A paid tab frees its slot, table or no table.
    expect(state.loose_tabs).toHaveLength(0)
    expect(state.tables.every(t => t.tab_id === null)).toBe(true)
  })

  it('can be marked nije plaćeno', () => {
    const tabClientId = randomUUID()
    lockLoose('Amar', tabClientId)

    const result = markUnpaid(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      tab_client_id: tabClientId,
      reason: 'walked_out',
    })

    expect(result.tab.status).toBe('unpaid')
    expect(result.tab.table_id).toBeNull()
    expect(result.tab.table_name).toBeNull()
    expect(result.tab.unpaid_by).toBe(f.userId('Amar'))
  })

  it('Premjesti sto seats it at a real table', () => {
    const order = lockLoose('Amar')

    const moved = moveTab(f.db, f.venueId, f.actor('Amar'), order.tab_id, {
      table_id: f.tableId('Sto 7'),
    })

    expect(moved.table_id).toBe(f.tableId('Sto 7'))
    expect(moved.table_name).toBe('Sto 7')
    expect(entries('tab_moved')).toHaveLength(1)

    const state = getTablesState(f.db, f.venueId, f.actor('Amar'))
    expect(state.loose_tabs).toHaveLength(0)
    expect(state.tables.find(t => t.table_id === f.tableId('Sto 7'))!.total_fen).toBe(300)
  })

  it('refuses a move onto a table that already has guests', () => {
    lock('Lejla', 'Sto 7')
    const loose = lockLoose('Amar')

    refuses(() => moveTab(f.db, f.venueId, f.actor('Amar'), loose.tab_id, {
      table_id: f.tableId('Sto 7'),
    }), 'TABLE_OCCUPIED')
  })
})
