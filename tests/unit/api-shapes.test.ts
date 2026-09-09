/**
 * The read routes, through their services: the shapes the two UI agents build
 * against. A field that quietly disappears fails here rather than on a phone.
 *
 * **Scope, and why it is what it is.** `docs/BACKEND.md` §11 describes this file
 * as asserting every Korak 2 envelope by name — `TablesStateResponse`,
 * `ChangesResult`, `MeContext`, `MyShift`, `OwnerLive`, `TabDetail`, `CountView`,
 * `DeliveryView`. None of those services exists yet: `docs/PHASES.md` §1 says
 * the response shapes arrive in the types-only `phase-1/contract-types` PR the
 * day after WP0 merges, and their implementations in WP1–WP7. So this file
 * covers the routes that exist today, on the Korak 2 schema and seed, and the
 * package that lands each envelope extends it here — the point being that this
 * file is WP0's, so nobody has to edit somebody else's test to do it.
 *
 * The last block is the assertion that has to be here from day one and not
 * later: **no response anywhere carries a hash, a token, a password or the
 * pepper**. The Korak 2 seed puts scrypt hashes and an admin email on `users`
 * for the first time, and `getBootstrap` does a `SELECT *` on that table before
 * it maps. One forgotten field and every phone in the café holds the owner's
 * password hash.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getBootstrap, getHealth } from '../../server/services/bootstrap'
import { createOrder } from '../../server/services/orders'
import { getPrep, markPrepared } from '../../server/services/prep'
import { createDelivery, getStock } from '../../server/services/stock'
import { getTab, getTablesState } from '../../server/services/tabs'
import { makeFixture, schema, type Fixture } from '../helpers/db'

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

describe('GET /api/bootstrap', () => {
  it('carries the venue, the staff, the floor plan, the menu and the aromas', () => {
    const boot = getBootstrap(f.db, f.venueId)

    expect(boot.venue.slug).toBe('lounge')
    expect(boot.users).toHaveLength(6)
    expect(boot.tables).toHaveLength(27)
    expect(boot.categories.map(c => c.name)).toEqual(
      ['Kafa', 'Bezalkoholna', 'Energetska', 'Čaj', 'Nargila', 'Ostalo'],
    )
    expect(boot.products).toHaveLength(14)
    expect(boot.products.filter(p => p.is_favourite).map(p => p.name).sort())
      .toEqual(['Coca-Cola', 'Kafa', 'Limunada', 'Nargila', 'Red Bull', 'Čaj'].sort())

    // The floor plan the owner actually has.
    const vip = boot.tables.filter(t => t.grp === 'vip')
    expect(vip.map(t => t.name)).toEqual(['Sto 16', 'Sto 17'])
    expect(boot.tables.filter(t => t.zone === 'basta')).toHaveLength(10)

    // Aromas arrive with their grams, so an empty tin can be shown as empty.
    expect(boot.flavours).toHaveLength(6)
    expect(boot.flavours.find(x => x.name === 'Al Fakher · Jabuka')?.on_hand).toBe(643)
  })

  it('speaks the three Korak 2 roles', () => {
    const boot = getBootstrap(f.db, f.venueId)
    expect(boot.users.find(u => u.name === 'Haris')?.role).toBe('admin')
    expect(boot.users.find(u => u.name === 'Emir')?.role).toBe('bartender')
    // 'owner' is not an accepted role value anywhere after the migration.
    expect(boot.users.map(u => u.role)).not.toContain('owner')
  })
})

describe('GET /api/health', () => {
  it('counts what the deploy gate needs', () => {
    expect(getHealth(f.db, f.venueId)).toEqual({ ok: true, tables: 27, products: 14 })
  })
})

describe('GET /api/tables/state', () => {
  it('gives every table a row, with or without guests', () => {
    const before = getTablesState(f.db, f.venueId)
    expect(before).toHaveLength(27)
    expect(before.every(t => t.tab_id === null && t.total_fen === 0)).toBe(true)

    createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Kafa'), qty: 2 }],
    })

    const after = getTablesState(f.db, f.venueId)
    const sto7 = after.find(t => t.table_id === f.tableId('Sto 7'))!
    expect(sto7.tab_id).not.toBeNull()
    expect(sto7.total_fen).toBe(300)
    expect(sto7.opened_by_name).toBe('Amar')
    expect(sto7.last_order_at).not.toBeNull()
  })

  it('has exactly the fields the floor plan reads, and no more', () => {
    // Two waiters, so the state has to distinguish them, and one tab offered to
    // a colleague — a Korak 2 column that must not leak into this envelope until
    // WP3 designs where it goes.
    const amar = f.lock('Amar', 'Sto 1', [{ product: 'Kafa' }])
    f.lock('Lejla', 'Sto 2', [{ product: 'Coca-Cola' }])
    f.sqlite.exec(`UPDATE tabs SET offered_to = '${f.userId('Lejla')}' WHERE id = '${amar.tabId}'`)

    const rows = getTablesState(f.db, f.venueId)
    const busy = rows.filter(r => r.tab_id !== null)
    expect(busy.map(r => r.opened_by_name).sort()).toEqual(['Amar', 'Lejla'])

    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'last_order_at', 'opened_at', 'opened_by_name', 'tab_id', 'table_id', 'total_fen',
      ])
    }
  })
})

describe('GET /api/prep', () => {
  it('lists open tickets oldest first and the last ten finished', () => {
    const order = createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 16'),
      user_id: f.userId('Dino'),
      note: 'bez šećera',
      lines: [{
        product_id: f.productId('Nargila'),
        qty: 1,
        flavour_ids: [f.stockItemId('Al Fakher · Jabuka'), f.stockItemId('Al Fakher · Menta')],
        note: 'jače',
      }],
    })

    const prep = getPrep(f.db, f.venueId)
    expect(prep.open).toHaveLength(1)
    expect(prep.done).toHaveLength(0)

    const ticket = prep.open[0]!
    expect(ticket.table_name).toBe('Sto 16')
    expect(ticket.waiter_name).toBe('Dino')
    expect(ticket.note).toBe('bez šećera')
    expect(ticket.lines[0]!.name_snapshot).toBe('Nargila')
    expect(ticket.lines[0]!.note).toBe('jače')
    // Aroma names are joined at read time from the ids on the line.
    expect(ticket.lines[0]!.flavours).toEqual(['Al Fakher · Jabuka', 'Al Fakher · Menta'])

    markPrepared(f.db, f.venueId, order.order_id, f.userId('Emir'))
    const after = getPrep(f.db, f.venueId)
    expect(after.open).toHaveLength(0)
    expect(after.done).toHaveLength(1)
    expect(after.done[0]!.prepared_by_name).toBe('Emir')
  })
})

describe('GET /api/stock and POST /api/stock/deliveries', () => {
  it('reports on hand and what last moved it', () => {
    const stock = getStock(f.db, f.venueId)
    expect(stock).toHaveLength(19)

    const kafa = stock.find(i => i.name === 'Kafa (mljevena)')!
    expect(kafa.on_hand).toBe(2400)
    expect(kafa.base_unit).toBe('g')
    expect(kafa.last_movement).toEqual({
      type: 'opening',
      qty_delta: 2400,
      occurred_at: expect.any(String),
      ref_label: 'početno stanje',
    })

    const cola = stock.find(i => i.name === 'Coca-Cola 0,25 l')!
    expect(cola.pack_name).toBe('gajba')
    expect(cola.pack_qty).toBe(24)
  })

  it('labels a sale with the table it came from', () => {
    createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Coca-Cola'), qty: 1 }],
    })

    const cola = getStock(f.db, f.venueId).find(i => i.name === 'Coca-Cola 0,25 l')!
    expect(cola.on_hand).toBe(78)
    expect(cola.last_movement?.ref_label).toBe('Sto 7 · narudžba')
    expect(cola.last_movement?.type).toBe('sale')
  })

  it('adds a delivery and returns the updated list', () => {
    const updated = createDelivery(f.db, f.venueId, {
      user_id: f.userId('Emir'),
      lines: [
        { stock_item_id: f.stockItemId('Coca-Cola 0,25 l'), qty: 48, note: 'dvije gajbe' },
        { stock_item_id: f.stockItemId('Ugalj (kocke)'), qty: 64 },
      ],
    })

    expect(updated.find(i => i.name === 'Coca-Cola 0,25 l')!.on_hand).toBe(79 + 48)
    expect(updated.find(i => i.name === 'Ugalj (kocke)')!.on_hand).toBe(103 + 64)
    expect(updated.find(i => i.name === 'Ugalj (kocke)')!.last_movement?.ref_label).toBe('prijem robe')
  })
})

describe('a sale carries what it cost', () => {
  it('stamps every movement with the item\'s unit cost, in milli-feninga', () => {
    createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Coca-Cola'), qty: 1 }],
    })

    const cola = f.db.select().from(schema.stockMovements).all()
      .find(m => m.type === 'sale')!
    // The seed's placeholder: 0,90 KM a bottle is 90 000 mfen per `kom`.
    expect(cola.unitCostMfen).toBe(90_000)
    // And the round attached itself to a shift, which the trigger insisted on.
    expect(cola.shiftId).not.toBeNull()
  })
})

/**
 * The sweep. Every read route's whole response, flattened, checked for a key
 * that has no business leaving the server.
 */
describe('no response carries a secret', () => {
  const FORBIDDEN = /_hash$|token|password|pepper/i

  function keysOf(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) {
      for (const item of value) keysOf(item, out)
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        out.push(key)
        keysOf(child, out)
      }
    }
    return out
  }

  it('across bootstrap, tables, prep, stock and a tab', () => {
    const order = createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Kafa'), qty: 1 }],
    })

    const responses: unknown[] = [
      getBootstrap(f.db, f.venueId),
      getHealth(f.db, f.venueId),
      getTablesState(f.db, f.venueId),
      getPrep(f.db, f.venueId),
      getStock(f.db, f.venueId),
      getTab(f.db, f.venueId, order.tab_id),
    ]

    const offenders = responses.flatMap(r => keysOf(r)).filter(k => FORBIDDEN.test(k))
    expect(offenders).toEqual([])
  })

  it('and the seed really does store hashes, so the sweep has something to catch', () => {
    const users = f.db.select().from(schema.users).all()
    expect(users.every(u => u.pinHash !== null)).toBe(true)
    expect(users.some(u => u.passwordHash !== null)).toBe(true)
  })
})
