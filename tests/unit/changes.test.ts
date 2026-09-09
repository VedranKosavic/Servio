/**
 * The change feed (`docs/BACKEND.md` §4.1).
 *
 * The two properties everything else rests on: a mutating transaction that
 * commits leaves exactly one cursor row per entity it touched, and one that
 * throws leaves none.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import {
  getChanges, maxSeq, menuVersion, minSeq, pendingCounts, pruneChanges, bump,
} from '../../server/services/changes'
import { createOrder } from '../../server/services/orders'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

/** A real lock through the real service — the hot path the feed exists for. */
function lockOne(waiter = 'Amar', table = 'Sto 7', product = 'Kafa') {
  return createOrder(f.db, f.venueId, f.actor(waiter), {
    client_id: randomUUID(),
    table_id: f.tableId(table),
    lines: [{ id: randomUUID(), product_id: f.productId(product), qty: 1 }],
  })
}

describe('maxSeq', () => {
  it('is 0 on a freshly seeded venue', () => {
    expect(maxSeq(f.db, f.venueId)).toBe(0)
    expect(minSeq(f.db, f.venueId)).toBe(0)
  })

  it('grows monotonically, one step per bump', () => {
    const first = f.db.transaction(tx => bump(tx, f.venueId, 'table'))
    const second = f.db.transaction(tx => bump(tx, f.venueId, 'stock'))
    expect(second).toBeGreaterThan(first)
    expect(maxSeq(f.db, f.venueId)).toBe(second)
  })
})

describe('bump inside a transaction', () => {
  it('a lock bumps table, prep and stock', () => {
    // The shift is opened first, so this measures the lock's own three bumps
    // (§6.1 step 11) and nothing else. The case below covers the other half.
    f.openShift({ members: ['Amar'] })
    lockOne()
    const entities = f.db.select().from(schema.changes).all().map(r => r.entity)
    expect(new Set(entities)).toEqual(new Set(['table', 'prep', 'stock']))
  })

  it('the first lock of the evening also bumps log, because it opens the night', () => {
    // `ensureOpenShift` writes `shift_opened` when it creates a shift (§8), and
    // `log()` bumps. So the very first lock carries a fourth entity that no
    // later lock does — which is the shape of the evening, not a stray bump.
    lockOne()
    const entities = f.db.select().from(schema.changes).all().map(r => r.entity)
    expect(new Set(entities)).toEqual(new Set(['table', 'prep', 'stock', 'log']))

    const kinds = f.db.select().from(schema.logEntries).all().map(r => r.kind)
    expect(kinds).toEqual(['shift_opened'])
  })

  it('a transaction that throws leaves maxSeq unchanged', () => {
    lockOne()
    const before = maxSeq(f.db, f.venueId)

    expect(() => f.db.transaction((tx) => {
      bump(tx, f.venueId, 'table')
      bump(tx, f.venueId, 'shift')
      throw new Error('boom')
    })).toThrow('boom')

    expect(maxSeq(f.db, f.venueId)).toBe(before)
  })
})

describe('getChanges', () => {
  const admin = () => f.adminActor()

  it('since = 0 answers full, with every snapshot', () => {
    lockOne()
    const result = getChanges(f.db, f.venueId, admin(), 0)

    expect(result.full).toBe(true)
    expect(result.seq).toBe(maxSeq(f.db, f.venueId))
    expect(result.tables_state).toBeDefined()
    expect(result.prep).toBeDefined()
    expect(result.stock).toBeDefined()
    expect(result.counts).toBeDefined()
    expect(result.menu_version).toBeDefined()
  })

  it('returns exactly the entities that moved, and attaches their snapshots', () => {
    const first = lockOne()
    const cursor = maxSeq(f.db, f.venueId)

    // Something that moves only the shelf.
    f.db.transaction(tx => bump(tx, f.venueId, 'stock'))

    const result = getChanges(f.db, f.venueId, admin(), cursor)
    expect(result.full).toBe(false)
    expect(result.changes.map(c => c.entity)).toEqual(['stock'])
    expect(result.stock).toBeDefined()
    // Nothing else moved, so nothing else is attached — that is the whole point
    // of the feed being keys rather than a snapshot of everything.
    expect(result.tables_state).toBeUndefined()
    expect(result.prep).toBeUndefined()
    expect(first.order_id).toBeTruthy()
  })

  it('the tables_state snapshot is re-read, not replayed', () => {
    lockOne('Amar', 'Sto 7')
    const result = getChanges(f.db, f.venueId, admin(), 0)
    // WP3's envelope: the floor plan travels with the shift strip (§6.2).
    const sto7 = result.tables_state?.tables.find(t => t.table_id === f.tableId('Sto 7'))
    expect(sto7?.tab_id).toBeTruthy()
    expect(sto7?.total_fen).toBe(150)
  })

  it('since = latest is empty and attaches nothing', () => {
    lockOne()
    const result = getChanges(f.db, f.venueId, admin(), maxSeq(f.db, f.venueId))

    expect(result.full).toBe(false)
    expect(result.changes).toEqual([])
    expect(result.tables_state).toBeUndefined()
    expect(result.stock).toBeUndefined()
    expect(result.prep).toBeUndefined()
  })

  it('a cursor the prune has passed answers full', () => {
    lockOne()
    // Everything so far is a week old, and the nightly prune has taken it.
    pruneChanges(f.db, new Date(Date.now() + 60_000).toISOString())
    lockOne('Lejla', 'Sto 8')

    const behind = getChanges(f.db, f.venueId, admin(), 1)
    expect(behind.full).toBe(true)
  })

  it('withholds the pending queues from a waiter and the log cursor from staff', () => {
    f.voidLine('Amar', f.lock('Amar', 'Sto 9', [{ product: 'Kafa' }]).lineIds[0]!)
    f.logEntry()
    f.db.transaction((tx) => {
      bump(tx, f.venueId, 'adjustment')
      bump(tx, f.venueId, 'log')
    })

    const forAdmin = getChanges(f.db, f.venueId, admin(), 0)
    expect(forAdmin.pending?.adjustments).toBe(1)
    expect(forAdmin.log_max_at).toBeTruthy()

    const forWaiter = getChanges(f.db, f.venueId, f.actor('Amar'), 0)
    expect(forWaiter.pending).toBeUndefined()
    expect(forWaiter.log_max_at).toBeUndefined()

    // A bartender decides voids, so he does get the queue — and still no Dnevnik.
    const forBartender = getChanges(f.db, f.venueId, f.actor('Emir'), 0)
    expect(forBartender.pending?.adjustments).toBe(1)
    expect(forBartender.log_max_at).toBeUndefined()
  })

  it('never leaks a second venue', () => {
    lockOne()
    const mine = maxSeq(f.db, f.venueId)

    const otherId = randomUUID()
    f.db.insert(schema.venues).values({
      id: otherId, name: 'Druga', slug: 'druga', createdAt: f.clock.now(),
    }).run()
    f.db.transaction((tx) => {
      bump(tx, otherId, 'table')
      bump(tx, otherId, 'stock')
    })

    // The other venue's rows took the next global seq numbers, and this venue's
    // cursor did not move by one.
    expect(maxSeq(f.db, f.venueId)).toBe(mine)
    const result = getChanges(f.db, f.venueId, f.adminActor(), mine)
    expect(result.changes).toEqual([])
    expect(result.seq).toBe(mine)
  })
})

describe('menuVersion and pendingCounts', () => {
  it('menu_version tracks menu and settings only', () => {
    f.db.transaction(tx => bump(tx, f.venueId, 'table'))
    expect(menuVersion(f.db, f.venueId)).toBe(0)

    const seq = f.db.transaction(tx => bump(tx, f.venueId, 'menu'))
    expect(menuVersion(f.db, f.venueId)).toBe(seq)
  })

  // The badge in the /a nav is this sum, so a queue missing here is a badge
  // smaller than the attention list it counts.
  it('counts every queue the attention list assembles', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Emir'] })
    const lock = f.lock('Amar', 'Sto 3', [{ product: 'Kafa' }])
    f.voidLine('Amar', lock.lineIds[0]!)
    f.cashMovement({ type: 'payout', amountFen: 6000, user: 'Amar', status: 'pending' })
    f.settle('Amar')
    f.submitCount('Emir', ['Kafa (mljevena)'])

    const pending = pendingCounts(f.db, f.venueId)
    expect(pending).toEqual({
      adjustments: 1, unpaid: 0, payouts: 1, settlements: 1, counts: 1,
    })
    expect(shiftId).toBeTruthy()
  })
})

/**
 * The two forward references Phase 2 (WP0) closed: the shift snapshot is the
 * whole `ShiftBrief`, and a session refresh rides in the answer instead of only
 * being hinted at through a `changes[]` row.
 */
describe('the shift and me snapshots', () => {
  it('the shift snapshot is the whole ShiftBrief, per actor', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    f.lock('Amar', 'Sto 7', [{ product: 'Kafa' }])
    f.settle('Amar')
    f.db.transaction(tx => bump(tx, f.venueId, 'shift'))

    const forAmar = getChanges(f.db, f.venueId, f.actor('Amar'), 0).shift
    const forLejla = getChanges(f.db, f.venueId, f.actor('Lejla'), 0).shift

    // The four fields the strip draws and the old four-column snapshot lacked.
    expect(forAmar?.closing).toBe(false)
    expect(forAmar?.closer_name).toBeNull()
    // Per actor, which is exactly why the ETag carries the user.
    expect(forAmar?.my_settled).toBe(true)
    expect(forLejla?.my_settled).toBe(false)
    expect(forAmar?.business_date).toBe(forLejla?.business_date)
  })

  it('attaches me when a user or device row moved, and never on a full answer', () => {
    // A cursor above 0, or the answer would be `full` for that reason alone.
    lockOne()
    const cursor = maxSeq(f.db, f.venueId)
    f.db.transaction(tx => bump(tx, f.venueId, 'user'))

    const incremental = getChanges(f.db, f.venueId, f.actor('Amar'), cursor)
    expect(incremental.me?.user.name).toBe('Amar')
    expect(incremental.me?.venue.slug).toBe('lounge')
    // No secret ever rides along, on any envelope.
    expect(JSON.stringify(incremental.me)).not.toMatch(/_hash|password|pepper|token/)

    // A `full` answer lists every entity that ever moved, so attaching `me`
    // there would mean every screen's first poll carries it — and a screen that
    // has just opened has read `/api/me` already.
    expect(getChanges(f.db, f.venueId, f.actor('Amar'), 0).me).toBeUndefined()
  })

  it('does not attach me when nothing about the person moved', () => {
    lockOne()
    const cursor = maxSeq(f.db, f.venueId)
    lockOne('Lejla', 'Sto 8')
    expect(getChanges(f.db, f.venueId, f.actor('Amar'), cursor).me).toBeUndefined()
  })
})
