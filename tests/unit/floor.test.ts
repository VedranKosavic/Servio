/**
 * The room as the owner arranged it (`shared/floor.ts`).
 *
 * The promise these hold is the owner's: *"once I click save then we should
 * save that and it shouldn't change again."* A saved spot is drawn exactly where
 * it was saved; nothing about a saved room is recomputed; a table added later is
 * parked where it covers nobody; and the plan a waiter taps never has one tile
 * under another.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, type Fixture } from '../helpers/db'
import { saveFloor } from '../../server/services/admin'
import { getBootstrap } from '../../server/services/bootstrap'
import { menuVersion } from '../../server/services/changes'
import {
  CHAIR_OUT, EDGE, ROOM_W_DEFAULT, ROOM_W_MAX, TABLE, TABLE_WIDE, autoLayout, clampTable,
  floorLayoutBody, isArranged, layoutFromPlans, narrowest, overlapping, parseFloor, roomPlan,
} from '#shared/floor'
import type { FloorLayout } from '#shared/floor'
import type { VenueTable } from '#shared/types'

function table(patch: Partial<VenueTable> & { id: string }): VenueTable {
  return { name: `Sto ${patch.id}`, zone: 'unutra', col: 1, row: 1, grp: null, sort: 1, ...patch }
}

const room: VenueTable[] = [
  table({ id: 'a', col: 1, row: 1 }),
  table({ id: 'b', col: 1, row: 2 }),
  table({ id: 'c', col: 2, row: 1 }),
  table({ id: 'v1', col: 2, row: 1, grp: 'vip' }),
  table({ id: 'v2', col: 2, row: 2, grp: 'vip' }),
  table({ id: 'g', zone: 'basta', col: 1, row: 1 }),
]

describe('parseFloor', () => {
  it('reads nothing stored as a room nobody has arranged', () => {
    expect(parseFloor('{}')).toEqual({ tables: {} })
    expect(parseFloor(null)).toEqual({ tables: {} })
    expect(isArranged(parseFloor('{}'))).toBe(false)
  })

  it('never lets a broken blob break the plan', () => {
    expect(parseFloor('not json')).toEqual({ tables: {} })
    expect(parseFloor('{"tables":{"a":{"x":"left"}}}')).toEqual({ tables: {} })
  })

  it('keeps what was saved, bar and shapes included', () => {
    const stored: FloorLayout = {
      tables: { a: { x: 10, y: 12, shape: 'round' } },
      bar: { zone: 'unutra', x: 5, y: 80, len: 40, rot: 180 },
    }
    expect(parseFloor(JSON.stringify(stored))).toEqual(stored)
    expect(isArranged(stored)).toBe(true)
  })
})

describe('the automatic layout — a room nobody has arranged', () => {
  it('stacks each column by row and boxes a group abreast under it', () => {
    const { spots } = autoLayout(room.filter(t => t.zone === 'unutra'))
    expect(spots.get('a')!.x).toBe(spots.get('b')!.x)
    expect(spots.get('b')!.y).toBeGreaterThan(spots.get('a')!.y)
    expect(spots.get('c')!.x).toBeGreaterThan(spots.get('a')!.x)
    expect(spots.get('v1')!.y).toBe(spots.get('v2')!.y)
    expect(spots.get('v2')!.x).toBeGreaterThan(spots.get('v1')!.x)
  })

  it('keeps every table and its chairs inside the walls', () => {
    const plan = roomPlan(room, { tables: {} }, 'unutra')
    for (const t of plan.tables) {
      expect(t.x - CHAIR_OUT, t.id).toBeGreaterThanOrEqual(0)
      expect(t.x + t.w + CHAIR_OUT, t.id).toBeLessThanOrEqual(ROOM_W_DEFAULT)
    }
    expect(overlapping(plan).size).toBe(0)
  })

  it('stands the bar in Unutra only, and only until the room is arranged', () => {
    expect(roomPlan(room, { tables: {} }, 'unutra').bar).not.toBeNull()
    expect(roomPlan(room, { tables: {} }, 'basta').bar).toBeNull()
    expect(roomPlan(room, { tables: { a: { x: 10, y: 10 } }, bar: null }, 'unutra').bar).toBeNull()
  })
})

describe('a saved room', () => {
  const saved: FloorLayout = {
    tables: {
      a: { x: 70, y: 10 },
      b: { x: 10, y: 10, shape: 'wide' },
      c: { x: 10, y: 40 },
      v1: { x: 40, y: 70 },
      v2: { x: 62, y: 70 },
      g: { x: 20, y: 20, shape: 'round' },
    },
    bar: { zone: 'unutra', x: 10, y: 100, len: 50, rot: 180 },
  }

  it('draws every table exactly where it was saved', () => {
    const plan = roomPlan(room, saved, 'unutra')
    const at = new Map(plan.tables.map(t => [t.id, t]))
    expect(at.get('a')).toMatchObject({ x: 70, y: 10, w: TABLE, h: TABLE, loose: false })
    expect(at.get('b')).toMatchObject({ x: 10, y: 10, w: TABLE_WIDE, shape: 'wide' })
    expect(plan.bar).toMatchObject({ x: 10, y: 100, w: 50 })
  })

  it('does not move a saved table when col/row change afterwards', () => {
    const edited = room.map(t => (t.id === 'a' ? { ...t, col: 3, row: 5 } : t))
    const plan = roomPlan(edited, saved, 'unutra')
    expect(plan.tables.find(t => t.id === 'a')).toMatchObject({ x: 70, y: 10 })
  })

  it('draws the group box around wherever its tables were put', () => {
    const plan = roomPlan(room, saved, 'unutra')
    const vip = plan.groups.find(g => g.name === 'vip')!
    expect(vip.x).toBeLessThan(40)
    expect(vip.x + vip.w).toBeGreaterThan(62 + TABLE)
  })

  it('parks a table added later under the room, covering nobody', () => {
    const plan = roomPlan([...room, table({ id: 'new', col: 1, row: 1 })], saved, 'unutra')
    const parked = plan.tables.find(t => t.id === 'new')!
    expect(parked.loose).toBe(true)
    expect(parked.y).toBeGreaterThan(100)
    expect(overlapping(plan).has('new')).toBe(false)
  })

  it('grows the room to hold what is in it', () => {
    const plan = roomPlan(room, saved, 'unutra')
    expect(plan.height).toBeGreaterThanOrEqual(100 + 9)
  })
})

describe('the editor’s rules', () => {
  it('finds two tops on one patch of floor, and a table in the bar', () => {
    const plan = roomPlan(room, {
      tables: { a: { x: 10, y: 10 }, b: { x: 18, y: 12 }, c: { x: 60, y: 60 }, v1: { x: 40, y: 30 }, v2: { x: 70, y: 30 } },
      bar: { zone: 'unutra', x: 55, y: 62, len: 30, rot: 0 },
    }, 'unutra')
    expect([...overlapping(plan)].sort()).toEqual(['a', 'b', 'bar', 'c'])
  })

  it('lets tops stand edge to edge', () => {
    const plan = roomPlan(room, {
      tables: { a: { x: 10, y: 10 }, b: { x: 10 + TABLE, y: 10 } },
      bar: null,
    }, 'unutra')
    expect(overlapping(plan).size).toBe(0)
  })

  it('keeps a dropped table off the walls, in whole units', () => {
    expect(clampTable(-20, -5, TABLE)).toEqual({ x: EDGE, y: EDGE })
    expect(clampTable(999, 40.6, TABLE)).toEqual({ x: ROOM_W_DEFAULT - TABLE - EDGE, y: 41 })
    // …and the right-hand wall is wherever this room's is.
    expect(clampTable(999, 10, TABLE, 140).x).toBe(140 - TABLE - EDGE)
  })

  it('saves every table the plans draw — the auto-placed ones too', () => {
    const plans = (['unutra', 'basta'] as const).map(z => roomPlan(room, { tables: {} }, z))
    const body = layoutFromPlans(plans, null)
    expect(Object.keys(body.tables).sort()).toEqual(['a', 'b', 'c', 'g', 'v1', 'v2'])
    expect(body.widths).toEqual({ unutra: ROOM_W_DEFAULT, basta: ROOM_W_DEFAULT })
    expect(body.bar).toMatchObject({ zone: 'unutra', rot: 180 })
    // And saving that draws the very same room.
    const again = roomPlan(room, body, 'unutra')
    expect(again.tables.map(t => [t.id, t.x, t.y])).toEqual(plans[0]!.tables.map(t => [t.id, t.x, t.y]))
    expect(floorLayoutBody.safeParse(body).success).toBe(true)
  })

  it('refuses a layout the server should never store', () => {
    expect(floorLayoutBody.safeParse({ tables: { a: { x: 1.5, y: 2 } }, bar: null }).success).toBe(false)
    expect(floorLayoutBody.safeParse({ tables: { a: { x: 1, y: 2, shape: 'star' } }, bar: null }).success).toBe(false)
    expect(floorLayoutBody.safeParse({ tables: {}, bar: { zone: 'unutra', x: 1, y: 1, len: 30, rot: 45 } }).success).toBe(false)
    expect(floorLayoutBody.safeParse({ tables: {} }).success).toBe(false)
    expect(floorLayoutBody.safeParse({ tables: {}, bar: null, widths: { unutra: ROOM_W_MAX + 5 } }).success).toBe(false)
    expect(floorLayoutBody.safeParse({ tables: {}, bar: null, widths: { terasa: 120 } }).success).toBe(false)
  })
})

describe('the room’s width — "can we make our caffe wider"', () => {
  it('is wider than the first room until the owner says otherwise', () => {
    expect(roomPlan(room, { tables: {} }, 'unutra').width).toBe(ROOM_W_DEFAULT)
    expect(ROOM_W_DEFAULT).toBeGreaterThan(100)
  })

  it('keeps each zone’s own width, and every saved table where it was', () => {
    const layout: FloorLayout = {
      tables: { a: { x: 70, y: 10 }, g: { x: 20, y: 20 } },
      bar: null,
      widths: { unutra: 140, basta: 110 },
    }
    expect(parseFloor(JSON.stringify(layout))).toEqual(layout)
    const inside = roomPlan(room, layout, 'unutra')
    expect(inside.width).toBe(140)
    expect(inside.tables.find(t => t.id === 'a')).toMatchObject({ x: 70, y: 10 })
    expect(roomPlan(room, layout, 'basta').width).toBe(110)
  })

  it('spreads a room nobody arranged across whatever width it has', () => {
    const narrow = autoLayout(room.filter(t => t.zone === 'unutra'), 100).spots
    const wide = autoLayout(room.filter(t => t.zone === 'unutra'), 140).spots
    expect(wide.get('c')!.x).toBeGreaterThan(narrow.get('c')!.x)
  })

  it('will not narrow past a table standing near the right-hand wall', () => {
    const plan = roomPlan(room, { tables: { a: { x: 110, y: 10 } }, bar: null, widths: { unutra: 140 } }, 'unutra')
    expect(narrowest(plan)).toBeGreaterThanOrEqual(110 + TABLE + EDGE)
    expect(narrowest(roomPlan(room, { tables: { a: { x: 10, y: 10 } }, bar: null }, 'unutra'))).toBe(100)
  })
})

describe('Sačuvaj raspored — on the server', () => {
  let f: Fixture
  beforeEach(() => { f = makeFixture() })
  afterEach(() => { f.close() })

  it('stores the arrangement, and every phone’s bootstrap carries it', () => {
    const sto1 = f.tableId('Sto 1')
    const before = menuVersion(f.db, f.venueId)
    expect(getBootstrap(f.db, f.venueId, f.adminActor()).floor).toEqual({ tables: {} })

    saveFloor(f.db, f.venueId, f.adminActor(), {
      tables: { [sto1]: { x: 40, y: 22, shape: 'round' } },
      bar: { zone: 'unutra', x: 10, y: 90, len: 40, rot: 180 },
    })

    const floor = getBootstrap(f.db, f.venueId, f.adminActor()).floor
    expect(floor.tables[sto1]).toEqual({ x: 40, y: 22, shape: 'round' })
    expect(floor.bar).toEqual({ zone: 'unutra', x: 10, y: 90, len: 40, rot: 180 })
    // `menu_version` moved, so a waiter's poll refetches the bootstrap.
    expect(menuVersion(f.db, f.venueId)).toBeGreaterThan(before)
  })

  it('drops a spot for a table this venue does not have', () => {
    const saved = saveFloor(f.db, f.venueId, f.adminActor(), {
      tables: { [f.tableId('Sto 1')]: { x: 10, y: 10 }, 'not-a-table': { x: 50, y: 50 } },
      bar: null,
    })
    expect(Object.keys(saved.tables)).toEqual([f.tableId('Sto 1')])
    expect(saved.bar).toBeNull()
  })
})
