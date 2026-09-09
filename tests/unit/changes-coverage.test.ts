/**
 * "A mutating transaction without a `bump` is a bug" (`docs/BACKEND.md` §4.1) —
 * and this is the test that proves it, one fixture call per non-GET route.
 *
 * It has two halves, and the second is the one that keeps working after
 * everybody has stopped thinking about it: the route files under `server/api/`
 * are **enumerated from disk**, so a new mutation added by any work package
 * fails here until its owner registers a call below. A sync feed is only as
 * good as its worst-covered write — one forgotten `bump` is a floor plan that
 * silently stops refreshing on every phone in the building, which is exactly
 * the bug nobody reports because it looks like bad Wi-Fi.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, type Fixture } from '../helpers/db'
import { maxSeq } from '../../server/services/changes'
import { createOrder } from '../../server/services/orders'
import { markPrepared } from '../../server/services/prep'
import {
  correctStock, createDelivery, approveWaste, logWaste, reverseDelivery, setOpeningStock,
} from '../../server/services/stock'
import { confirmCount, submitCount, witnessCount } from '../../server/services/counts'
import {
  acceptTab, assignTab, decideUnpaid, markUnpaid, moveTab, tabMoney,
} from '../../server/services/tabs'
import { createPayment } from '../../server/services/payments'
import { decideAdjustment, requestAdjustment } from '../../server/services/adjustments'
import { markLogSeen } from '../../server/services/log'
import { enrolDevice, mintEnrolCode, revokeDevice, unlockDevice } from '../../server/services/devices'
import {
  closeShift, forceClose, leaveShift, openShift, reviewShift, startClosing,
} from '../../server/services/shifts'
import {
  acknowledgeFloat, decideCashMovement, moveFloat, pickup, requestPayout, setOpeningFloat,
} from '../../server/services/cash'
import { acceptSettlement, settle } from '../../server/services/settlements'
import { resetPin } from '../../server/services/auth'
import {
  createCategory, createProduct, createStockItem, createTable, createUser, setRecipe,
  updateCategory, updateProduct, updateSettings, updateStockItem, updateTable, updateUser,
} from '../../server/services/admin'
import { schema } from '../helpers/db'

const API_DIR = fileURLToPath(new URL('../../server/api', import.meta.url))
const MUTATING = /\.(post|put|patch|delete)\.ts$/

/**
 * The two routes §4.1 exempts by name.
 *
 * `/api/auth/*` writes sessions and attempt rows, which are cursors and
 * evidence rather than venue state. The heartbeat is exempt for a sharper
 * reason: it fires every 60 s from every phone, and a bump would invalidate
 * every waiter's ETag on every tick.
 *
 * The last two arrived with WP1 and belong to the first reason, not a second
 * one. `POST /api/admin/enrol-codes` writes a hashed six-character credential
 * that is read back exactly once, by the phone typing it — the same class of
 * row as a session, and no screen renders it. `PATCH /api/admin/devices/:id`
 * changes a device's label, which nothing in the feed carries: the only screen
 * that shows labels is *Uređaji*, and it reads `GET /api/admin/devices`
 * directly. Both of WP1's device writes that a phone must learn about — revoke
 * and unlock — are registered below, and they do bump.
 */
const EXEMPT = [
  /^auth[\\/]/,
  /^devices[\\/]heartbeat\.post\.ts$/,
  /^dev[\\/]/,
  /^admin[\\/]enrol-codes\.post\.ts$/,
  /^admin[\\/]devices[\\/]\[id\][\\/]index\.patch\.ts$/,
  // WP3's *Odbaci*. The only mutation in the app that writes no ledger row at
  // all: it records that an unlocked cart was thrown away, so the closing check
  // has something to check, and nothing on any screen changes because of it
  // (§6.1). A `bump` here would invalidate every phone's ETag for a non-event.
  /^drafts[\\/]discard\.post\.ts$/,
]

function mutatingRoutes(dir = API_DIR): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...mutatingRoutes(full))
    else if (MUTATING.test(entry.name)) out.push(relative(API_DIR, full))
  }
  return out.sort()
}

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

/**
 * One call per mutating route, keyed by its file. A route whose package has not
 * landed is simply not here yet — and the enumeration test below says so by
 * name the moment it is.
 */
const CALLS: Record<string, () => void> = {
  'orders.post.ts': () => {
    createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [{ id: randomUUID(), product_id: f.productId('Kafa'), qty: 1 }],
    })
  },

  [join('prep', '[orderId]', 'done.post.ts')]: () => {
    const order = createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 8'),
      lines: [{ id: randomUUID(), product_id: f.productId('Kafa'), qty: 1 }],
    })
    markPrepared(f.db, f.venueId, order.order_id, f.userId('Emir'))
  },

  // WP4 — the shelf. Every one of these ends in `bump('stock')`, because
  // *Stanje šanka* and the aroma grid on the shisha sheet are stale the moment
  // a crate lands, a bottle breaks or a count is signed.
  [join('stock', 'deliveries', 'index.post.ts')]: () => {
    createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: 'Coca-Cola HBC',
      lines: [{
        stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
        packs: 1, loose: 0, line_cost_fen: 2400,
      }],
    })
  },

  [join('stock', 'deliveries', '[id]', 'reverse.post.ts')]: () => {
    const delivery = createDelivery(f.db, f.venueId, f.adminActor(), {
      client_id: randomUUID(),
      supplier_name: 'Coca-Cola HBC',
      lines: [{
        stock_item_id: f.stockItemId('Fanta 0,25 l'),
        packs: 0, loose: 24, line_cost_fen: 2400,
      }],
    })
    reverseDelivery(f.db, f.venueId, f.adminActor(), delivery.id, { note: 'pogrešna faktura' })
  },

  [join('stock', 'opening.post.ts')]: () => {
    setOpeningStock(f.db, f.venueId, f.adminActor(), {
      lines: [{ stock_item_id: f.stockItemId('Coca-Cola 0,25 l'), qty: 79, unit_cost_mfen: 95_000 }],
    })
  },

  [join('stock', 'waste', 'index.post.ts')]: () => {
    logWaste(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
      qty: 1,
      reason: 'razbijeno',
    })
  },

  [join('stock', 'waste', '[id]', 'approve.post.ts')]: () => {
    const waste = logWaste(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
      qty: 1,
      reason: 'razbijeno',
    })
    approveWaste(f.db, f.venueId, f.actor('Emir'), waste.id)
  },

  [join('stock', 'corrections.post.ts')]: () => {
    correctStock(f.db, f.venueId, f.adminActor(), {
      stock_item_id: f.stockItemId('Limun'),
      type: 'correction',
      qty_delta: -3,
      note: 'pokvarili se',
    })
  },

  [join('stock', 'counts', 'index.post.ts')]: () => {
    submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full', phase: 'adhoc',
      lines: [{ stock_item_id: f.stockItemId('Red Bull'), packs: 0, loose: 28 }],
    })
  },

  // *Potvrđujem stanje* writes no movement, and still bumps: the count's own
  // card on `/a` and the *Puls* attention line both change the moment it lands.
  [join('stock', 'counts', '[id]', 'witness.post.ts')]: () => {
    const count = submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full', phase: 'adhoc',
      lines: [{ stock_item_id: f.stockItemId('Red Bull'), packs: 0, loose: 28 }],
    })
    witnessCount(f.db, f.venueId, f.actor('Amar'), count.id)
  },

  [join('stock', 'counts', '[id]', 'confirm.post.ts')]: () => {
    const count = submitCount(f.db, f.venueId, f.actor('Emir'), {
      kind: 'full', phase: 'adhoc',
      lines: [{ stock_item_id: f.stockItemId('Red Bull'), packs: 0, loose: 27, note: 'fali jedan' }],
    })
    confirmCount(f.db, f.venueId, f.adminActor(), count.id, {})
  },

  // WP3 — the money core. `POST /api/tabs/:id/pay` is gone; `POST /api/payments`
  // took its place, and every one of these ends in `bump('table')` because a
  // tab that changes hands, is paid, or is struck redraws somebody's floor plan.
  'payments.post.ts': () => {
    const order = lockOn('Sto 9')
    createPayment(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      tab_id: order.tab_id,
      method: 'cash',
      amount_fen: tabMoney(f.db, f.venueId, order.tab_id).remaining_fen,
      tip_fen: 0,
      covers_order_client_ids: [],
    })
  },

  [join('tabs', 'unpaid.post.ts')]: () => {
    const order = lockOn('Sto 10')
    markUnpaid(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      tab_client_id: order.tab_client_id,
      reason: 'walked_out',
    })
  },

  [join('tabs', '[id]', 'unpaid', 'decide.post.ts')]: () => {
    const order = lockOn('Sto 11')
    markUnpaid(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      tab_client_id: order.tab_client_id,
      reason: 'walked_out',
    })
    decideUnpaid(f.db, f.venueId, f.adminActor(), order.tab_id, { outcome: 'otpis' })
  },

  [join('tabs', '[id]', 'move.post.ts')]: () => {
    const order = lockOn('Sto 12')
    moveTab(f.db, f.venueId, f.actor('Amar'), order.tab_id, { table_id: f.tableId('Sto 13') })
  },

  [join('tabs', '[id]', 'assign.post.ts')]: () => {
    const order = lockOn('Sto 14')
    assignTab(f.db, f.venueId, f.actor('Amar'), order.tab_id, { user_id: f.userId('Lejla') })
  },

  [join('tabs', '[id]', 'accept.post.ts')]: () => {
    const order = lockOn('Sto 15')
    assignTab(f.db, f.venueId, f.actor('Amar'), order.tab_id, { user_id: f.userId('Lejla') })
    acceptTab(f.db, f.venueId, f.actor('Lejla'), order.tab_id)
  },

  [join('adjustments', 'index.post.ts')]: () => {
    const order = lockOn('Sto 17')
    requestAdjustment(f.db, f.venueId, f.actor('Lejla'), {
      client_id: randomUUID(),
      order_line_id: lineOf(order.order_id),
      kind: 'void',
      reason: 'wrong_entry',
    })
  },

  [join('adjustments', '[id]', 'decide.post.ts')]: () => {
    const order = lockOn('Sto 18')
    const adj = requestAdjustment(f.db, f.venueId, f.actor('Lejla'), {
      client_id: randomUUID(),
      order_line_id: lineOf(order.order_id),
      kind: 'void',
      reason: 'wrong_entry',
    })
    decideAdjustment(f.db, f.venueId, f.adminActor(), adj.adjustment.id, { outcome: 'applied' })
  },

  [join('owner', 'log', 'seen.post.ts')]: () => {
    markLogSeen(f.db, f.venueId, f.userId('Haris'))
  },

  // WP1's three device writes that the floor has to learn about. Each one of
  // them writes its Dnevnik entry inside its own transaction, and `log()` bumps
  // — which is the point of §4.1's rule being about the *transaction* and not
  // about a literal `bump(` in the service.
  [join('devices', 'enrol.post.ts')]: () => {
    const { code } = mintEnrolCode(f.db, f.venueId, f.adminActor(), {
      mode: 'shared', label: 'Šank tablet',
    })
    enrolDevice(f.db, { code }, { ip: '127.0.0.1' })
  },

  [join('admin', 'devices', '[id]', 'revoke.post.ts')]: () => {
    revokeDevice(f.db, f.venueId, f.adminActor(), enrolled())
  },

  [join('admin', 'devices', '[id]', 'unlock.post.ts')]: () => {
    const deviceId = enrolled()
    f.db.update(schema.devices)
      .set({ lockedAt: f.clock.now() })
      .where(eq(schema.devices.id, deviceId))
      .run()
    unlockDevice(f.db, f.venueId, f.adminActor(), deviceId)
  },

  // WP2 — the shift, the drawer and the envelope. Every one of these ends in
  // `bump('shift')`: the floor plan's `ShiftBrief` and every waiter's own strip
  // are read out of the shift, so a close that no phone learns about is a
  // building full of screens still showing the night as open.
  [join('shifts', 'open.post.ts')]: () => {
    openShift(f.db, f.venueId, f.actor('Amar'), {})
  },

  [join('shifts', '[id]', 'closing.post.ts')]: () => {
    startClosing(f.db, f.venueId, f.adminActor(), f.openShift({ members: ['Amar'] }))
  },

  [join('shifts', '[id]', 'close.post.ts')]: () => {
    closeShift(f.db, f.venueId, f.adminActor(), nightReadyToClose(), {
      cash_counted_fen: 0, closing_note: 'test', pin: HARIS_PIN,
    })
  },

  [join('shifts', '[id]', 'force-close.post.ts')]: () => {
    forceClose(f.db, f.venueId, f.adminActor(), f.openShift({ members: ['Amar'] }), {
      note: 'telefon crko',
    })
  },

  [join('shifts', '[id]', 'review.post.ts')]: () => {
    const shiftId = nightReadyToClose()
    closeShift(f.db, f.venueId, f.adminActor(), shiftId, {
      cash_counted_fen: 0, closing_note: 'test', pin: HARIS_PIN,
    })
    reviewShift(f.db, f.venueId, f.adminActor(), shiftId, { card_total_fen: 0 })
  },

  [join('shifts', '[id]', 'leave.post.ts')]: () => {
    leaveShift(f.db, f.venueId, f.actor('Amar'), f.openShift({ members: ['Amar'] }))
  },

  [join('shifts', '[id]', 'float.post.ts')]: () => {
    moveFloat(f.db, f.venueId, f.adminActor(), f.openShift({ members: ['Amar'] }), {
      type: 'float_out', user_id: f.userId('Amar'), amount_fen: 5_000,
    })
  },

  [join('shifts', '[id]', 'payout.post.ts')]: () => {
    requestPayout(f.db, f.venueId, f.actor('Amar'), f.openShift({ members: ['Amar'] }), {
      amount_fen: 2_000, reason: 'dobavljac',
    })
  },

  [join('shifts', '[id]', 'pickup.post.ts')]: () => {
    pickup(f.db, f.venueId, f.adminActor(), f.openShift({ members: ['Amar'] }), {
      amount_fen: 3_000,
    })
  },

  [join('shifts', '[id]', 'opening-float.post.ts')]: () => {
    setOpeningFloat(f.db, f.venueId, f.adminActor(), f.openShift({ members: ['Amar'] }), {
      fen: 10_000,
    })
  },

  [join('shifts', '[id]', 'settle.post.ts')]: () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    settle(f.db, f.venueId, f.actor('Amar'), shiftId, { declared_fen: 0, outbox_len: 0 })
  },

  [join('shifts', '[id]', 'settlements', '[sid]', 'accept.post.ts')]: () => {
    const shiftId = f.openShift({ members: ['Amar', 'Emir'] })
    const settlementId = f.settle('Amar')
    acceptSettlement(f.db, f.venueId, f.actor('Emir'), shiftId, settlementId)
  },

  [join('cash-movements', '[id]', 'decide.post.ts')]: () => {
    f.openShift({ members: ['Amar'] })
    const movementId = f.cashMovement({
      type: 'payout', amountFen: 2_000, user: 'Amar', status: 'pending',
    })
    decideCashMovement(f.db, f.venueId, f.adminActor(), movementId, { outcome: 'approved' })
  },

  [join('cash-movements', '[id]', 'ack.post.ts')]: () => {
    f.openShift({ members: ['Amar'] })
    const movementId = f.cashMovement({
      type: 'float_out', amountFen: 5_000, user: 'Amar', status: 'pending',
    })
    acknowledgeFloat(f.db, f.venueId, f.actor('Amar'), movementId)
  },
  // WP6's thirteen catalogue writes. Each one bumps the entity whose payload the
  // screens re-read (§4.1): `menu` for anything `/api/bootstrap` carries,
  // `table` for the live floor plan, `stock` for the shelf, `user` for the staff
  // list, `settings` for the venue. The one exception is the PIN reset, which
  // bumps nothing of its own — it hands over to WP1's `resetPin`, whose two
  // Dnevnik entries bump `log` inside the same transaction, and there is nothing
  // else about a new PIN for a phone to re-read.
  [join('admin', 'products', 'index.post.ts')]: () => {
    createProduct(f.db, f.venueId, f.adminActor(), {
      category_id: firstCategory(), name: 'Espresso', price_fen: 200,
    })
  },

  [join('admin', 'products', '[id]', 'index.patch.ts')]: () => {
    updateProduct(f.db, f.venueId, f.adminActor(), f.productId('Kafa'), { price_fen: 180 })
  },

  [join('admin', 'products', '[id]', 'recipe.put.ts')]: () => {
    setRecipe(f.db, f.venueId, f.adminActor(), f.productId('Kafa'), {
      lines: [{ stock_item_id: f.stockItemId('Šećer'), qty: 6 }],
    })
  },

  [join('admin', 'categories', 'index.post.ts')]: () => {
    createCategory(f.db, f.venueId, f.adminActor(), { name: 'Kokteli' })
  },

  [join('admin', 'categories', '[id]', 'index.patch.ts')]: () => {
    updateCategory(f.db, f.venueId, f.adminActor(), firstCategory(), { sort: 9 })
  },

  [join('admin', 'tables', 'index.post.ts')]: () => {
    createTable(f.db, f.venueId, f.adminActor(), {
      name: 'Sto 99', zone: 'basta', col: 1, row: 3,
    })
  },

  [join('admin', 'tables', '[id]', 'index.patch.ts')]: () => {
    updateTable(f.db, f.venueId, f.adminActor(), f.tableId('Sto 1'), { sort: 5 })
  },

  [join('admin', 'stock-items', 'index.post.ts')]: () => {
    createStockItem(f.db, f.venueId, f.adminActor(), {
      name: 'Sprite 0,25 l', kind: 'pice', base_unit: 'kom', last_cost_mfen: 90_000,
    })
  },

  [join('admin', 'stock-items', '[id]', 'index.patch.ts')]: () => {
    updateStockItem(f.db, f.venueId, f.adminActor(), f.stockItemId('Cedevita'), { par_qty: 12 })
  },

  [join('admin', 'users', 'index.post.ts')]: () => {
    createUser(f.db, f.venueId, f.adminActor(), {
      name: 'Nedim', initials: 'NE', role: 'waiter', pin: '1234',
    })
  },

  [join('admin', 'users', '[id]', 'index.patch.ts')]: () => {
    updateUser(f.db, f.venueId, f.adminActor(), f.userId('Amar'), { initials: 'AB' })
  },

  [join('admin', 'users', '[id]', 'pin.post.ts')]: () => {
    resetPin(f.db, f.venueId, f.adminActor(), f.userId('Amar'), '4321')
  },

  [join('admin', 'settings.patch.ts')]: () => {
    updateSettings(f.db, f.venueId, f.adminActor(), { cash_tolerance_fen: 700 })
  },
}

/** One locked round on a named table, through the real service. */
function lockOn(table: string) {
  return createOrder(f.db, f.venueId, f.actor('Amar'), {
    client_id: randomUUID(),
    table_id: f.tableId(table),
    lines: [{ id: randomUUID(), product_id: f.productId('Kafa'), qty: 1 }],
  })
}

/** The one line of a one-line round. */
function lineOf(orderId: string): string {
  return f.db.select().from(schema.orderLines)
    .where(eq(schema.orderLines.orderId, orderId)).all()[0]!.id
}

/** Haris's seeded dev PIN — `closeShift` runs the real `verifyPinMetered`. */
const HARIS_PIN = '123456'

/**
 * A night the close will accept: an opening count (or it is `NO_OPEN_COUNT`),
 * and no tab left open (or it is `OPEN_TABS`). No money changes hands, so the
 * expectation is 0 and `cash_counted_fen: 0` is inside tolerance.
 */
function nightReadyToClose(): string {
  const shiftId = f.openShift({ members: ['Amar', 'Emir'] })
  f.submitCount('Emir', ['Kafa (mljevena)'], { phase: 'open' })
  return shiftId
}

/** The seed's first category — `createProduct` needs one and none is named in the fixture. */
function firstCategory(): string {
  return f.db.select({ id: schema.categories.id }).from(schema.categories).all()[0]!.id
}

/**
 * One enrolled phone, written straight into the table.
 *
 * Deliberately not `enrolDevice()`: that call is itself one of the routes under
 * test, and a fixture that bumps before the assertion's `before` snapshot would
 * measure nothing.
 */
function enrolled(label = 'Emirov telefon'): string {
  const id = randomUUID()
  f.db.insert(schema.devices).values({
    id,
    venueId: f.venueId,
    label,
    tokenHash: randomUUID(),
    mode: 'shared',
    enrolledAt: f.clock.now(),
    lastSeenAt: f.clock.now(),
    pendingCount: 0,
    clockSkewS: 0,
  }).run()
  return id
}

describe('every mutating route bumps the change feed', () => {
  const routes = mutatingRoutes()

  it('found the route tree at all', () => {
    expect(routes.length).toBeGreaterThan(0)
    expect(routes).toContain('orders.post.ts')
  })

  it('has a registered call for every non-exempt mutating route', () => {
    const unregistered = routes
      .filter(route => !EXEMPT.some(rx => rx.test(route)))
      .filter(route => !(route in CALLS))

    expect(
      unregistered,
      `add a fixture call to tests/unit/changes-coverage.test.ts for: ${unregistered.join(', ')}`,
    ).toEqual([])
  })

  it.each(Object.keys(CALLS))('%s grows maxSeq', (route) => {
    // The route file still has to exist — a call left behind after a route is
    // deleted (WP3 deletes `tabs/[id]/pay`) is dead weight, not coverage.
    expect(routes, `${route} is registered but has no route file`).toContain(route)

    const before = maxSeq(f.db, f.venueId)
    CALLS[route]!()
    expect(maxSeq(f.db, f.venueId)).toBeGreaterThan(before)
  })

  it('the exemptions are the §4.1 names, the dev enrol, WP1\'s credential writes and *Odbaci*', () => {
    expect(EXEMPT).toHaveLength(6)
    expect(EXEMPT.some(rx => rx.test(join('devices', 'heartbeat.post.ts')))).toBe(true)
    expect(EXEMPT.some(rx => rx.test(join('auth', 'pin.post.ts')))).toBe(true)
    expect(EXEMPT.some(rx => rx.test(join('admin', 'enrol-codes.post.ts')))).toBe(true)
    expect(EXEMPT.some(rx => rx.test(join('admin', 'devices', '[id]', 'index.patch.ts')))).toBe(true)
    // …and nothing wider: revoke and unlock live one folder along and must not
    // fall through the same pattern.
    expect(EXEMPT.some(rx => rx.test(join('admin', 'devices', '[id]', 'revoke.post.ts')))).toBe(false)
    expect(EXEMPT.some(rx => rx.test(join('drafts', 'discard.post.ts')))).toBe(true)
    expect(sep).toBeTruthy()
  })
})
