/**
 * Stock: the ledger, and the two screens that read it.
 *
 * There is one rule and everything else follows from it — **on hand is
 * `SUM(qty_delta)`**. No table anywhere stores a current stock level. A stored
 * balance is a number that can be wrong while looking right; a sum over an
 * append-only ledger is either correct or visibly missing a row.
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { badRequest, notFound } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import type { CreateDeliveryBody, StockItem, StockLastMovement } from '#shared/types'
import type { Db, Queryable, Tx } from './types'
import { bump } from './contracts'

/** On hand per stock item, for one venue, in one query. */
export function onHandByItem(db: Queryable, venueId: string): Map<string, number> {
  const rows = db.select({
    stockItemId: schema.stockMovements.stockItemId,
    onHand: sql<number>`sum(${schema.stockMovements.qtyDelta})`,
  })
    .from(schema.stockMovements)
    .where(eq(schema.stockMovements.venueId, venueId))
    .groupBy(schema.stockMovements.stockItemId)
    .all()

  return new Map(rows.map(r => [r.stockItemId, r.onHand ?? 0]))
}

/** On hand for one item. Used by the tests and by the delivery response. */
export function onHand(db: Queryable, venueId: string, stockItemId: string): number {
  return db.select({ n: sql<number>`coalesce(sum(${schema.stockMovements.qtyDelta}), 0)` })
    .from(schema.stockMovements)
    .where(and(
      eq(schema.stockMovements.venueId, venueId),
      eq(schema.stockMovements.stockItemId, stockItemId),
    ))
    .get()?.n ?? 0
}

/**
 * The Bosnian one-liner under an item on *Stanje šanka*: what last moved it.
 * Names are joined here rather than stored on the movement — renaming a table
 * or an item must not rewrite history (PLAN.md §6).
 */
const MOVEMENT_LABEL: Record<string, string> = {
  opening: 'početno stanje',
  delivery: 'prijem robe',
  sale: 'narudžba',
  correction: 'korekcija',
}

function lastMovements(db: Queryable, venueId: string): Map<string, StockLastMovement> {
  // The newest movement per item. `occurred_at` is the business clock; `id`
  // breaks ties for two rows written in the same millisecond.
  const rows = db.select({
    id: schema.stockMovements.id,
    stockItemId: schema.stockMovements.stockItemId,
    type: schema.stockMovements.type,
    qtyDelta: schema.stockMovements.qtyDelta,
    occurredAt: schema.stockMovements.occurredAt,
    refType: schema.stockMovements.refType,
    refId: schema.stockMovements.refId,
  })
    .from(schema.stockMovements)
    .where(eq(schema.stockMovements.venueId, venueId))
    .orderBy(asc(schema.stockMovements.occurredAt), asc(schema.stockMovements.id))
    .all()

  // Which table a sale came from: order_line -> order -> tab -> table.
  const tableByLine = new Map<string, string>(
    db.select({
      lineId: schema.orderLines.id,
      tableName: schema.tables.name,
    })
      .from(schema.orderLines)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
      .innerJoin(schema.tabs, eq(schema.tabs.id, schema.orders.tabId))
      .innerJoin(schema.tables, eq(schema.tables.id, schema.tabs.tableId))
      .where(eq(schema.orderLines.venueId, venueId))
      .all()
      .map(r => [r.lineId, r.tableName]),
  )

  const out = new Map<string, StockLastMovement>()
  for (const row of rows) {
    const base = MOVEMENT_LABEL[row.type] ?? row.type
    const table = row.refType === 'order_line' && row.refId ? tableByLine.get(row.refId) : undefined
    out.set(row.stockItemId, {
      type: row.type,
      qty_delta: row.qtyDelta,
      occurred_at: row.occurredAt,
      ref_label: table ? `${table} · ${base}` : base,
    })
  }
  return out
}

/** `GET /api/stock` — *Stanje šanka*. */
export function getStock(db: Queryable, venueId: string): StockItem[] {
  const items = db.select()
    .from(schema.stockItems)
    .where(and(eq(schema.stockItems.venueId, venueId), eq(schema.stockItems.active, 1)))
    .orderBy(asc(schema.stockItems.kind), asc(schema.stockItems.name))
    .all()

  const onHandMap = onHandByItem(db, venueId)
  const lastMap = lastMovements(db, venueId)

  return items.map(item => ({
    id: item.id,
    name: item.name,
    kind: item.kind,
    base_unit: item.baseUnit,
    pack_name: item.packName,
    pack_qty: item.packQty,
    is_spot: item.isSpot === 1,
    on_hand: onHandMap.get(item.id) ?? 0,
    last_movement: lastMap.get(item.id) ?? null,
  }))
}

/**
 * `POST /api/stock/deliveries` — *prijem robe*.
 *
 * One transaction: either every line of the delivery note is recorded or none
 * is. Quantities arrive in base units (the screen converts "2 gajbe" into 48
 * before it posts) and must be positive — a negative delivery is a correction
 * and needs its own reason.
 */
export function createDelivery(db: Db, venueId: string, body: CreateDeliveryBody): StockItem[] {
  return db.transaction((tx) => {
    requireUser(tx, venueId, body.user_id)

    const at = nowIso()
    for (const line of body.lines) {
      const item = tx.select().from(schema.stockItems)
        .where(and(
          eq(schema.stockItems.id, line.stock_item_id),
          eq(schema.stockItems.venueId, venueId),
        ))
        .get()
      if (!item) throw notFound('STOCK_ITEM_NOT_FOUND', `stock item ${line.stock_item_id} not found`)
      if (line.qty <= 0) throw badRequest('INVALID_QTY', 'delivery qty must be > 0')

      tx.insert(schema.stockMovements).values({
        id: newId(),
        venueId,
        stockItemId: item.id,
        type: 'delivery',
        qtyDelta: line.qty,
        refType: 'delivery',
        refId: null,
        userId: body.user_id,
        note: line.note ?? null,
        occurredAt: at,
        createdAt: at,
      }).run()
    }

    // The sync hook (BACKEND §4.1): the shelf moved, so every *Roba* screen
    // and the aroma grid on the shisha sheet are stale until they re-poll.
    bump(tx, venueId, 'stock')

    return getStock(tx, venueId)
  })
}

function requireUser(tx: Tx, venueId: string, userId: string) {
  const user = tx.select({ id: schema.users.id }).from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.venueId, venueId)))
    .get()
  if (!user) throw notFound('USER_NOT_FOUND', `user ${userId} not found`)
}
