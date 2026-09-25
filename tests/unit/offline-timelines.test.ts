/**
 * Working without internet, the server's half (docs/OFFLINE.md §4).
 *
 * A phone that had no signal sends a whole stretch of the evening at once, and
 * every entry has to land where it would have landed had it been sent at the
 * time. The phone's clock rides in `client_created_at`, so each test dates its
 * steps in the past and posts them all *now*, one after another, in the order
 * the phone queued them — which is exactly what the outbox does when the line
 * comes back.
 *
 * The first test is the bug this file exists for: before `eventTime`, a payment
 * closed its tab with the moment it *arrived*, and the next guests' round —
 * dated earlier by the phone — was filed as "late", on no floor plan, with its
 * own payment failing behind it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createOrder } from '../../server/services/orders'
import { createPayment } from '../../server/services/payments'
import { clearTab, clearTabQueued } from '../../server/services/clearTable'
import { moveTab, tabMoney } from '../../server/services/tabs'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { refuses } from '../helpers/shifts'

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

/** `minutes` ago, on the phone's clock. */
function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

const line = (product: string, qty = 1) => ({
  id: randomUUID(), product_id: f.productId(product), qty,
})

function round(table: string, tabClientId: string, at: string, lines: ReturnType<typeof line>[]) {
  return createOrder(f.db, f.venueId, f.actor('Amar'), {
    client_id: randomUUID(),
    table_id: f.tableId(table),
    tab_client_id: tabClientId,
    client_created_at: at,
    lines,
  })
}

function pay(tabClientId: string, amountFen: number, at: string) {
  return createPayment(f.db, f.venueId, f.actor('Amar'), {
    client_id: randomUUID(),
    tab_client_id: tabClientId,
    method: 'cash',
    amount_fen: amountFen,
    tip_fen: 0,
    covers_order_client_ids: [],
    client_created_at: at,
  })
}

function tabsOn(table: string) {
  return f.db.select().from(schema.tabs)
    .where(and(eq(schema.tabs.venueId, f.venueId), eq(schema.tabs.tableId, f.tableId(table))))
    .all()
}

function entries(kind: string) {
  return f.db.select().from(schema.logEntries)
    .where(and(eq(schema.logEntries.venueId, f.venueId), eq(schema.logEntries.kind, kind)))
    .all()
}

describe('a table that turned over while the phone had no signal', () => {
  it('syncs into two paid tabs, and nothing is late', () => {
    const first = randomUUID()
    const next = randomUUID()

    // 60 minutes ago the first guests order two coffees; they pay at 40 and
    // the waiter gives the table back at 39; new guests order at 35 and pay at
    // 10. The phone sends all five now.
    const r1 = round('Sto 5', first, ago(60), [line('Kafa', 2)])
    pay(first, 300, ago(40))
    clearTabQueued(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(), tab_client_id: first, client_created_at: ago(39),
    })
    const r2 = round('Sto 5', next, ago(35), [line('Coca-Cola', 1)])
    const p2 = pay(next, 300, ago(10))

    expect(r2.late_sync).toBe(false)
    expect(r2.tab_id).not.toBe(r1.tab_id)
    expect(r2.tab_client_id).toBe(next)
    expect(p2.tab_id).toBe(r2.tab_id)

    const tabs = tabsOn('Sto 5')
    expect(tabs).toHaveLength(2)
    expect(tabs.map(t => t.status)).toEqual(['paid', 'paid'])
    expect(tabs.every(t => t.lateSync === 0 && t.pendingReview === 0)).toBe(true)
    expect(entries('late_after_close')).toHaveLength(0)
  })

  it('dates every stamp on the tab by the phone, not by the arrival', () => {
    const tab = randomUUID()
    const openedAt = ago(50)
    const paidAt = ago(30)
    const clearedAt = ago(29)
    round('Sto 6', tab, openedAt, [line('Kafa', 1)])
    pay(tab, 150, paidAt)
    clearTabQueued(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(), tab_client_id: tab, client_created_at: clearedAt,
    })

    const [row] = tabsOn('Sto 6')
    expect(row!.openedAt).toBe(openedAt)
    expect(row!.closedAt).toBe(paidAt)
    expect(row!.clearedAt).toBe(clearedAt)
  })

  it('gives guests who paid and stayed a second tab, and clears the first at the new round', () => {
    const first = randomUUID()
    const again = randomUUID()
    round('Sto 7', first, ago(60), [line('Kafa', 1)])
    // *Samo naplati — gosti ostaju*: paid, not cleared.
    pay(first, 150, ago(40))
    const againAt = ago(30)
    const r2 = round('Sto 7', again, againAt, [line('Red Bull', 1)])
    pay(again, 500, ago(10))

    expect(r2.late_sync).toBe(false)
    const tabs = tabsOn('Sto 7')
    expect(tabs).toHaveLength(2)
    const old = tabs.find(t => t.clientId === first)!
    expect(old.clearedAt).toBe(againAt)
    expect(tabs.every(t => t.status === 'paid')).toBe(true)
  })

  it('still files a round from before the table was settled as late', () => {
    // Emir took these guests' money at 20; Amar's phone was offline and brings
    // a round from 30 — before the bill was settled, so it belongs to a night
    // that is already closed and somebody has to look at it.
    const emirs = randomUUID()
    createOrder(f.db, f.venueId, f.actor('Emir'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 8'),
      tab_client_id: emirs,
      client_created_at: ago(40),
      lines: [line('Kafa', 1)],
    })
    createPayment(f.db, f.venueId, f.actor('Emir'), {
      client_id: randomUUID(),
      tab_client_id: emirs,
      method: 'cash',
      amount_fen: 150,
      tip_fen: 0,
      covers_order_client_ids: [],
      client_created_at: ago(20),
    })

    const late = round('Sto 8', randomUUID(), ago(30), [line('Kafa', 1)])
    expect(late.late_sync).toBe(true)
    expect(entries('late_after_close')).toHaveLength(1)
  })
})

describe('a tab given back while it still owed money', () => {
  it('is never joined by the next guests', () => {
    const stranded = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 9'),
      lines: [line('Kafa', 1)],
    })
    // *Očisti sto* with 1,50 KM still owed: the tab is off the table.
    clearTab(f.db, f.venueId, f.actor('Amar'), stranded.tab_id)

    const next = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 9'),
      lines: [line('Coca-Cola', 1)],
    })

    expect(next.tab_id).not.toBe(stranded.tab_id)
    // The old party's bill is exactly what it was, and the new guests' round
    // is on a tab of their own that holds the table.
    expect(tabMoney(f.db, f.venueId, stranded.tab_id).total_fen).toBe(150)
    expect(tabMoney(f.db, f.venueId, next.tab_id).total_fen).toBe(300)
    const live = tabsOn('Sto 9').filter(t => t.clearedAt === null)
    expect(live.map(t => t.id)).toEqual([next.tab_id])
  })
})

describe('POST /api/tabs/clear — the outbox\'s Očisti sto', () => {
  it('finds the tab by the phone\'s own id and stores its key', () => {
    const tab = randomUUID()
    const order = round('Sto 10', tab, ago(20), [line('Kafa', 1)])
    pay(tab, 150, ago(10))

    const clientId = randomUUID()
    const result = clearTabQueued(f.db, f.venueId, f.actor('Amar'), {
      client_id: clientId, tab_client_id: tab, client_created_at: ago(9),
    })

    expect(result.tab_id).toBe(order.tab_id)
    expect(result.already_applied).toBeUndefined()
    const [row] = tabsOn('Sto 10')
    expect(row!.clearedClientId).toBe(clientId)
    expect(row!.clearedBy).toBe(f.userId('Amar'))
  })

  it('finds it by the server\'s id when that is all the phone has', () => {
    const order = round('Sto 11', randomUUID(), ago(20), [line('Kafa', 1)])
    const result = clearTabQueued(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(), tab_id: order.tab_id,
    })
    expect(result.tab_id).toBe(order.tab_id)
  })

  it('answers a replay with the stored clear and writes nothing', () => {
    const tab = randomUUID()
    round('Sto 12', tab, ago(20), [line('Kafa', 1)])
    const body = { client_id: randomUUID(), tab_client_id: tab, client_created_at: ago(5) }

    const first = clearTabQueued(f.db, f.venueId, f.actor('Amar'), body)
    const again = clearTabQueued(f.db, f.venueId, f.actor('Amar'), body)

    expect(again.already_applied).toBe(true)
    expect(again.cleared_at).toBe(first.cleared_at)
    expect(entries('table_cleared')).toHaveLength(1)
  })

  it('answers 200 when somebody else gave the table back first', () => {
    const tab = randomUUID()
    const order = round('Sto 13', tab, ago(20), [line('Kafa', 1)])
    clearTab(f.db, f.venueId, f.actor('Emir'), order.tab_id)

    const late = clearTabQueued(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(), tab_client_id: tab,
    })

    expect(late.already_applied).toBe(true)
    const [row] = tabsOn('Sto 13')
    // Emir's clear stands exactly as it was written.
    expect(row!.clearedBy).toBe(f.userId('Emir'))
    expect(row!.clearedClientId).toBeNull()
    expect(entries('table_cleared')).toHaveLength(1)
  })

  it('refuses a tab nobody has heard of', () => {
    refuses(() => clearTabQueued(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(), tab_client_id: randomUUID(),
    }), 'TAB_NOT_FOUND', 404)
  })
})

describe('Premjesti onto a table that is paid but not cleared', () => {
  it('answers TABLE_OCCUPIED instead of crashing on the index', () => {
    const paid = randomUUID()
    round('Sto 14', paid, ago(20), [line('Kafa', 1)])
    pay(paid, 150, ago(10))
    const moving = round('Sto 15', randomUUID(), ago(5), [line('Kafa', 1)])

    refuses(() => moveTab(f.db, f.venueId, f.actor('Amar'), moving.tab_id, {
      table_id: f.tableId('Sto 14'),
    }), 'TABLE_OCCUPIED', 409)
  })
})
