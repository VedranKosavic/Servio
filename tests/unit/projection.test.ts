/**
 * The room as the phone knows it (`app/utils/projection.ts`, docs/OFFLINE.md
 * §5.2): the last thing the server said, with the unsent queue laid on top.
 *
 * Plain functions, so plain tests: a server snapshot and a list of outbox
 * entries in, the floor out. The first one is the bug that made the projection
 * a single function — the sheet counting a queued round twice.
 */
import { describe, expect, it } from 'vitest'
import { projectRoom, projectRounds } from '../../app/utils/projection'
import type { OutboxEntry, OutboxKind } from '../../app/stores/outbox'
import type { TabDetail, TableState } from '../../shared/types'

const ME = { id: 'amar', name: 'Amar', initials: 'AM' }

/** Kafa 1,50 and Cola 3,00, the way the menu on the phone prices them. */
const PRICES: Record<string, number> = { kafa: 150, cola: 300 }
const priceOf = (id: string) => PRICES[id] ?? 0

let seq = 0
function entry(
  kind: OutboxKind, fields: Partial<OutboxEntry> & { payload?: Record<string, unknown> } = {},
): OutboxEntry {
  seq += 1
  const clientId = fields.client_id ?? `e${seq}`
  return {
    client_id: clientId,
    kind,
    payload: { client_id: clientId, ...(fields.payload ?? {}) },
    client_created_at: fields.client_created_at ?? new Date(Date.UTC(2026, 8, 25, 19, seq)).toISOString(),
    attempts: 0,
    last_error: null,
    status: 'queued',
    ...(fields.tab_client_id ? { tab_client_id: fields.tab_client_id } : {}),
    ...(fields.table_id !== undefined ? { table_id: fields.table_id } : {}),
    ...(fields.amount_fen !== undefined ? { amount_fen: fields.amount_fen } : {}),
  }
}

function round(table: string | null, tab: string, lines: [string, number][]): OutboxEntry {
  return entry('order', {
    tab_client_id: tab,
    table_id: table,
    payload: {
      table_id: table,
      tab_client_id: tab,
      lines: lines.map(([product, qty], i) => ({ id: `${tab}-l${i}-${seq}`, product_id: product, qty })),
    },
  })
}

function pay(table: string | null, tab: string, amount: number, tabId?: string): OutboxEntry {
  return entry('pay', {
    tab_client_id: tab, table_id: table, amount_fen: amount,
    payload: { tab_client_id: tab, amount_fen: amount, ...(tabId ? { tab_id: tabId } : {}) },
  })
}

function clear(table: string | null | undefined, tab: string): OutboxEntry {
  return entry('clear', { tab_client_id: tab, table_id: table, payload: { tab_client_id: tab } })
}

function serverRow(table: string | null, fields: Partial<TableState> = {}): TableState {
  return {
    table_id: table,
    tab_id: `srv-${table ?? 'bar'}`,
    tab_client_id: `c-${table ?? 'bar'}`,
    total_fen: 0,
    remaining_fen: 0,
    assigned_to: 'amar',
    assigned_to_initials: 'AM',
    opened_by_name: 'Amar',
    opened_at: '2026-09-25T18:00:00.000Z',
    last_order_at: '2026-09-25T18:00:00.000Z',
    pending_review: false,
    paid: false,
    shift_seq: 2,
    late_sync: false,
    offered_to: null,
    ...fields,
  }
}

function project(entries: OutboxEntry[], rooms: { tables?: TableState[], loose?: TableState[], stranded?: TableState[] } = {}) {
  return projectRoom({
    tables: rooms.tables ?? [],
    loose: rooms.loose ?? [],
    stranded: rooms.stranded ?? [],
    entries,
    priceOf,
    me: ME,
  })
}

describe('a table with a round still in the queue', () => {
  it('counts the queued round once — the sheet reads the same row as the tile', () => {
    const room = project(
      [round('sto7', 'c-sto7', [['cola', 1]])],
      { tables: [serverRow('sto7', { total_fen: 300, remaining_fen: 300 })] },
    )
    const tab = room.tabOfTable('sto7')!
    // 3,00 on the server plus 3,00 queued. Not 9,00: nothing adds it again.
    expect(tab.row.remaining_fen).toBe(600)
    expect(room.tables.find(r => r.table_id === 'sto7')!.remaining_fen).toBe(600)
    expect(tab.queuedOrdersFen).toBe(300)
    expect(tab.onServer).toBe(true)
  })

  /**
   * `tables_state.tables` has a row for **every** table, and a free one's
   * `tab_id` is null. A queued round on it must open a tab — the first build of
   * this file added the round to the empty row and left the tile drawn free.
   */
  it('opens a tab on a free table whose row the server did send', () => {
    const free = serverRow('sto12', { tab_id: null, tab_client_id: null, assigned_to: null, shift_seq: null })
    const room = project([round('sto12', 'new12', [['cola', 1]])], { tables: [free] })
    const row = room.tables.find(r => r.table_id === 'sto12')!
    expect(row.tab_id).toBe('local:sto12')
    expect(row.remaining_fen).toBe(300)
    expect(room.tabOfTable('sto12')!.row.tab_client_id).toBe('new12')
  })

  it('has no tab to give for a free table', () => {
    const free = serverRow('sto3', { tab_id: null, tab_client_id: null })
    const room = project([], { tables: [free] })
    expect(room.tabOfTable('sto3')).toBeNull()
  })

  it('draws a table the server has never heard of as mine', () => {
    const room = project([round('sto5', 'new5', [['kafa', 2]])])
    const row = room.tables.find(r => r.table_id === 'sto5')!
    expect(row.tab_id).toBe('local:sto5')
    expect(row.tab_client_id).toBe('new5')
    expect(row.remaining_fen).toBe(300)
    expect(row.assigned_to).toBe('amar')
    expect(room.tabOfTable('sto5')!.onServer).toBe(false)
  })
})

describe('the money taken with no signal', () => {
  it('puts the checkmark on a table paid in full', () => {
    const room = project([
      round('sto5', 't5', [['kafa', 2]]),
      pay('sto5', 't5', 300),
    ])
    const row = room.tables.find(r => r.table_id === 'sto5')!
    expect(row.paid).toBe(true)
    expect(row.remaining_fen).toBe(0)
    expect(room.tabOfTable('sto5')!.queuedPayFen).toBe(300)
  })

  it('leaves the rest owing after a partial payment', () => {
    const room = project(
      [pay('sto7', 'c-sto7', 100, 'srv-sto7')],
      { tables: [serverRow('sto7', { total_fen: 450, remaining_fen: 450 })] },
    )
    const row = room.tables.find(r => r.table_id === 'sto7')!
    expect(row.remaining_fen).toBe(350)
    expect(row.paid).toBe(false)
  })

  it('places a payment queued before entries carried a table, by its tab', () => {
    const old = pay(null, 'c-sto7', 450)
    delete old.table_id
    const room = project([old], { tables: [serverRow('sto7', { total_fen: 450, remaining_fen: 450 })] })
    expect(room.tables.find(r => r.table_id === 'sto7')!.paid).toBe(true)
  })
})

describe('a table that turns over with no signal', () => {
  it('shows only the new guests after pay, clear and the next round', () => {
    const room = project([
      round('sto5', 'first', [['kafa', 2]]),
      pay('sto5', 'first', 300),
      clear('sto5', 'first'),
      round('sto5', 'next', [['cola', 1]]),
    ])
    const tab = room.tabOfTable('sto5')!
    expect(tab.row.tab_client_id).toBe('next')
    expect(tab.row.remaining_fen).toBe(300)
    expect(tab.queuedOrders).toHaveLength(1)
    expect(room.stranded).toHaveLength(0)
  })

  it('frees the table on Očisti sto, and a tab that still owed becomes a card', () => {
    const room = project([
      round('sto5', 'owed', [['kafa', 2]]),
      clear('sto5', 'owed'),
    ])
    expect(room.tables.find(r => r.table_id === 'sto5')).toBeUndefined()
    expect(room.stranded.map(r => r.tab_client_id)).toEqual(['owed'])
  })

  it('frees the table on Rashod or Policija', () => {
    const room = project(
      [entry('unpaid', { tab_client_id: 'c-sto7', table_id: 'sto7', payload: { tab_client_id: 'c-sto7' } })],
      { tables: [serverRow('sto7', { total_fen: 300, remaining_fen: 300 })] },
    )
    expect(room.tables).toHaveLength(0)
  })

  it('opens a new tab when guests who paid and stayed order again', () => {
    const room = project(
      [round('sto8', 'again', [['kafa', 1]])],
      { tables: [serverRow('sto8', { total_fen: 300, remaining_fen: 0, paid: true })] },
    )
    const row = room.tables.find(r => r.table_id === 'sto8')!
    expect(row.tab_client_id).toBe('again')
    expect(row.paid).toBe(false)
    expect(row.remaining_fen).toBe(150)
  })

  it('never lets a stranded card\'s payment touch the party now at its old table', () => {
    const stranded = serverRow('sto9', {
      tab_id: 'srv-old', tab_client_id: 'old', total_fen: 150, remaining_fen: 150,
    })
    const current = serverRow('sto9', { tab_id: 'srv-new', tab_client_id: 'new', total_fen: 300, remaining_fen: 300 })
    const room = project(
      // Paid and cleared from the card's own sheet, which still names the table.
      [pay('sto9', 'old', 150), clear(undefined, 'old')],
      { tables: [current], stranded: [stranded] },
    )
    expect(room.stranded).toHaveLength(0)
    const row = room.tables.find(r => r.table_id === 'sto9')!
    expect(row.tab_client_id).toBe('new')
    expect(row.remaining_fen).toBe(300)
  })
})

describe('the bar', () => {
  it('draws a party whose first round is still queued, and lets it go when paid', () => {
    const queued = project([round(null, 'party', [['cola', 2]])])
    expect(queued.loose.map(r => r.tab_id)).toEqual(['local:party'])
    expect(queued.tabOfLoose('local:party')!.row.remaining_fen).toBe(600)

    // A paid bar tab clears itself on the server: it leaves the list.
    const paid = project([round(null, 'party', [['cola', 2]]), pay(null, 'party', 600)])
    expect(paid.loose).toHaveLength(0)
  })

  it('adds a queued round to the server\'s party it belongs to', () => {
    const room = project(
      [round(null, 'c-bar', [['kafa', 1]])],
      { loose: [serverRow(null, { total_fen: 300, remaining_fen: 300 })] },
    )
    expect(room.loose).toHaveLength(1)
    expect(room.loose[0]!.remaining_fen).toBe(450)
  })
})

describe('the rounds on a sheet', () => {
  const names = {
    productName: (id: string) => ({ kafa: 'Kafa', cola: 'Coca-Cola' })[id] ?? '',
    flavourName: (id: string) => id,
  }

  function detail(tabId: string): TabDetail {
    return {
      tab: { id: tabId } as TabDetail['tab'],
      money: {} as TabDetail['money'],
      payments: [],
      orders: [{
        id: 'o1', client_id: 'o1', shift_seq: 1, locked_by: 'amar', locked_by_name: 'Amar',
        at: '2026-09-25T18:00:00.000Z', late_sync: false,
        lines: [{
          id: 'l1', name_snapshot: 'Kafa', note: null, flavour_names: [], qty: 1,
          unit_price_fen: 150, charged_fen: 150, comp_reason: null, status: 'ok', adjustment_id: null,
        }],
      }],
    }
  }

  it('lists the server\'s rounds, then the queued ones, marked', () => {
    const room = project(
      [round('sto7', 'c-sto7', [['cola', 2]])],
      { tables: [serverRow('sto7', { total_fen: 150, remaining_fen: 150 })] },
    )
    const { orders, queuedIds } = projectRounds(detail('srv-sto7'), room.tabOfTable('sto7'), names, priceOf, ME)
    expect(orders.map(o => o.lines[0]!.name_snapshot)).toEqual(['Kafa', 'Coca-Cola'])
    expect(orders[1]!.lines[0]!.charged_fen).toBe(600)
    expect(queuedIds.has(orders[1]!.id)).toBe(true)
    expect(queuedIds.has(orders[0]!.id)).toBe(false)
  })

  it('does not show the last party\'s rounds to the new guests', () => {
    const room = project(
      [pay('sto7', 'c-sto7', 150), clear('sto7', 'c-sto7'), round('sto7', 'next', [['kafa', 1]])],
      { tables: [serverRow('sto7', { total_fen: 150, remaining_fen: 150 })] },
    )
    const { orders } = projectRounds(detail('srv-sto7'), room.tabOfTable('sto7'), names, priceOf, ME)
    expect(orders).toHaveLength(1)
    expect(orders[0]!.locked_by_name).toBe('Amar')
    expect(orders[0]!.lines[0]!.name_snapshot).toBe('Kafa')
  })
})
