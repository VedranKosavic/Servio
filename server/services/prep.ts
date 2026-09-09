/**
 * *Priprema* — the bartender's ticket screen.
 *
 * House rule from PLAN.md §9: "no ticket, no drink; no lit coal for an unlocked
 * bowl". A round appears here the moment a waiter locks it and leaves when the
 * bartender taps it done.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { schema } from '../database/client'
import { conflict, notFound } from '../utils/errors'
import { nowIso } from '../utils/ids'
import type { Prep, PrepOrder } from '#shared/types'
import type { Db, Queryable } from './types'

/** How many finished rounds the bartender can still see. */
const DONE_LIMIT = 10

export function getPrep(db: Queryable, venueId: string): Prep {
  const open = loadOrders(db, venueId, { prepared: false, limit: 200 })
  const done = loadOrders(db, venueId, { prepared: true, limit: DONE_LIMIT })
  return { open, done }
}

export function getPrepOrder(db: Queryable, venueId: string, orderId: string): PrepOrder {
  const found = loadOrders(db, venueId, { orderId })
  if (found.length === 0) throw notFound('ORDER_NOT_FOUND', `order ${orderId} not found`)
  return found[0]!
}

/**
 * `POST /api/prep/:orderId/done` — one tap, once.
 *
 * The `orders` trigger allows exactly this transition and nothing else, so a
 * second tap is a 409 rather than a silently overwritten timestamp.
 */
export function markPrepared(db: Db, venueId: string, orderId: string, userId: string): PrepOrder {
  return db.transaction((tx) => {
    const order = tx.select().from(schema.orders)
      .where(and(eq(schema.orders.venueId, venueId), eq(schema.orders.id, orderId)))
      .get()
    if (!order) throw notFound('ORDER_NOT_FOUND', `order ${orderId} not found`)
    if (order.preparedAt) throw conflict('ORDER_ALREADY_PREPARED', `order ${orderId} is already prepared`)

    const user = tx.select({ id: schema.users.id }).from(schema.users)
      .where(and(eq(schema.users.id, userId), eq(schema.users.venueId, venueId)))
      .get()
    if (!user) throw notFound('USER_NOT_FOUND', `user ${userId} not found`)

    tx.update(schema.orders)
      .set({ preparedAt: nowIso(), preparedBy: userId })
      .where(eq(schema.orders.id, orderId))
      .run()

    return getPrepOrder(tx, venueId, orderId)
  })
}

interface LoadOptions {
  prepared?: boolean
  orderId?: string
  limit?: number
}

function loadOrders(db: Queryable, venueId: string, opts: LoadOptions): PrepOrder[] {
  const waiter = schema.users
  const where = [eq(schema.orders.venueId, venueId)]
  if (opts.orderId) where.push(eq(schema.orders.id, opts.orderId))
  if (opts.prepared === true) where.push(isNotNull(schema.orders.preparedAt))
  if (opts.prepared === false) where.push(isNull(schema.orders.preparedAt))

  const rows = db.select({
    id: schema.orders.id,
    createdAt: schema.orders.createdAt,
    preparedAt: schema.orders.preparedAt,
    preparedBy: schema.orders.preparedBy,
    note: schema.orders.note,
    tableName: schema.tables.name,
    waiterName: waiter.name,
  })
    .from(schema.orders)
    .innerJoin(schema.tabs, eq(schema.tabs.id, schema.orders.tabId))
    .innerJoin(schema.tables, eq(schema.tables.id, schema.tabs.tableId))
    .innerJoin(waiter, eq(waiter.id, schema.orders.lockedBy))
    .where(and(...where))
    // Open tickets: oldest first, the queue the bar actually works through.
    // Finished ones: newest first, because only the last few matter.
    .orderBy(opts.prepared === true ? desc(schema.orders.preparedAt) : asc(schema.orders.createdAt))
    .limit(opts.limit ?? 200)
    .all()

  if (rows.length === 0) return []

  const orderIds = rows.map(r => r.id)
  const lines = db.select()
    .from(schema.orderLines)
    .where(and(
      eq(schema.orderLines.venueId, venueId),
      inArray(schema.orderLines.orderId, orderIds),
    ))
    .all()

  // Aroma names, joined at read time from the ids stored on the line.
  const flavourNames = new Map<string, string>(
    db.select({ id: schema.stockItems.id, name: schema.stockItems.name })
      .from(schema.stockItems)
      .where(eq(schema.stockItems.venueId, venueId))
      .all()
      .map(r => [r.id, r.name]),
  )

  const preparedByName = new Map<string, string>(
    db.select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.venueId, venueId))
      .all()
      .map(r => [r.id, r.name]),
  )

  const linesByOrder = new Map<string, typeof lines>()
  for (const line of lines) {
    const list = linesByOrder.get(line.orderId) ?? []
    list.push(line)
    linesByOrder.set(line.orderId, list)
  }

  return rows.map(row => ({
    order_id: row.id,
    table_name: row.tableName,
    waiter_name: row.waiterName,
    created_at: row.createdAt,
    prepared_at: row.preparedAt,
    prepared_by_name: row.preparedBy ? preparedByName.get(row.preparedBy) ?? null : null,
    note: row.note,
    lines: (linesByOrder.get(row.id) ?? []).map(line => ({
      name_snapshot: line.nameSnapshot,
      qty: line.qty,
      flavours: parseFlavours(line.flavoursJson).map(id => flavourNames.get(id) ?? id),
      note: line.note,
    })),
  }))
}

function parseFlavours(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
