/**
 * The order lock: atomicity, stock resolution, idempotency — and everything WP3
 * added around them.
 *
 * The first four describes are the Phase 0 invariants, unchanged in substance:
 * only the call shape moved, because `createOrder` now takes an `Actor` from the
 * session instead of a `user_id` from the body, and each line carries the uuid
 * the phone minted for it. They are the guardrail, not a formality — never
 * weaken one to fit a feature.
 *
 * The rest are §6.1's new branches, and every one of them is a case where the
 * old code either lost a sale or wrote money onto the wrong person.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createOrder } from '../../server/services/orders'
import { createPayment } from '../../server/services/payments'
import { expectedCash } from '../../server/services/cash'
import { tabMoney } from '../../server/services/tabs'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { rawClose, refuses } from '../helpers/shifts'

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

const line = (product: string, qty = 1, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(), product_id: f.productId(product), qty, ...extra,
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

function entries(kind: string) {
  return f.db.select().from(schema.logEntries)
    .where(and(eq(schema.logEntries.venueId, f.venueId), eq(schema.logEntries.kind, kind)))
    .all()
}

describe('createOrder — atomicity', () => {
  it('writes tab, order, lines and movements together', () => {
    const before = countRows()

    const result = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [line('Kafa', 2)],
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

    expect(() => createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [
        line('Kafa', 2),
        // A product that does not exist. It is the SECOND line: by the time it
        // throws, the tab, the order and the first line's rows are already
        // written — and the transaction must undo every one of them.
        { id: randomUUID(), product_id: randomUUID(), qty: 1 },
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

    createOrder(f.db, f.venueId, f.actor('Lejla'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 3'),
      lines: [line('Kafa', 2), line('Coca-Cola', 1)],
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

    createOrder(f.db, f.venueId, f.actor('Dino'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 16'),
      lines: [line('Nargila', 1, {
        flavour_ids: [f.stockItemId('Al Fakher · Jabuka'), f.stockItemId('Al Fakher · Menta')],
      })],
    })

    // 20 g over two aromas is 10 g + 10 g; three pieces of coal.
    expect(f.onHand('Al Fakher · Jabuka')).toBe(jabukaBefore - 10)
    expect(f.onHand('Al Fakher · Menta')).toBe(mentaBefore - 10)
    expect(f.onHand('Ugalj (kocke)')).toBe(ugaljBefore - 3)
  })

  it('lets stock go negative — a sale is never blocked', () => {
    // Only 20 lemons on hand; sell 30 lemonades.
    createOrder(f.db, f.venueId, f.actor('Tarik'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 20'),
      lines: [line('Limunada', 30)],
    })
    expect(f.onHand('Limun')).toBe(-10)
  })

  it('charges nothing for Dodatni žar but still takes the coal', () => {
    const before = f.onHand('Ugalj (kocke)')
    const result = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 1'),
      lines: [line('Dodatni žar', 1)],
    })
    expect(result.order_total_fen).toBe(0)
    expect(f.onHand('Ugalj (kocke)')).toBe(before - 2)
  })

  it('hangs a Dodatni žar off the bowl it tops up', () => {
    const bowl = line('Nargila', 1, {
      flavour_ids: [f.stockItemId('Al Fakher · Jabuka')],
    })
    const result = createOrder(f.db, f.venueId, f.actor('Dino'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 16'),
      lines: [bowl, line('Dodatni žar', 1, { parent_line_id: bowl.id })],
    })

    const rows = f.db.select().from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, result.order_id)).all()
    const topUp = rows.find(r => r.nameSnapshot === 'Dodatni žar')!
    expect(topUp.parentLineId).toBe(bowl.id)
  })

  /**
   * The invariant moved, deliberately: a parent line must be on **this tab**
   * rather than on this same round.
   *
   * F4's *Žar* is a round of its own, locked half an hour after the bowl it
   * tops up, so "on this round" made the two-tap path impossible to build. What
   * the rule is actually for — a phone cannot hang coal off a line at somebody
   * else's table — is unchanged and is what the two tests below assert.
   */
  it('hangs a Dodatni žar off a bowl locked on an earlier round of the same tab', () => {
    const bowl = line('Nargila', 1, { flavour_ids: [f.stockItemId('Al Fakher · Jabuka')] })
    const first = createOrder(f.db, f.venueId, f.actor('Dino'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 16'),
      lines: [bowl],
    })

    const topUp = createOrder(f.db, f.venueId, f.actor('Dino'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 16'),
      lines: [line('Dodatni žar', 1, { parent_line_id: bowl.id })],
    })

    expect(topUp.tab_id).toBe(first.tab_id)
    const row = f.db.select().from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, topUp.order_id)).get()!
    expect(row.parentLineId).toBe(bowl.id)
    expect(row.chargedFen).toBe(0)
  })

  it('refuses a parent line that is on no tab of this venue', () => {
    refuses(() => createOrder(f.db, f.venueId, f.actor('Dino'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 16'),
      lines: [line('Dodatni žar', 1, { parent_line_id: randomUUID() })],
    }), 'PARENT_LINE_NOT_FOUND', 404)
  })

  it("refuses a parent line that belongs to another table's tab", () => {
    const bowl = line('Nargila', 1, { flavour_ids: [f.stockItemId('Al Fakher · Jabuka')] })
    createOrder(f.db, f.venueId, f.actor('Dino'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 16'),
      lines: [bowl],
    })

    refuses(() => createOrder(f.db, f.venueId, f.actor('Dino'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 17'),
      lines: [line('Dodatni žar', 1, { parent_line_id: bowl.id })],
    }), 'PARENT_LINE_NOT_FOUND', 404)
  })
})

describe('createOrder — idempotency', () => {
  it('a replayed client_id writes nothing and reports already_applied', () => {
    const body = {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 12'),
      lines: [line('Kafa', 1)],
    }

    const first = createOrder(f.db, f.venueId, f.actor('Amar'), body)
    const after = countRows()
    const kafaAfterFirst = f.onHand('Kafa (mljevena)')

    const second = createOrder(f.db, f.venueId, f.actor('Amar'), body)

    expect(second.order_id).toBe(first.order_id)
    expect(second.tab_id).toBe(first.tab_id)
    expect(second.tab_client_id).toBe(first.tab_client_id)
    expect(second.order_total_fen).toBe(first.order_total_fen)
    expect(second.already_applied).toBe(true)
    expect(first.already_applied).toBe(false)
    expect(countRows()).toEqual(after)
    expect(f.onHand('Kafa (mljevena)')).toBe(kafaAfterFirst)
  })

  it('a second round joins the table\'s open tab instead of opening another', () => {
    const tableId = f.tableId('Sto 21')
    const first = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: tableId,
      lines: [line('Kafa', 1)],
    })
    const second = createOrder(f.db, f.venueId, f.actor('Lejla'), {
      client_id: randomUUID(),
      table_id: tableId,
      lines: [line('Red Bull', 2)],
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
    const result = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 5'),
      lines: [line('Red Bull', 3)],
    })

    const row = f.db.select().from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, result.order_id))
      .get()!

    expect(row.nameSnapshot).toBe('Red Bull')
    expect(row.unitPriceFen).toBe(500)
    expect(row.chargedFen).toBe(1500)
  })
})

// ===========================================================================
// The shift a round lands on
// ===========================================================================

describe('createOrder — the first lock opens the night', () => {
  it('auto-opens a shift, joins the locker to it and numbers the round', () => {
    const result = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [line('Kafa', 1)],
    })

    const shift = f.db.select().from(schema.shifts).get()!
    expect(shift.status).toBe('open')
    expect(shift.autoOpened).toBe(1)
    expect(result.shift_id).toBe(shift.id)
    expect(result.shift_seq).toBe(1)

    const member = f.db.select().from(schema.shiftMembers)
      .where(eq(schema.shiftMembers.userId, f.userId('Amar'))).get()
    expect(member).toBeDefined()
  })

  it('numbers rounds 1, 2, 3 within the shift', () => {
    const seqs = ['Sto 1', 'Sto 2', 'Sto 3'].map(table =>
      createOrder(f.db, f.venueId, f.actor('Amar'), {
        client_id: randomUUID(),
        table_id: f.tableId(table),
        lines: [line('Kafa', 1)],
      }).shift_seq)
    expect(seqs).toEqual([1, 2, 3])
  })

  it('attaches a two-day-old claim to the open shift, flagged late', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const twoDaysBack = new Date(Date.now() - 48 * 3_600_000).toISOString()

    const result = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      client_created_at: twoDaysBack,
      lines: [line('Kafa', 1)],
    })

    expect(result.shift_id).toBe(shiftId)
    expect(result.late_sync).toBe(true)

    const order = f.db.select().from(schema.orders)
      .where(eq(schema.orders.id, result.order_id)).get()!
    expect(order.lateSync).toBe(1)
    // The claim is stored verbatim beside the value the server actually used,
    // so a phone with a wrong clock leaves evidence rather than a corrected row.
    expect(order.clientCreatedAt).toBe(twoDaysBack)
    expect(order.clientCreatedAtAdj! > twoDaysBack).toBe(true)
    expect(order.syncLagS).toBeGreaterThan(0)
  })

  it('clamps a timestamp from the future down to now', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const result = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      client_created_at: future,
      lines: [line('Kafa', 1)],
    })

    const order = f.db.select().from(schema.orders)
      .where(eq(schema.orders.id, result.order_id)).get()!
    expect(order.clientCreatedAtAdj! < future).toBe(true)
    expect(order.clientCreatedAtAdj).toBe(order.createdAt)
    // A future claim is wrong, not late: nothing to flag, nothing lost.
    expect(order.lateSync).toBe(0)
  })
})

describe('createOrder — the tab a round names', () => {
  it('refuses table A with table B\'s tab, and writes nothing', () => {
    const first = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 1'),
      lines: [line('Kafa', 1)],
    })
    const before = countRows()

    refuses(() => createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 2'),
      tab_client_id: first.tab_client_id,
      lines: [line('Kafa', 1)],
    }), 'TAB_TABLE_MISMATCH', 409)

    expect(countRows()).toEqual(before)
  })

  it('opens a late unpaid tab when the named tab has been paid, and says so once', () => {
    const first = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 4'),
      lines: [line('Kafa', 1)],
    })
    createPayment(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      tab_id: first.tab_id,
      method: 'cash',
      amount_fen: 150,
      tip_fen: 0,
      covers_order_client_ids: [],
    })

    const late = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 4'),
      tab_client_id: first.tab_client_id,
      lines: [line('Kafa', 1)],
    })

    expect(late.tab_id).not.toBe(first.tab_id)
    expect(late.late_sync).toBe(true)
    // The phone adopts the new id rather than retrying against the paid one.
    expect(late.tab_client_id).not.toBe(first.tab_client_id)

    const tab = f.db.select().from(schema.tabs).where(eq(schema.tabs.id, late.tab_id)).get()!
    expect(tab.status).toBe('unpaid')
    expect(tab.pendingReview).toBe(1)
    expect(tab.lateSync).toBe(1)
    expect(tab.unpaidReason).toBe('late_sync')
    // Whose money it is until somebody decides: without this the amount sits on
    // nobody's line and the surplus in his envelope has no explanation.
    expect(tab.unpaidBy).toBe(f.userId('Amar'))

    const logged = entries('late_after_close')
    expect(logged).toHaveLength(1)
    expect(JSON.parse(logged[0]!.bodyJson).count).toBe(1)
    expect(JSON.parse(logged[0]!.bodyJson).amount_fen).toBe(150)
  })

  it('gives a closed night a new summary version when a late tab lands on it', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const first = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 4'),
      lines: [line('Kafa', 1)],
    })
    createPayment(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      tab_id: first.tab_id,
      method: 'cash',
      amount_fen: 150,
      tip_fen: 0,
      covers_order_client_ids: [],
    })
    rawClose(f, shiftId, { countedFen: 150 })

    createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 4'),
      tab_client_id: first.tab_client_id,
      lines: [line('Kafa', 1)],
    })

    const versions = f.db.select().from(schema.shiftSummaries)
      .where(eq(schema.shiftSummaries.shiftId, shiftId)).all()
    expect(versions.map(v => v.reason)).toContain('late')
  })
})

describe('createOrder — a round on a colleague\'s table', () => {
  it('is accepted and recorded when the setting allows it', () => {
    const first = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 6'),
      lines: [line('Kafa', 1)],
    })

    const second = createOrder(f.db, f.venueId, f.actor('Lejla'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 6'),
      lines: [line('Kafa', 1)],
    })
    expect(second.tab_id).toBe(first.tab_id)

    const logged = entries('cross_waiter_lock')
    expect(logged).toHaveLength(1)
    const body = JSON.parse(logged[0]!.bodyJson)
    expect(body.assigned_to).toBe(f.userId('Amar'))
    expect(body.locked_by).toBe(f.userId('Lejla'))
  })

  it('is refused when the owner turns the setting off', () => {
    f.settingsWith({ allow_cross_waiter_rounds: false })
    createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 6'),
      lines: [line('Kafa', 1)],
    })

    refuses(() => createOrder(f.db, f.venueId, f.actor('Lejla'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 6'),
      lines: [line('Kafa', 1)],
    }), 'NOT_ASSIGNED', 403)
  })
})

describe('createOrder — a round after your own settlement', () => {
  it('is accepted, stamped, added to his expected and alerted', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    f.settle('Amar')

    const before = expectedCash(f.db, f.venueId, shiftId, f.userId('Amar'))
      .waiters[0]!.expected_fen

    const result = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 8'),
      lines: [line('Kafa', 2)],
    })

    expect(result.post_settle).toBe(true)
    const order = f.db.select().from(schema.orders)
      .where(eq(schema.orders.id, result.order_id)).get()!
    expect(order.postSettle).toBe(1)
    expect(order.lateSync).toBe(1)

    const after = expectedCash(f.db, f.venueId, shiftId, f.userId('Amar')).waiters[0]!
    // Term 5 counts what is **owed on the tab**, not what was charged.
    expect(after.post_settle_lock_fen).toBe(300)
    expect(after.expected_fen).toBe(before + 300)

    expect(entries('late_after_settle')).toHaveLength(1)
    const alerts = f.db.select().from(schema.alertEvents).all()
    expect(alerts.map(a => a.ruleKey)).toContain('late_after_settle')
  })
})

// ===========================================================================
// Na račun kuće, at the moment of the lock
// ===========================================================================

describe('createOrder — a gratis on the round', () => {
  it('locks a staff drink at zero, with who authorised it', () => {
    const result = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 9'),
      lines: [line('Kafa', 1, { comp_reason: 'staff_drink' })],
    })

    expect(result.order_total_fen).toBe(0)
    const row = f.db.select().from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, result.order_id)).get()!
    expect(row.chargedFen).toBe(0)
    expect(row.unitPriceFen).toBe(150)
    expect(row.compReason).toBe('staff_drink')
    expect(row.authorisedBy).toBe(f.userId('Amar'))
    // Nothing to decide: the rule authorised it.
    expect(f.db.select().from(schema.lineAdjustments).all()).toHaveLength(0)
  })

  it('locks any other comp at full price with a pending request beside it', () => {
    const result = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 9'),
      lines: [line('Kafa', 1, { comp_reason: 'complaint' })],
    })

    // A comp the bartender rejects must cost nothing to undo, so the line is
    // charged and the guest owes it until somebody says otherwise.
    expect(result.order_total_fen).toBe(150)
    const adj = f.db.select().from(schema.lineAdjustments).get()!
    expect(adj.kind).toBe('comp')
    expect(adj.status).toBe('pending')
    expect(adj.amountFen).toBe(150)
    // Derived from the phone-minted line id, so a replay produces the same key.
    expect(adj.clientId).toMatch(/:comp$/)
    expect(tabMoney(f.db, f.venueId, result.tab_id).total_fen).toBe(150)
  })

  it('sends the third staff drink of the night to the bartender instead', () => {
    for (const table of ['Sto 1', 'Sto 2']) {
      createOrder(f.db, f.venueId, f.actor('Amar'), {
        client_id: randomUUID(),
        table_id: f.tableId(table),
        lines: [line('Kafa', 1, { comp_reason: 'staff_drink' })],
      })
    }

    const third = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 3'),
      lines: [line('Kafa', 1, { comp_reason: 'staff_drink' })],
    })
    expect(third.order_total_fen).toBe(150)
    expect(f.db.select().from(schema.lineAdjustments).all()).toHaveLength(1)
  })
})

/**
 * *Bez stola* — a round for the guests standing at the bar (PHASE3 §1.11).
 *
 * `tabs.table_id` became nullable in `0003_phase3.sql`, and the partial index
 * `tabs_one_open_per_table_uq (venue_id, table_id) WHERE status='open'` keeps
 * working unchanged: SQLite treats two NULLs in a unique index as *different*
 * values, so many table-less tabs may be open at once while a real table still
 * holds exactly one. That is the whole property this block is about.
 */
describe('createOrder — bez stola', () => {
  it('opens a tab with no table', () => {
    const result = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: null,
      lines: [line('Kafa', 2)],
    })

    const tab = f.db.select().from(schema.tabs).where(eq(schema.tabs.id, result.tab_id)).get()!
    expect(tab.tableId).toBeNull()
    expect(tab.status).toBe('open')
    expect(tab.assignedTo).toBe(f.userId('Amar'))
    expect(result.order_total_fen).toBe(300)
    expect(result.late_sync).toBe(false)
  })

  it('opens a second one instead of joining the first', () => {
    const first = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: null,
      tab_client_id: randomUUID(),
      lines: [line('Kafa')],
    })
    const second = createOrder(f.db, f.venueId, f.actor('Lejla'), {
      client_id: randomUUID(),
      table_id: null,
      tab_client_id: randomUUID(),
      lines: [line('Coca-Cola')],
    })

    // Two parties at the bar are two tabs, never one — "the open tab on this
    // table" is a question only a table can answer.
    expect(second.tab_id).not.toBe(first.tab_id)
    expect(f.db.select().from(schema.tabs).all()).toHaveLength(2)
  })

  it('adds a second round to the same table-less tab by its client id', () => {
    const tabClientId = randomUUID()
    const first = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: null,
      tab_client_id: tabClientId,
      lines: [line('Kafa')],
    })
    const second = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: null,
      tab_client_id: tabClientId,
      lines: [line('Kafa')],
    })

    expect(second.tab_id).toBe(first.tab_id)
    expect(second.tab_total_fen).toBe(300)
  })

  it('refuses a tab_client_id that belongs to a real table', () => {
    const onTable = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [line('Kafa')],
    })

    refuses(() => createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: null,
      tab_client_id: onTable.tab_client_id,
      lines: [line('Kafa')],
    }), 'TAB_TABLE_MISMATCH')
  })

  it('a replay of a table-less round writes nothing twice', () => {
    const clientId = randomUUID()
    const body = { client_id: clientId, table_id: null, lines: [line('Kafa', 2)] }

    const first = createOrder(f.db, f.venueId, f.actor('Amar'), body)
    const replay = createOrder(f.db, f.venueId, f.actor('Amar'), body)

    expect(replay.order_id).toBe(first.order_id)
    expect(replay.already_applied).toBe(true)
    expect(f.db.select().from(schema.orders).all()).toHaveLength(1)
  })
})
