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
import { createDelivery } from '../../server/services/stock'
import { payTab } from '../../server/services/tabs'
import { markLogSeen } from '../../server/services/log'
import { enrolDevice, mintEnrolCode, revokeDevice, unlockDevice } from '../../server/services/devices'
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
    createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Kafa'), qty: 1 }],
    })
  },

  [join('prep', '[orderId]', 'done.post.ts')]: () => {
    const order = createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 8'),
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Kafa'), qty: 1 }],
    })
    markPrepared(f.db, f.venueId, order.order_id, f.userId('Emir'))
  },

  [join('stock', 'deliveries.post.ts')]: () => {
    createDelivery(f.db, f.venueId, {
      user_id: f.userId('Emir'),
      lines: [{ stock_item_id: f.stockItemId('Coca-Cola 0,25 l'), qty: 24 }],
    })
  },

  [join('tabs', '[id]', 'pay.post.ts')]: () => {
    const order = createOrder(f.db, f.venueId, {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 9'),
      user_id: f.userId('Amar'),
      lines: [{ product_id: f.productId('Kafa'), qty: 1 }],
    })
    payTab(f.db, f.venueId, order.tab_id, f.userId('Amar'))
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

  it('the exemptions are exactly the two §4.1 names, the dev-only enrol and WP1\'s two credential writes', () => {
    expect(EXEMPT).toHaveLength(5)
    expect(EXEMPT.some(rx => rx.test(join('devices', 'heartbeat.post.ts')))).toBe(true)
    expect(EXEMPT.some(rx => rx.test(join('auth', 'pin.post.ts')))).toBe(true)
    expect(EXEMPT.some(rx => rx.test(join('admin', 'enrol-codes.post.ts')))).toBe(true)
    expect(EXEMPT.some(rx => rx.test(join('admin', 'devices', '[id]', 'index.patch.ts')))).toBe(true)
    // …and nothing wider: revoke and unlock live one folder along and must not
    // fall through the same pattern.
    expect(EXEMPT.some(rx => rx.test(join('admin', 'devices', '[id]', 'revoke.post.ts')))).toBe(false)
    expect(sep).toBeTruthy()
  })
})
