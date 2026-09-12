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
 * for the first time. WP8 made `getBootstrap` select that table column by column
 * (§5.7) rather than `SELECT *`-ing it and mapping afterwards, which is the
 * belt; this sweep is the braces. One forgotten field and every phone in the
 * café holds the owner's password hash.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getBootstrap, getHealth } from '../../server/services/bootstrap'
import { createOrder } from '../../server/services/orders'
import { getPrep, markPrepared } from '../../server/services/prep'
import { createDelivery, getStock } from '../../server/services/stock'
import { getTab, getTablesState } from '../../server/services/tabs'
import { getLive, getOwnerShift, listOwnerShifts, shiftLines } from '../../server/services/owner'
import { listLoginUsers, listMySessions } from '../../server/services/auth'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { jpegBytes, scratchUploads } from '../helpers/phase4'
import { businessDate } from '../../shared/dates'
import { ROLE_LABELS } from '../../shared/landing'
import { chatSince, postMessage } from '../../server/services/chat'
import { addAssignment, getMyRoster, listTemplates, rosterHours } from '../../server/services/roster'
import { latestRules, publishRules } from '../../server/services/rules'
import { scanDelivery, setScanModel, stubScanModel } from '../../server/services/scan'
import { createUpload } from '../../server/services/uploads'

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

describe('GET /api/bootstrap', () => {
  it('carries the venue, the staff, the floor plan, the menu and the aromas', () => {
    const boot = getBootstrap(f.db, f.venueId, f.actor('Amar'))

    expect(boot.venue.slug).toBe('lounge')
    expect(boot.users).toHaveLength(6)
    expect(boot.tables).toHaveLength(27)
    expect(boot.categories.map(c => c.name)).toEqual(
      ['Kafa', 'Bezalkoholna', 'Energetska', 'Čaj', 'Nargila', 'Ostalo'],
    )
    expect(boot.products).toHaveLength(15)
    expect(boot.products.filter(p => p.is_favourite).map(p => p.name).sort())
      .toEqual(['Coca-Cola', 'Kafa', 'Limunada', 'Nargila', 'Red Bull', 'Čaj'].sort())

    // The floor plan the owner actually has.
    const vip = boot.tables.filter(t => t.grp === 'vip')
    expect(vip.map(t => t.name)).toEqual(['Sto 16', 'Sto 17'])
    // Bašta is two columns since the sketch of 2026-09-10: seven down the left,
    // three down the right, drawn level with the middle of the long one.
    const basta = boot.tables.filter(t => t.zone === 'basta')
    expect(basta).toHaveLength(10)
    const bastaColumn = (col: number) => basta
      .filter(t => t.col === col)
      .sort((a, b) => a.row - b.row)
      .map(t => `${t.name} r${t.row}`)
    expect(bastaColumn(1)).toEqual([
      'Sto 18 r1', 'Sto 19 r2', 'Sto 20 r3', 'Sto 21 r4', 'Sto 22 r5', 'Sto 23 r6', 'Sto 24 r7',
    ])
    expect(bastaColumn(2)).toEqual(['Sto 25 r1', 'Sto 26 r2', 'Sto 27 r3'])

    // Aromas arrive with their grams, so an empty tin can be shown as empty.
    expect(boot.flavours).toHaveLength(6)
    expect(boot.flavours.find(x => x.name === 'Al Fakher · Jabuka')?.on_hand).toBe(643)
  })

  /**
   * The five fields §5.7 adds to the envelope. Korak 1's bootstrap was a
   * catalogue; Korak 2's is a boot, and WP9's start screen reads all five —
   * `me` and `device` to know who is holding the phone, `shift` to draw the
   * strip, and the two cursors to know what to poll and when to come back here.
   */
  it('carries the session, the device, the shift and the two cursors', () => {
    const boot = getBootstrap(f.db, f.venueId, f.actor('Amar'))

    expect(boot.me.name).toBe('Amar')
    expect(boot.me.role).toBe('radnik')
    expect(boot.me.has_pin).toBe(true)
    // `f.actor()` builds an actor with no device, which is what an admin's
    // email session looks like too.
    expect(boot.device).toBeNull()
    // Nothing is open in a freshly seeded venue.
    expect(boot.shift).toBeNull()
    expect(boot.seq).toBe(0)
    expect(typeof boot.menu_version).toBe('number')
  })

  it('shows the shift once one is open, from the actor\'s side of it', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Emir'] })
    const boot = getBootstrap(f.db, f.venueId, f.actor('Amar'))

    expect(boot.shift?.id).toBe(shiftId)
    expect(boot.shift?.status).toBe('open')
    expect(boot.shift?.my_open_tabs).toBe(0)
    // `f.openShift()` writes its rows straight into the ledger without going
    // through `openShift()`, so nothing bumped the feed and the cursor is still
    // where the first case left it. That is the fixture being honest, not a bug:
    // `changes-coverage.test.ts` is where "a mutation bumps" is proven.
    expect(boot.seq).toBe(0)
  })

  it('speaks the two roles and neither retired one', () => {
    const boot = getBootstrap(f.db, f.venueId, f.actor('Amar'))
    expect(boot.users.find(u => u.name === 'Haris')?.role).toBe('admin')
    expect(boot.users.find(u => u.name === 'Emir')?.role).toBe('radnik')
    // None of the three retired values is accepted anywhere after 0001 and 0005.
    for (const gone of ['owner', 'waiter', 'bartender']) {
      expect(boot.users.map(u => u.role)).not.toContain(gone)
    }
    // And the labels the screens print are the same two. *Osoblje* kept a local
    // copy of this map that still said `waiter` / `bartender`, so its *Uloga*
    // column rendered `undefined` for every radnik and typecheck saw nothing:
    // `tsc` does not read `<script setup>` inside a `.vue` file. Pinning the
    // keys here is what makes the next role rename a red test rather than a
    // blank cell.
    expect(Object.keys(ROLE_LABELS).sort()).toEqual(['admin', 'radnik'])
    for (const role of boot.users.map(u => u.role)) {
      expect(ROLE_LABELS[role]).toBeTruthy()
    }
  })

  /**
   * PHASE3 §1.9 and §1.10 — the four fields S3 could not be built without, and
   * the key that lets a phone recognise a system product without matching a
   * name. All five were on the admin shapes only, behind routes a waiter's
   * phone may not call.
   */
  it('carries the note chips, the search fields and the system keys (§1.9, §1.10)', () => {
    const boot = getBootstrap(f.db, f.venueId, f.actor('Amar'))

    const kafa = boot.categories.find(c => c.name === 'Kafa')!
    expect(kafa.note_chips).toContain('bez šećera')
    expect(boot.categories.find(c => c.name === 'Ostalo')!.note_chips).toEqual([])

    const cola = boot.products.find(p => p.name === 'Coca-Cola')!
    expect(cola.short_name).toBe('Cola')
    expect(cola.search_aliases).toContain('kola')
    expect(cola.staff_drink_allowed).toBe(false)
    expect(boot.products.find(p => p.name === 'Kafa')!.staff_drink_allowed).toBe(true)

    // Exactly one of each, and found by key rather than by name.
    expect(boot.products.filter(p => p.system_key === 'zar').map(p => p.name))
      .toEqual(['Dodatni žar'])
    expect(boot.products.filter(p => p.system_key === 'ostalo').map(p => p.name))
      .toEqual(['Ostalo'])
    expect(boot.products.find(p => p.name === 'Nargila')!.system_key).toBeNull()
  })

  it('gives the catalogue exactly the fields the phone reads, and no more', () => {
    const boot = getBootstrap(f.db, f.venueId, f.actor('Amar'))

    for (const category of boot.categories) {
      expect(Object.keys(category).sort()).toEqual(['id', 'name', 'note_chips', 'sort'])
    }
    for (const product of boot.products) {
      expect(Object.keys(product).sort()).toEqual([
        'category_id', 'coal_pcs', 'id', 'is_favourite', 'kind', 'name', 'price_fen',
        'search_aliases', 'shisha_grams', 'short_name', 'sort', 'staff_drink_allowed',
        'system_key',
      ])
    }
  })
})

describe('GET /api/health', () => {
  it('counts what the deploy gate needs', () => {
    expect(getHealth(f.db, f.venueId)).toEqual({ ok: true, tables: 27, products: 15 })
  })
})

describe('GET /api/tables/state', () => {
  it('gives every table a row, with or without guests', () => {
    const before = getTablesState(f.db, f.venueId, f.actor('Amar'))
    expect(before.tables).toHaveLength(27)
    expect(before.tables.every(t => t.tab_id === null && t.total_fen === 0)).toBe(true)

    createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [{ id: randomUUID(), product_id: f.productId('Kafa'), qty: 2 }],
    })

    const after = getTablesState(f.db, f.venueId, f.actor('Amar'))
    const sto7 = after.tables.find(t => t.table_id === f.tableId('Sto 7'))!
    expect(sto7.tab_id).not.toBeNull()
    expect(sto7.total_fen).toBe(300)
    expect(sto7.remaining_fen).toBe(300)
    expect(sto7.opened_by_name).toBe('Amar')
    expect(sto7.last_order_at).not.toBeNull()

    // The strip travels with the floor plan, so the two can never disagree.
    expect(after.seq).toBeGreaterThan(0)
    expect(after.shift?.status).toBe('open')
    expect(after.shift?.my_open_tabs).toBe(1)
    expect(after.shift?.my_settled).toBe(false)
  })

  it('has exactly the fields the floor plan reads, and no more', () => {
    // Two waiters, so the state has to distinguish them, and one tab offered to
    // a colleague — the tile that says "Nudi ti: Sto 1 · Prihvati".
    const amar = f.lock('Amar', 'Sto 1', [{ product: 'Kafa' }])
    f.lock('Lejla', 'Sto 2', [{ product: 'Coca-Cola' }])
    f.sqlite.exec(`UPDATE tabs SET offered_to = '${f.userId('Lejla')}' WHERE id = '${amar.tabId}'`)

    const { tables } = getTablesState(f.db, f.venueId, f.actor('Lejla'))
    const busy = tables.filter(r => r.tab_id !== null)
    expect(busy.map(r => r.opened_by_name).sort()).toEqual(['Amar', 'Lejla'])

    const sto1 = tables.find(r => r.table_id === f.tableId('Sto 1'))!
    expect(sto1.assigned_to).toBe(f.userId('Amar'))
    expect(sto1.assigned_to_initials).toBe('AM')
    expect(sto1.offered_to).toBe(f.userId('Lejla'))
    expect(sto1.pending_review).toBe(false)
    expect(sto1.late_sync).toBe(false)
    expect(sto1.tab_client_id).toBeTruthy()

    for (const row of tables) {
      expect(Object.keys(row).sort()).toEqual([
        'assigned_to', 'assigned_to_initials', 'last_order_at', 'late_sync', 'offered_to',
        'opened_at', 'opened_by_name', 'pending_review', 'remaining_fen', 'tab_client_id',
        'tab_id', 'table_id', 'total_fen',
      ])
    }
  })

  it('answers the envelope §6.2 shapes, not a bare array', () => {
    const state = getTablesState(f.db, f.venueId, f.actor('Amar'))
    expect(Object.keys(state).sort()).toEqual(['loose_tabs', 'seq', 'shift', 'tables'])
    // No shift has been opened, so the strip is null and the floor plan is not.
    expect(state.shift).toBeNull()
    expect(Array.isArray(state.tables)).toBe(true)
    expect(state.loose_tabs).toEqual([])
  })

  /**
   * *Bez stola* (PHASE3 §1.11): a tab with no table at all. It must never
   * appear as a tile — the floor plan draws one circle per table and there is
   * no circle for the guests standing at the bar — so it goes in a list of its
   * own that S1 renders as cards above the plan.
   */
  it('puts a table-less tab in loose_tabs and on no tile', () => {
    createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: null,
      lines: [{ id: randomUUID(), product_id: f.productId('Kafa'), qty: 2 }],
    })

    const state = getTablesState(f.db, f.venueId, f.actor('Amar'))
    expect(state.tables).toHaveLength(27)
    expect(state.tables.every(t => t.tab_id === null)).toBe(true)

    expect(state.loose_tabs).toHaveLength(1)
    const loose = state.loose_tabs[0]!
    expect(loose.table_id).toBeNull()
    expect(loose.tab_id).not.toBeNull()
    expect(loose.total_fen).toBe(300)
    expect(loose.assigned_to).toBe(f.userId('Amar'))
    // Same shape as a tile: one component renders both.
    expect(Object.keys(loose).sort()).toEqual([
      'assigned_to', 'assigned_to_initials', 'last_order_at', 'late_sync', 'offered_to',
      'opened_at', 'opened_by_name', 'pending_review', 'remaining_fen', 'tab_client_id',
      'tab_id', 'table_id', 'total_fen',
    ])
  })

  it('reads a table-less tab back through GET /api/tabs/:id', () => {
    const order = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: null,
      lines: [{ id: randomUUID(), product_id: f.productId('Kafa'), qty: 1 }],
    })

    const detail = getTab(f.db, f.venueId, order.tab_id, f.actor('Amar'))
    // The inner join that used to be here would have dropped this tab entirely.
    expect(detail.tab.table_id).toBeNull()
    expect(detail.tab.table_name).toBeNull()
    expect(detail.money.total_fen).toBe(150)
  })
})

describe('GET /api/prep', () => {
  it('lists open tickets oldest first and the last ten finished', () => {
    const order = createOrder(f.db, f.venueId, f.actor('Dino'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 16'),
      note: 'bez šećera',
      lines: [{
        id: randomUUID(), product_id: f.productId('Nargila'),
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
    expect(stock).toHaveLength(20)

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
    createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [{ id: randomUUID(), product_id: f.productId('Coca-Cola'), qty: 1 }],
    })

    const cola = getStock(f.db, f.venueId).find(i => i.name === 'Coca-Cola 0,25 l')!
    expect(cola.on_hand).toBe(78)
    expect(cola.last_movement?.ref_label).toBe('Sto 7 · narudžba')
    expect(cola.last_movement?.type).toBe('sale')
  })

  /**
   * WP4's envelope, per the note at the top of this file: Korak 1's
   * `createDelivery` took a `user_id` and answered with the whole stock list;
   * §7's takes the actor from the session and answers with one `DeliveryView`.
   */
  it('adds a delivery and answers with the DeliveryView', () => {
    const delivery = createDelivery(f.db, f.venueId, f.actor('Emir'), {
      client_id: randomUUID(),
      supplier_name: 'Coca-Cola HBC',
      invoice_no: 'R-1201',
      lines: [
        {
          stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
          packs: 2, loose: 0, line_cost_fen: 4800, note: 'dvije gajbe',
        },
        {
          stock_item_id: f.stockItemId('Ugalj (kocke)'),
          packs: 0, loose: 64, line_cost_fen: 1600,
        },
      ],
    })

    expect(delivery.supplier_name).toBe('Coca-Cola HBC')
    expect(delivery.invoice_no).toBe('R-1201')
    expect(delivery.total_fen).toBe(6400)
    expect(delivery.status).toBe('posted')
    expect(delivery.entered_by_name).toBe('Emir')
    expect(delivery.already_applied).toBe(false)
    expect(delivery.lines).toHaveLength(2)
    // 2 gajbe × 24 = 48 boca, and 4 800 fen over 48 is 100 000 mfen a bottle.
    expect(delivery.lines[0]).toMatchObject({
      item_name: 'Coca-Cola 0,25 l', packs: 2, loose: 0, qty: 48,
      line_cost_fen: 4800, unit_cost_mfen: 100_000,
    })

    const stock = getStock(f.db, f.venueId)
    expect(stock.find(i => i.name === 'Coca-Cola 0,25 l')!.on_hand).toBe(79 + 48)
    expect(stock.find(i => i.name === 'Ugalj (kocke)')!.on_hand).toBe(103 + 64)
    expect(stock.find(i => i.name === 'Ugalj (kocke)')!.last_movement?.ref_label)
      .toBe('prijem robe')
  })
})

describe('a sale carries what it cost', () => {
  it('stamps every movement with the item\'s unit cost, in milli-feninga', () => {
    createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [{ id: randomUUID(), product_id: f.productId('Coca-Cola'), qty: 1 }],
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
    const order = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [{ id: randomUUID(), product_id: f.productId('Kafa'), qty: 1 }],
    })

    const responses: unknown[] = [
      getBootstrap(f.db, f.venueId, f.actor('Amar')),
      getHealth(f.db, f.venueId),
      getTablesState(f.db, f.venueId, f.actor('Amar')),
      getPrep(f.db, f.venueId),
      getStock(f.db, f.venueId),
      getTab(f.db, f.venueId, order.tab_id, f.actor('Amar')),
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

/**
 * `OwnerLive` — the envelope §11 names for `GET /api/owner/live`, appended by
 * WP7 the way this file's header says each package extends it.
 *
 * Every field is asserted **by name**, because *Puls* is the one screen where a
 * quietly renamed key would not break a build: `/admin` reads it with optional
 * chaining and a missing number renders as an empty tile the owner reads as "a
 * quiet night". The shape check is the only thing standing between that and a
 * wrong answer on a busy one.
 */
describe('GET /api/owner/live', () => {
  it('carries every field the Puls screen reads, and no secret', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [{ id: randomUUID(), product_id: f.productId('Kafa'), qty: 2 }],
    })
    f.cashMovement({ type: 'payout', amountFen: 2500, user: 'Emir', status: 'pending' })

    const live = getLive(f.db, f.venueId, f.adminActor())

    expect(Object.keys(live).sort()).toEqual([
      'attention', 'expected_cash_fen', 'flags', 'gratis', 'last_lines', 'log_max_at',
      'open', 'pending', 'promet_danas_fen', 'rostered', 'self_voids', 'seq', 'shift',
      'storna', 'tables', 'unsent', 'waste', 'who',
    ])

    expect(live.shift?.id).toBe(shiftId)
    expect(Object.keys(live.open).sort()).toEqual(['tables', 'total_fen'])
    expect(Object.keys(live.pending).sort())
      .toEqual(['adjustments', 'counts', 'payouts', 'settlements', 'unpaid'])
    for (const p of [live.storna, live.gratis, live.self_voids, live.waste]) {
      expect(Object.keys(p).sort()).toEqual(['count', 'fen'])
    }

    // One row per person on the shift, with the badge the floor plan uses.
    expect(Object.keys(live.who[0]!).sort()).toEqual([
      'initials', 'joined_at', 'name', 'open_tabs', 'promet_fen', 'settled', 'user_id',
    ])

    // And one row per person today's *Raspored* has on — the plan, which *Ko
    // radi* lays the list above against. No note, no `updated_by`: this is the
    // owner's screen, but the card draws a name, a badge and a shift and there
    // is no reason for the rest of an assignment to cross the wire.
    addAssignment(f.db, f.venueId, f.adminActor(), {
      work_date: businessDate(new Date().toISOString()),
      template_id: listTemplates(f.db, f.venueId)[0]!.id,
      user_id: f.userId('Lejla'),
    })
    const withPlan = getLive(f.db, f.venueId, f.adminActor())
    expect(Object.keys(withPlan.rostered[0]!).sort()).toEqual([
      'end_time', 'initials', 'name', 'start_time', 'status', 'template_id',
      'template_name', 'user_id',
    ])

    // The decidable list and the derived one, each with its own fixed shape.
    const payout = live.attention.find(a => a.kind === 'payout')!
    expect(Object.keys(payout).sort())
      .toEqual(['actions', 'amount_fen', 'at', 'kind', 'ref_id', 'ref_type', 'title_bs'])
    for (const flag of live.flags) {
      expect(Object.keys(flag).sort()).toEqual(['at', 'kind', 'ref_id', 'ref_type', 'title_bs'])
    }

    // The drill-down row, which *Puls* shows twenty of and *Smjena* pages.
    expect(Object.keys(live.last_lines[0]!).sort()).toEqual([
      'arrived_at', 'at', 'charged_fen', 'flavour_names', 'late_sync', 'line_id',
      'locked_by', 'locked_by_name', 'name_snapshot', 'note', 'qty', 'shift_seq',
      'status', 'sync_lag_s', 'table_name', 'unit_price_fen',
    ])
  })

  it('and neither Puls nor the shift reads leak a hash or a token', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [{ id: randomUUID(), product_id: f.productId('Kafa'), qty: 1 }],
    })

    const keys = (value: unknown, out: string[] = []): string[] => {
      if (Array.isArray(value)) for (const item of value) keys(item, out)
      else if (value && typeof value === 'object') {
        for (const [k, child] of Object.entries(value)) { out.push(k); keys(child, out) }
      }
      return out
    }

    const responses: unknown[] = [
      getLive(f.db, f.venueId, f.adminActor()),
      getOwnerShift(f.db, f.venueId, shiftId),
      listOwnerShifts(f.db, f.venueId, '2000-01-01', '2999-12-31'),
      shiftLines(f.db, f.venueId, shiftId, { kat: 'sve' }),
    ]
    expect(responses.flatMap(r => keys(r)).filter(k => /_hash$|token|password|pepper/i.test(k)))
      .toEqual([])
  })
})

// ===========================================================================
// WP4 — the two reads *Moja smjena* and the lock screen added
// ===========================================================================

/**
 * `GET /api/me/sessions` (PHASE3 §1.7) and `GET /api/auth/users` (§1.8).
 *
 * The second one is the sharp case. It is the **one** response a stranger
 * holding an enrolled phone can read with no session at all (BACKEND §5.5), so
 * its key set is asserted by name here: `last_login_at` is the only thing
 * Phase 3 is allowed to add to it, and anything else appearing in this list is
 * a leak that nobody would notice on a screen.
 */
describe('GET /api/me/sessions and GET /api/auth/users', () => {
  it('lists a person’s own sign-ins, newest first, with the current one marked', () => {
    const actor = f.actor('Amar')
    const rows = listMySessions(f.db, f.venueId, actor)

    // `f.actor()` invents a session id rather than writing a row, so an empty
    // list is the honest answer — and the shape is asserted on a real one below.
    expect(Array.isArray(rows)).toBe(true)

    const sessionId = randomUUID()
    f.db.insert(schema.sessions).values({
      id: sessionId, venueId: f.venueId, userId: f.userId('Amar'), deviceId: null,
      tokenHash: 'x'.repeat(64), kind: 'staff', borrowed: 0,
      createdAt: f.clock.now(), lastSeenAt: f.clock.now(),
      expiresAt: f.clock.now(), revokedAt: null, ip: null, userAgent: null,
    }).run()

    const mine = listMySessions(f.db, f.venueId, { ...actor, sessionId })
    expect(mine).toHaveLength(1)
    expect(Object.keys(mine[0]!).sort()).toEqual([
      'borrowed', 'created_at', 'current', 'device_label', 'id', 'kind', 'last_seen_at',
    ])
    expect(mine[0]!.current).toBe(true)

    // A colleague's sessions are never in anybody else's list.
    expect(listMySessions(f.db, f.venueId, f.actor('Lejla'))).toEqual([])
  })

  it('keeps the lock-screen list to what the screen draws, plus the recency', () => {
    const rows = listLoginUsers(f.db, f.venueId)
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'active', 'has_pin', 'id', 'initials', 'last_login_at', 'name', 'pin_len', 'role',
    ])
    expect(JSON.stringify(rows)).not.toMatch(/_hash|token|password|pepper|email/i)
  })
})

// ---------------------------------------------------------------------------
// Phase 4 — the four envelopes the UI packages build against
// ---------------------------------------------------------------------------

/**
 * Each of these is asserted **by name**, not by "has some fields": four screens
 * are written against these shapes in parallel, and a field that quietly
 * disappears has to fail here rather than as a blank line on somebody's phone.
 */
describe('GET /api/chat/since', () => {
  it('carries the channels, the cursor and the messages — and no forbidden room', () => {
    postMessage(f.db, f.venueId, f.actor('Amar'), 'svi', {
      client_id: randomUUID(), kind: 'text', body: 'nema leda',
    })

    const answer = chatSince(f.db, f.venueId, f.actor('Amar'), null)
    expect(Object.keys(answer).sort())
      .toEqual(['channels', 'cursor', 'has_more', 'messages', 'muted_until'])

    expect(Object.keys(answer.channels[0]!).sort()).toEqual([
      'id', 'kind', 'last_seq', 'members', 'name', 'pinned_at', 'pinned_text',
      'preview', 'preview_at', 'unread',
    ])
    expect(Object.keys(answer.messages[0]!).sort()).toEqual([
      'at', 'author_id', 'author_initials', 'author_name', 'body', 'channel',
      'client_id', 'deleted_at', 'deleted_by_name', 'forwarded_from_id', 'id',
      'image', 'kind', 'reply_preview', 'reply_to_id', 'seq', 'system_key',
      'system_payload',
    ])

    // The room is visible to the people in it, by name.
    const svi = answer.channels.find(c => c.kind === 'svi')!
    expect(svi.members).toContain('Haris')
    expect(answer.channels.find(c => c.kind === 'konobari')!.members)
      .not.toContain('Haris')
  })
})

describe('GET /api/me/roster and GET /api/roster/hours', () => {
  it('carries two weeks, the offers and my own requests', () => {
    const mine = getMyRoster(f.db, f.venueId, f.actor('Amar'))
    expect(Object.keys(mine).sort()).toEqual(['mine', 'next_week', 'offers', 'this_week'])
    expect(Object.keys(mine.this_week).sort())
      .toEqual(['days', 'published_at', 'published_by_name', 'templates', 'week_start'])
    // Seven day rows, always — an empty week is seven empty days, not no days.
    expect(mine.this_week.days).toHaveLength(7)
    expect(Object.keys(mine.this_week.templates[0]!).sort())
      .toEqual(['active', 'end_time', 'id', 'name', 'sort', 'start_time'])
  })

  it('carries the planned-against-worked row *Sati* prints', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    expect(shiftId).toBeTruthy()

    const rows = rosterHours(f.db, f.venueId, businessDate(f.clock.now()).slice(0, 7))
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'absent_days', 'days', 'early_leave_min', 'late_min', 'no_shift_rows',
      'planned_h', 'planned_shifts', 'sick_days', 'swaps_given', 'swaps_taken',
      'unplanned_rows', 'user_id', 'user_name', 'worked_h',
    ])
  })
})

describe('GET /api/rules', () => {
  it('carries the text, the publisher and this reader\'s own acknowledgement', () => {
    publishRules(f.db, f.venueId, f.adminActor(), { body_md: '# Pravila\n\nSlike samo šanka.' })
    const view = latestRules(f.db, f.venueId, f.actor('Amar'))

    expect(Object.keys(view).sort()).toEqual([
      'body_md', 'must_ack', 'my_ack_at', 'my_ack_version', 'published_at',
      'published_by_name', 'version',
    ])
    expect(view.published_by_name).toBe('Haris')
    expect(view.must_ack).toBe(true)
  })
})

describe('POST /api/stock/deliveries/scan', () => {
  it('carries the draft the owner edits, with its header counts', async () => {
    const dir = scratchUploads()
    setScanModel(stubScanModel())
    try {
      const upload = createUpload(
        f.db, f.venueId, f.adminActor(), { bytes: jpegBytes(1600, 1200) }, 'delivery',
      )
      const draft = await scanDelivery(f.db, f.venueId, f.adminActor(), { upload_id: upload.id })

      expect(Object.keys(draft).sort()).toEqual([
        'counts', 'date', 'error', 'image_url', 'invoice_no', 'lines', 'model',
        'scan_id', 'status', 'supplier', 'upload_id',
      ])
      expect(Object.keys(draft.lines[0]!).sort()).toEqual([
        'confidence', 'from_alias', 'match', 'pack', 'qty', 'stock_item_id',
        'stock_item_name', 'text', 'unit_price_fen',
      ])
      expect(draft.model).toBe('claude-opus-5')
      expect(draft.image_url).toBe(`/api/uploads/${upload.id}`)
    } finally {
      setScanModel(null)
      dir.cleanup()
    }
  })
})

describe('no Phase 4 response carries a secret either', () => {
  it('sweeps the four new envelopes', () => {
    publishRules(f.db, f.venueId, f.adminActor(), { body_md: '# Pravila\n\nTekst.' })
    const payloads = [
      chatSince(f.db, f.venueId, f.actor('Amar'), null),
      getMyRoster(f.db, f.venueId, f.actor('Amar')),
      latestRules(f.db, f.venueId, f.actor('Amar')),
      rosterHours(f.db, f.venueId, businessDate(f.clock.now()).slice(0, 7)),
    ]
    for (const payload of payloads) {
      expect(JSON.stringify(payload)).not.toMatch(/_hash|token|password|pepper|email/i)
    }
  })
})
