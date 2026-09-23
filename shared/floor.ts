/**
 * The room, as the owner arranged it — where every table stands, and the bar.
 *
 * **Why this exists.** The plan used to be computed: one vertical stack per
 * `col`, ordered by `row`, the stacks spread across the width. That draws a
 * spreadsheet of the room rather than the room, and the only way to move a
 * table was to describe its column and row in words. The owner's ask: *"Allow
 * me to move tables how I want … once I click save then we should save that and
 * it shouldn't change again."* So the arrangement is data now, dragged into
 * place on *Stolovi* and stored as it was dropped.
 *
 * **The coordinate system.** A zone is a room some number of units wide —
 * `ROOM_W_DEFAULT` until the owner makes it narrower or wider on *Stolovi*
 * (*"can we make our caffe wider, its too narrow"*) — and the room is always
 * drawn at the full width of the screen, so a unit is that width divided by the
 * room's. The same layout is therefore the same picture on a 375 px phone and a
 * 1440 px laptop: the owner arranges it once, on either, and every screen
 * agrees. A wider room is more floor for the same tables, which is why they get
 * smaller on screen as it grows, and why it stops at `ROOM_W_MAX`. The height is
 * whatever the content needs.
 *
 * **Before the first save** nothing is stored and the old stacking rule still
 * places every table (`autoLayout`), so the plan never goes blank. The first
 * *Sačuvaj* writes every table's spot, auto-placed ones included, and from then
 * on the stored spots are the room: `col`/`row` are only consulted again for a
 * table added later, which lands in a row under everything until it is moved.
 *
 * Pure: shared by the waiter's plan, *Puls*, the editor and the server's check.
 */
import { z } from 'zod'
import type { VenueTable, Zone } from './types'

// ---------------------------------------------------------------------------
// Geometry, in room units
// ---------------------------------------------------------------------------

/**
 * How wide a room is, in units. 100 was the first room, and it was too narrow
 * for the owner's tables; the default is a quarter wider. The cap is the phone:
 * at 140 a table on a 375 px screen is still ~37 px, and its chairs make the
 * tap target (`FloorTable`) about 50.
 */
export const ROOM_W_DEFAULT = 125
export const ROOM_W_MIN = 100
export const ROOM_W_MAX = 140
export const ROOM_W_STEP = 5

/** A square or round table top. */
export const TABLE = 16
/** The long one: a table for six. */
export const TABLE_WIDE = 26
/** A chair: its depth, and the gap between it and the table top. */
export const CHAIR_DEPTH = 2
export const CHAIR_GAP = 0.6
/** How far the chairs reach beyond the top — the room keeps them clear of the walls. */
export const CHAIR_OUT = CHAIR_DEPTH + CHAIR_GAP
/** The nearest a table top may stand to a wall, chairs included. */
export const EDGE = 3
/** The bar counter's depth, and how far its stools reach out of it. */
export const BAR_DEPTH = 10
export const STOOL_OUT = 4.4
export const BAR_MIN = 16
/** The longest bar the widest room fits between its walls. */
export const BAR_MAX = ROOM_W_MAX - 2 * (4.4 + 0.6)
export const BAR_DEFAULT = 40
/**
 * The margin and spacing the automatic layout uses: tables in a run stand
 * `GAP` apart — room for both sets of chairs and a strip of floor between them —
 * and the VIP pair `GAP_X`, which is what keeps it abreast on a phone.
 */
const PAD = 6
const GAP = 7
const GAP_X = 6
/** The VIP box around a group of tables: padding, and the strip its name sits in. */
export const GROUP_PAD = 3
export const GROUP_LABEL = 5

export const TABLE_SHAPES = ['square', 'round', 'wide'] as const
export type TableShape = typeof TABLE_SHAPES[number]

/**
 * Which way the bar faces, as the side its stools are on: 0 below, 90 left,
 * 180 above, 270 right. The counter itself is horizontal at 0 and 180.
 */
export const BAR_ROTATIONS = [0, 90, 180, 270] as const
export type BarRotation = typeof BAR_ROTATIONS[number]

// ---------------------------------------------------------------------------
// What is stored
// ---------------------------------------------------------------------------

/** One table's place: the top-left corner of its top, in room units. */
export interface FloorSpot {
  x: number
  y: number
  shape?: TableShape
}

export interface FloorBar {
  zone: Zone
  x: number
  y: number
  len: number
  rot: BarRotation
}

/**
 * `bar` missing means *never arranged* — the bar stands where it always stood,
 * at the foot of Unutra's first run. `null` is a room with no bar drawn.
 */
export interface FloorLayout {
  tables: Record<string, FloorSpot>
  bar?: FloorBar | null
  /** Each zone's width in units; a zone not named is `ROOM_W_DEFAULT`. */
  widths?: Partial<Record<Zone, number>>
}

const coord = z.int().min(0).max(400)

export const floorSpotSchema = z.object({
  x: coord,
  y: coord,
  shape: z.enum(TABLE_SHAPES).optional(),
}).strict()

export const floorBarSchema = z.object({
  zone: z.enum(['unutra', 'basta']),
  x: coord,
  y: coord,
  len: z.int().min(BAR_MIN).max(BAR_MAX),
  rot: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
}).strict()

const roomWidth = z.int().min(ROOM_W_MIN).max(ROOM_W_MAX)

const widthsSchema = z.object({
  unutra: roomWidth.optional(),
  basta: roomWidth.optional(),
}).strict()

/** `PUT /api/admin/floor` — the whole arrangement, every time. */
export const floorLayoutBody = z.object({
  tables: z.record(z.string().min(1).max(64), floorSpotSchema),
  bar: floorBarSchema.nullable(),
  widths: widthsSchema.optional(),
}).strict()

export type FloorLayoutBody = z.infer<typeof floorLayoutBody>

/**
 * `POST /api/tables` — a table the waiter brings out mid-shift, and the spot on
 * the plan he dropped it on. A worker may call this: an extra table in the
 * garden at ten at night is not an errand for the owner's laptop.
 */
export const addTableBody = z.object({
  zone: z.enum(['unutra', 'basta']),
  x: coord,
  y: coord,
  /** Left out, the server names it after the highest *Sto N* it already has. */
  name: z.string().trim().min(1).max(20).optional(),
}).strict()

export type AddTableBody = z.infer<typeof addTableBody>

const storedLayout = z.object({
  tables: z.record(z.string(), floorSpotSchema),
  bar: floorBarSchema.nullable().optional(),
  widths: widthsSchema.optional(),
})

/**
 * `venues.floor_json`, read leniently. A blob that does not parse draws the
 * automatic plan rather than breaking the screen a waiter is standing at.
 */
export function parseFloor(json: string | null | undefined): FloorLayout {
  if (!json) return { tables: {} }
  try {
    const parsed = storedLayout.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : { tables: {} }
  } catch {
    return { tables: {} }
  }
}

/** A zone's width in units. */
export function zoneWidth(layout: FloorLayout, zone: Zone): number {
  return layout.widths?.[zone] ?? ROOM_W_DEFAULT
}

/** Has the owner ever pressed *Sačuvaj*? */
export function isArranged(layout: FloorLayout): boolean {
  return Object.keys(layout.tables).length > 0 || layout.bar !== undefined
}

// ---------------------------------------------------------------------------
// What is drawn
// ---------------------------------------------------------------------------

export interface PlacedTable {
  id: string
  x: number
  y: number
  w: number
  h: number
  shape: TableShape
  grp: string | null
  /** Added after the room was arranged, and parked under it until moved. */
  loose: boolean
}

export interface PlacedBar {
  x: number
  y: number
  w: number
  h: number
  len: number
  rot: BarRotation
}

export interface RoomGroup {
  name: string
  x: number
  y: number
  w: number
  h: number
}

export interface RoomPlan {
  zone: Zone
  /** Units from the left wall to the right one. */
  width: number
  tables: PlacedTable[]
  groups: RoomGroup[]
  bar: PlacedBar | null
  /** Room units, from the top wall to the bottom one. */
  height: number
}

export function tableSize(shape: TableShape): { w: number, h: number } {
  return shape === 'wide' ? { w: TABLE_WIDE, h: TABLE } : { w: TABLE, h: TABLE }
}

export function barBox(bar: Pick<FloorBar, 'x' | 'y' | 'len' | 'rot'>): PlacedBar {
  const across = bar.rot === 0 || bar.rot === 180
  return {
    x: bar.x,
    y: bar.y,
    w: across ? bar.len : BAR_DEPTH,
    h: across ? BAR_DEPTH : bar.len,
    len: bar.len,
    rot: bar.rot,
  }
}

/**
 * The old rule, in room units: one stack per `col` ordered by `row`, the stacks
 * spread edge to edge, shorter stacks centred against the tallest, and a `grp`
 * boxed side by side under its column. It is what the plan looked like before
 * anybody arranged it, so the first open of the editor starts from the room the
 * staff already know.
 */
export function autoLayout(zoneTables: readonly VenueTable[], roomW = ROOM_W_DEFAULT): {
  spots: Map<string, { x: number, y: number }>
  bottom: number
} {
  const spots = new Map<string, { x: number, y: number }>()
  if (!zoneTables.length) return { spots, bottom: 0 }

  const cols = [...new Set(zoneTables.map(t => t.col))].sort((a, b) => a - b)
  const columns = cols.map((col) => {
    const inColumn = zoneTables.filter(t => t.col === col)
    const stack = inColumn.filter(t => !t.grp).sort((a, b) => a.row - b.row)
    const groupNames = [...new Set(inColumn.filter(t => t.grp).map(t => t.grp!))]
    const groups = groupNames.map((name) => {
      const members = inColumn.filter(t => t.grp === name).sort((a, b) => a.row - b.row)
      return {
        members,
        w: members.length * TABLE + (members.length - 1) * GAP_X + 2 * GROUP_PAD,
        h: GROUP_LABEL + TABLE + 2 * GROUP_PAD,
      }
    })
    const stackH = stack.length ? stack.length * TABLE + (stack.length - 1) * GAP : 0
    const groupsH = groups.reduce((sum, g) => sum + g.h, 0) + Math.max(0, groups.length - 1) * GAP
    return {
      stack,
      groups,
      w: Math.max(TABLE, ...groups.map(g => g.w)),
      h: stackH + (stack.length && groups.length ? GAP : 0) + groupsH,
    }
  })

  const used = columns.reduce((sum, c) => sum + c.w, 0)
  const room = roomW - 2 * PAD
  const between = columns.length > 1 ? (room - used) / (columns.length - 1) : 0
  const tallest = Math.max(...columns.map(c => c.h))

  let left = columns.length > 1 ? PAD : (roomW - columns[0]!.w) / 2
  let bottom = 0
  for (const column of columns) {
    let top = PAD + (tallest - column.h) / 2
    for (const table of column.stack) {
      spots.set(table.id, { x: Math.round(left + (column.w - TABLE) / 2), y: Math.round(top) })
      top += TABLE + GAP
    }
    for (const group of column.groups) {
      const boxX = left + (column.w - group.w) / 2
      group.members.forEach((table, i) => {
        spots.set(table.id, {
          x: Math.round(boxX + GROUP_PAD + i * (TABLE + GAP_X)),
          y: Math.round(top + GROUP_LABEL + GROUP_PAD),
        })
      })
      top += group.h + GAP
    }
    bottom = Math.max(bottom, PAD + (tallest + column.h) / 2)
    left += column.w + between
  }

  return { spots, bottom: Math.round(bottom + CHAIR_OUT) }
}

/**
 * Where the bar stood before anybody moved it: along the bottom of Unutra, at
 * the foot of the first run, its stools facing the room.
 */
export function defaultBar(zone: Zone, autoBottom: number): FloorBar {
  return { zone, x: PAD, y: Math.round(autoBottom + GAP + STOOL_OUT), len: BAR_DEFAULT, rot: 180 }
}

/**
 * One zone, ready to draw: every active table in it at its place, the VIP
 * boxes drawn around their members, the bar if it stands here, and how tall
 * the room has to be to hold all of it.
 */
export function roomPlan(tables: readonly VenueTable[], layout: FloorLayout, zone: Zone): RoomPlan {
  const inZone = tables.filter(t => t.zone === zone)
  const width = zoneWidth(layout, zone)
  const auto = autoLayout(inZone, width)
  const arranged = Object.keys(layout.tables).length > 0

  const placed: PlacedTable[] = []
  const loose: VenueTable[] = []

  for (const table of inZone) {
    const spot = layout.tables[table.id]
    if (spot) {
      const shape = spot.shape ?? 'square'
      placed.push({ id: table.id, x: spot.x, y: spot.y, shape, grp: table.grp, loose: false, ...tableSize(shape) })
    } else if (!arranged) {
      const at = auto.spots.get(table.id)!
      placed.push({ id: table.id, ...at, shape: 'square', grp: table.grp, loose: false, ...tableSize('square') })
    } else {
      loose.push(table)
    }
  }

  let bar: PlacedBar | null = null
  if (layout.bar === undefined) {
    if (zone === 'unutra' && inZone.length) bar = barBox(defaultBar(zone, auto.bottom))
  } else if (layout.bar && layout.bar.zone === zone) {
    bar = barBox(layout.bar)
  }

  // A table added after the room was arranged has no spot yet. It is parked in
  // a row under everything rather than on top of somebody else's table, and the
  // editor marks it until it has been moved and saved.
  if (loose.length) {
    let x = EDGE + 2
    let y = contentBottom(placed, [], bar) + GAP
    for (const table of loose) {
      const { w, h } = tableSize('square')
      if (x + w > width - EDGE) {
        x = EDGE + 2
        y += TABLE + GAP
      }
      placed.push({ id: table.id, x, y, w, h, shape: 'square', grp: table.grp, loose: true })
      x += w + GAP
    }
  }

  const groups = groupBoxes(placed)
  return {
    zone,
    width,
    tables: placed,
    groups,
    bar,
    height: Math.max(40, Math.ceil(contentBottom(placed, groups, bar) + 3)),
  }
}

/** The VIP pair and anything like it: one box around all of a group's tables. */
function groupBoxes(placed: readonly PlacedTable[]): RoomGroup[] {
  const names = [...new Set(placed.filter(t => t.grp).map(t => t.grp!))]
  return names.map((name) => {
    const members = placed.filter(t => t.grp === name)
    const x0 = Math.min(...members.map(t => t.x)) - GROUP_PAD
    const y0 = Math.min(...members.map(t => t.y)) - GROUP_PAD - GROUP_LABEL
    const x1 = Math.max(...members.map(t => t.x + t.w)) + GROUP_PAD
    const y1 = Math.max(...members.map(t => t.y + t.h)) + GROUP_PAD
    return { name, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  })
}

function contentBottom(
  placed: readonly PlacedTable[], groups: readonly RoomGroup[], bar: PlacedBar | null,
): number {
  return Math.max(
    0,
    ...placed.map(t => t.y + t.h + CHAIR_OUT),
    ...groups.map(g => g.y + g.h),
    bar ? bar.y + bar.h + (bar.rot === 0 ? STOOL_OUT : 0) : 0,
  )
}

// ---------------------------------------------------------------------------
// The editor's rules
// ---------------------------------------------------------------------------

/** The spot a dragged table may be dropped on: whole units, clear of the walls. */
export function clampTable(x: number, y: number, w: number, roomW = ROOM_W_DEFAULT): { x: number, y: number } {
  return {
    x: Math.round(Math.min(Math.max(x, EDGE), roomW - w - EDGE)),
    y: Math.round(Math.max(y, EDGE)),
  }
}

export function clampBar(x: number, y: number, w: number, roomW = ROOM_W_DEFAULT): { x: number, y: number } {
  const edge = STOOL_OUT + 0.6
  return {
    x: Math.round(Math.min(Math.max(x, edge), roomW - w - edge)),
    y: Math.round(Math.max(y, edge)),
  }
}

/**
 * Two table tops on one patch of floor, or a table standing in the bar. The
 * editor marks both and will not save until they are apart — the plan a waiter
 * taps cannot have one tile under another. Chairs may touch; tops may not.
 */
export function overlapping(plan: RoomPlan): Set<string> {
  const boxes = [
    ...plan.tables.map(t => ({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h })),
    ...(plan.bar ? [{ id: 'bar', ...plan.bar }] : []),
  ]
  const hit = new Set<string>()
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!
      const b = boxes[j]!
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        hit.add(a.id)
        hit.add(b.id)
      }
    }
  }
  return hit
}

/**
 * What *Sačuvaj* sends: every table the plans draw, at the spot it is drawn at
 * — auto-placed and parked ones included — so that nothing on the plan is ever
 * computed again, and the bar as it stands.
 */
export function layoutFromPlans(plans: readonly RoomPlan[], fallbackBar: FloorBar | null): FloorLayoutBody {
  const tables: Record<string, FloorSpot> = {}
  const widths: Partial<Record<Zone, number>> = {}
  let bar: FloorBar | null = fallbackBar
  for (const plan of plans) {
    widths[plan.zone] = plan.width
    for (const t of plan.tables) {
      tables[t.id] = t.shape === 'square'
        ? { x: Math.round(t.x), y: Math.round(t.y) }
        : { x: Math.round(t.x), y: Math.round(t.y), shape: t.shape }
    }
    if (plan.bar) {
      bar = { zone: plan.zone, x: Math.round(plan.bar.x), y: Math.round(plan.bar.y), len: plan.bar.len, rot: plan.bar.rot }
    }
  }
  return { tables, bar, widths }
}

/**
 * The narrowest this room can be made without a table or the bar standing in
 * the right-hand wall — *Uža* stops here instead of moving anything the owner
 * put down.
 */
export function narrowest(plan: RoomPlan): number {
  const reach = Math.max(
    0,
    ...plan.tables.map(t => t.x + t.w + EDGE),
    plan.bar ? plan.bar.x + plan.bar.w + STOOL_OUT + 0.6 : 0,
  )
  return Math.min(ROOM_W_MAX, Math.max(ROOM_W_MIN, Math.ceil(reach / ROOM_W_STEP) * ROOM_W_STEP))
}
