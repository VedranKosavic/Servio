/**
 * Stock: the ledger, and the screens that read it.
 *
 * There is one rule and everything else follows from it — **on hand is
 * `SUM(qty_delta)`**. No table anywhere stores a current stock level. A stored
 * balance is a number that can be wrong while looking right; a sum over an
 * append-only ledger is either correct or visibly missing a row.
 *
 * §6.8 puts five things in this file and `contracts.ts` re-exports them, so the
 * packages that write stock (a lock in WP3, a void's restock, a count) all go
 * through one writer: `unitCost`, `lastConfirmedCountAt`, `insertMovement`,
 * `onHand` and `theoreticalAt`. WP0 wrote the first four inside `contracts.ts`
 * itself, because this file did not exist in a shape that could hold them yet;
 * they have moved here unchanged, and `contracts.ts` now re-exports rather than
 * defines. No caller changed.
 *
 * **What a moving average is, in three lines.** Coca-Cola cost 0,90 KM a bottle
 * last month and 1,00 KM this month. If 20 bottles of the old price are still on
 * the shelf when 24 of the new arrive, the shelf is not worth 0,90 and not worth
 * 1,00 — it is worth the weighted mix, `(20 × 0,90 + 24 × 1,00) / 44`. That
 * number is `avg_cost_mfen`, it is recomputed on every delivery from the on-hand
 * *before* the delivery lands, and it is what every variance, *utrošak* and
 * waste value is priced at.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { badRequest, conflict, forbidden, notFound } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { clampEventAt, localDate, localTime } from '#shared/dates'
import type {
  BaseUnit, CorrectStockBody, CreateDeliveryBody, DeliveryView, LogWasteBody, OpeningStockBody,
  ReverseDeliveryBody, StockItem, StockItemStock, StockLastMovement, StockStatus, WasteView,
} from '#shared/types'
import type { Actor, Role } from '#shared/types'
import type { Db, Queryable, Tx } from './types'
import { bump, getSettings, log, verifyPinMetered } from './contracts'
import { listStockItems } from './admin'

type StockItemRow = typeof schema.stockItems.$inferSelect

// ===========================================================================
// The ledger primitives (§6.8)
// ===========================================================================

/**
 * What a quantity of this item is worth, in milli-feninga per base unit —
 * and whether that number is a guess.
 *
 * Fall back, flag, never silently zero. An item with a `last_cost_mfen` and no
 * moving average yet is priced at what it cost last time and labelled
 * *procijenjeno*, which is a far better answer on a screen than 0,00 KM. Only an
 * item with **neither** is genuinely unpriced, and a zero cost quietly switches
 * off variance, waste value and *utrošak* — so it is reported, never assumed.
 */
export function unitCost(item: { avgCostMfen: number, lastCostMfen: number }): {
  mfen: number
  estimated: boolean
} {
  const mfen = item.avgCostMfen || item.lastCostMfen || 0
  return { mfen, estimated: item.avgCostMfen === 0 }
}

/**
 * When this item was last counted and that count confirmed. `null` when it never
 * was — which is the normal case for most of the shelf.
 */
export function lastConfirmedCountAt(
  q: Queryable, venueId: string, stockItemId: string,
): string | null {
  const row = q.select({ at: schema.stockCounts.submittedAt })
    .from(schema.stockCountLines)
    .innerJoin(schema.stockCounts, eq(schema.stockCounts.id, schema.stockCountLines.countId))
    .where(and(
      eq(schema.stockCountLines.venueId, venueId),
      eq(schema.stockCountLines.stockItemId, stockItemId),
      eq(schema.stockCounts.status, 'confirmed'),
    ))
    .orderBy(desc(schema.stockCounts.submittedAt))
    .get()
  return row?.at ?? null
}

export interface MovementInput {
  stockItemId: string
  type: typeof schema.stockMovements.$inferInsert['type']
  qtyDelta: number
  unitCostMfen: number
  refType?: string | null
  refId?: string | null
  userId?: string | null
  shiftId?: string | null
  note?: string | null
  occurredAt: string
  createdAt?: string
}

/**
 * The one way a stock movement is written — and the one place the late-sync
 * offset lives.
 *
 * On hand is `SUM(qty_delta)`, always, with no bounds on the sum. So a movement
 * that arrives dated **before** a confirmed count is a problem: the bottle it
 * describes was already off the shelf when somebody counted the shelf, and the
 * count already accounts for it. Adding it now would subtract it twice.
 *
 * The fix is not to refuse the row — refusing a back-dated delivery only teaches
 * an honest bartender to lie about `delivered_at`. The fix is a mirror row that
 * cancels it (`late_sync`, the opposite quantity, the same cost and date), so the
 * ledger keeps both facts: what happened, and why it does not move today's stock.
 *
 * `late_sync` and `count_adjust` are exempt, or the offsets would offset each
 * other forever.
 */
export function insertMovement(tx: Tx, venueId: string, m: MovementInput): string {
  const createdAt = m.createdAt ?? nowIso()
  const id = newId()

  tx.insert(schema.stockMovements).values({
    id,
    venueId,
    stockItemId: m.stockItemId,
    type: m.type,
    qtyDelta: m.qtyDelta,
    unitCostMfen: m.unitCostMfen,
    refType: m.refType ?? null,
    refId: m.refId ?? null,
    userId: m.userId ?? null,
    shiftId: m.shiftId ?? null,
    note: m.note ?? null,
    occurredAt: m.occurredAt,
    createdAt,
  }).run()

  if (m.type !== 'late_sync' && m.type !== 'count_adjust') {
    const countedAt = lastConfirmedCountAt(tx, venueId, m.stockItemId)
    if (countedAt && m.occurredAt <= countedAt) {
      tx.insert(schema.stockMovements).values({
        id: newId(),
        venueId,
        stockItemId: m.stockItemId,
        type: 'late_sync',
        qtyDelta: -m.qtyDelta,
        unitCostMfen: m.unitCostMfen,
        refType: 'stock_movement',
        refId: id,
        userId: m.userId ?? null,
        shiftId: m.shiftId ?? null,
        note: `kasno sinhronizovano · popis ${localDate(countedAt)} ${localTime(countedAt)}`,
        occurredAt: m.occurredAt,
        createdAt,
      }).run()
    }
  }

  return id
}

/** On hand: the whole ledger for one item, summed. Never a stored balance. */
export function onHand(q: Queryable, venueId: string, stockItemId: string): number {
  const row = q.select({ sum: sql<number | null>`coalesce(sum(${schema.stockMovements.qtyDelta}), 0)` })
    .from(schema.stockMovements)
    .where(and(
      eq(schema.stockMovements.venueId, venueId),
      eq(schema.stockMovements.stockItemId, stockItemId),
    ))
    .get()
  return row?.sum ?? 0
}

/** On hand per stock item, for one venue, in one query. */
export function onHandByItem(q: Queryable, venueId: string): Map<string, number> {
  const rows = q.select({
    stockItemId: schema.stockMovements.stockItemId,
    onHand: sql<number>`sum(${schema.stockMovements.qtyDelta})`,
  })
    .from(schema.stockMovements)
    .where(eq(schema.stockMovements.venueId, venueId))
    .groupBy(schema.stockMovements.stockItemId)
    .all()

  return new Map(rows.map(r => [r.stockItemId, r.onHand ?? 0]))
}

/**
 * On hand **as of** a moment: the same sum, bounded by `occurred_at`.
 *
 * This is what a count compares its counted quantity against, and the bound is
 * `occurred_at` rather than `created_at` on purpose — a round that happened at
 * 23:40 and reached the server at 01:15 was on the shelf when the shelf was
 * counted at midnight, whatever the wall clock said when the row landed.
 */
export function theoreticalAt(
  q: Queryable, venueId: string, stockItemId: string, atIso: string,
): number {
  const row = q.select({ sum: sql<number | null>`coalesce(sum(${schema.stockMovements.qtyDelta}), 0)` })
    .from(schema.stockMovements)
    .where(and(
      eq(schema.stockMovements.venueId, venueId),
      eq(schema.stockMovements.stockItemId, stockItemId),
      lte(schema.stockMovements.occurredAt, atIso),
    ))
    .get()
  return row?.sum ?? 0
}

/** The colour of a row on *Stanje šanka* — worst first (§6.8). */
export function stockStatus(
  item: { avgCostMfen: number, lastCostMfen: number, parQty: number | null },
  hand: number,
): StockStatus {
  if (hand < 0) return 'u_minusu'
  if (unitCost(item).mfen === 0) return 'bez_cijene'
  if (item.parQty !== null && hand <= item.parQty) return 'nisko'
  return 'ok'
}

/** `round(qty × unit_cost_mfen / 1000)` — the one place mfen becomes fen. */
export function valueFen(qty: number, unitCostMfen: number): number {
  return Math.round((qty * unitCostMfen) / 1000)
}

// ===========================================================================
// `GET /api/stock` — *Stanje šanka*
// ===========================================================================

/**
 * The Bosnian one-liner under an item on *Stanje šanka*: what last moved it.
 * Names are joined here rather than stored on the movement — renaming a table
 * or an item must not rewrite history (PLAN.md §6).
 */
const MOVEMENT_LABEL: Record<string, string> = {
  opening: 'početno stanje',
  delivery: 'prijem robe',
  sale: 'narudžba',
  sale_storno: 'storno',
  late_sync: 'kasno sinhronizovano',
  waste: 'otpis',
  count_adjust: 'popis',
  correction: 'korekcija',
  return_supplier: 'povrat dobavljaču',
}

function tableByLine(q: Queryable, venueId: string): Map<string, string> {
  return new Map<string, string>(
    q.select({ lineId: schema.orderLines.id, tableName: schema.tables.name })
      .from(schema.orderLines)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
      .innerJoin(schema.tabs, eq(schema.tabs.id, schema.orders.tabId))
      .innerJoin(schema.tables, eq(schema.tables.id, schema.tabs.tableId))
      .where(eq(schema.orderLines.venueId, venueId))
      .all()
      .map(r => [r.lineId, r.tableName]),
  )
}

/** "Sto 7 · narudžba", "prijem robe" — one label, used by the list and the ledger. */
export function movementLabel(
  type: string, refType: string | null, refId: string | null, tables: Map<string, string>,
): string {
  const base = MOVEMENT_LABEL[type] ?? type
  const table = refType === 'order_line' && refId ? tables.get(refId) : undefined
  return table ? `${table} · ${base}` : base
}

function lastMovements(q: Queryable, venueId: string): Map<string, StockLastMovement> {
  // The newest movement per item. `occurred_at` is the business clock; `id`
  // breaks ties for two rows written in the same millisecond.
  const rows = q.select({
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

  const tables = tableByLine(q, venueId)
  const out = new Map<string, StockLastMovement>()
  for (const row of rows) {
    out.set(row.stockItemId, {
      type: row.type,
      qty_delta: row.qtyDelta,
      occurred_at: row.occurredAt,
      ref_label: movementLabel(row.type, row.refType, row.refId, tables),
    })
  }
  return out
}

/** `GET /api/stock` — *Stanje šanka*, and the `stock` snapshot in `/api/changes`. */
export function getStock(q: Queryable, venueId: string): StockItem[] {
  const items = q.select()
    .from(schema.stockItems)
    .where(and(eq(schema.stockItems.venueId, venueId), eq(schema.stockItems.active, 1)))
    .orderBy(asc(schema.stockItems.kind), asc(schema.stockItems.name))
    .all()

  const onHandMap = onHandByItem(q, venueId)
  const lastMap = lastMovements(q, venueId)

  return items.map((item) => {
    const hand = onHandMap.get(item.id) ?? 0
    const cost = unitCost(item)
    return {
      id: item.id,
      name: item.name,
      kind: item.kind,
      base_unit: item.baseUnit,
      pack_name: item.packName,
      pack_qty: item.packQty,
      is_spot: item.isSpot === 1,
      // How the shelf is measured, for *Brzi popis* (PHASE3 §1.3). Not money,
      // not a cost: a bartender who may count has to know what to count with.
      count_method: item.countMethod,
      tare_g: item.tareG,
      tolerance_qty: item.toleranceQty,
      on_hand: hand,
      status: stockStatus(item, hand),
      estimated: cost.estimated,
      unit_cost_mfen: cost.mfen,
      last_movement: lastMap.get(item.id) ?? null,
    }
  })
}

// ===========================================================================
// Opening stock — the *Početno stanje* screen (§6.8)
// ===========================================================================

/**
 * `POST /api/stock/opening` — the evening the owner reads out nineteen purchase
 * prices, once.
 *
 * Without it the live venue's rows keep `avg_cost_mfen = 0` forever and every
 * variance, waste value and *utrošak* prices at 0,00 KM — which reads like good
 * news and is not (§3.1, open decision 8).
 *
 * It is **once per item, ever**. An item that has been sold against has real
 * history, and the way to fix its cost then is a `PATCH` on the item plus a
 * `correction` — not a rewritten opening balance. Re-running it on an item that
 * only has `opening` rows is allowed and lands as a `correction` to the new
 * quantity, because the first read-out is exactly where a typo happens.
 */
export function setOpeningStock(
  db: Db, venueId: string, actor: Actor, body: OpeningStockBody, now = nowIso(),
): StockItemStock[] {
  db.transaction((tx) => {
    let totalValueFen = 0

    for (const line of body.lines) {
      const item = requireItem(tx, venueId, line.stock_item_id)

      // Anything but `opening` means the shelf has moved for real since.
      const foreign = tx.select({ n: sql<number>`count(*)` })
        .from(schema.stockMovements)
        .where(and(
          eq(schema.stockMovements.venueId, venueId),
          eq(schema.stockMovements.stockItemId, item.id),
          sql`${schema.stockMovements.type} <> 'opening'`,
        ))
        .get()?.n ?? 0
      if (foreign > 0) {
        throw conflict('OPENING_LOCKED', `stock item ${item.id} already has movements`)
      }

      const already = onHand(tx, venueId, item.id)
      if (already === 0) {
        insertMovement(tx, venueId, {
          stockItemId: item.id,
          type: 'opening',
          qtyDelta: line.qty,
          unitCostMfen: line.unit_cost_mfen,
          refType: 'venue_setup',
          refId: venueId,
          userId: actor.userId,
          note: body.note ?? null,
          occurredAt: now,
          createdAt: now,
        })
      } else if (already !== line.qty) {
        // A second read-out of the same shelf: correct the difference rather
        // than rewrite the first row, so the ledger keeps both numbers.
        insertMovement(tx, venueId, {
          stockItemId: item.id,
          type: 'correction',
          qtyDelta: line.qty - already,
          unitCostMfen: line.unit_cost_mfen,
          refType: 'venue_setup',
          refId: venueId,
          userId: actor.userId,
          note: 'ispravka početnog stanja',
          occurredAt: now,
          createdAt: now,
        })
      }

      tx.update(schema.stockItems)
        .set({ avgCostMfen: line.unit_cost_mfen, lastCostMfen: line.unit_cost_mfen })
        .where(and(eq(schema.stockItems.venueId, venueId), eq(schema.stockItems.id, item.id)))
        .run()

      totalValueFen += valueFen(line.qty, line.unit_cost_mfen)
    }

    log(tx, venueId, {
      kind: 'opening_set',
      body: { n_items: body.lines.length, total_value_fen: totalValueFen },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'venue', id: venueId },
      at: now,
    })

    bump(tx, venueId, 'stock')
  })

  return ownerStockItems(db, venueId)
}

/** The admin row plus what the ledger says about it (§6.8's `StockItemAdmin`+). */
export function ownerStockItems(q: Queryable, venueId: string): StockItemStock[] {
  const hands = onHandByItem(q, venueId)
  const costs = new Map(
    q.select({
      id: schema.stockItems.id,
      avgCostMfen: schema.stockItems.avgCostMfen,
      lastCostMfen: schema.stockItems.lastCostMfen,
      parQty: schema.stockItems.parQty,
    })
      .from(schema.stockItems)
      .where(eq(schema.stockItems.venueId, venueId))
      .all()
      .map(r => [r.id, r]),
  )

  return listStockItems(q, venueId).map((item) => {
    const hand = hands.get(item.id) ?? 0
    const row = costs.get(item.id)!
    return {
      ...item,
      on_hand: hand,
      status: stockStatus(row, hand),
      value_fen: valueFen(hand, unitCost(row).mfen),
    }
  })
}

// ===========================================================================
// Deliveries (§6.8)
// ===========================================================================

/**
 * `POST /api/stock/deliveries` — *prijem robe*, always posted.
 *
 * One transaction: either every line of the delivery note is recorded or none
 * is. The replay lookup is the first statement inside it (§2), because a phone
 * that retried a post must get the stored answer back and not book the crates
 * twice.
 */
export function createDelivery(
  db: Db, venueId: string, actor: Actor, body: CreateDeliveryBody, now = nowIso(),
): DeliveryView {
  const deliveryId = db.transaction((tx) => {
    const replay = tx.select({ id: schema.deliveries.id }).from(schema.deliveries)
      .where(and(
        eq(schema.deliveries.venueId, venueId),
        eq(schema.deliveries.clientId, body.client_id),
      ))
      .get()
    if (replay) return { id: replay.id, replayed: true }

    const settings = getSettings(tx, venueId)
    if (actor.role !== 'admin' && !settings.bartender_can_receive_goods) {
      throw forbidden('RECEIVING_FORBIDDEN', 'only an admin may post a delivery here')
    }

    const deliveredAt = clampEventAt(
      body.delivered_at ?? now, now, settings.max_sync_lag_h,
    )

    const id = newId()
    const lines = body.lines.map((line) => {
      const item = requireItem(tx, venueId, line.stock_item_id)
      const packQty = line.pack_qty_used ?? item.packQty
      if (line.packs > 0 && !packQty) {
        throw badRequest('INVALID_QTY', `stock item ${item.id} has no pack size`)
      }
      const qty = line.packs * (packQty ?? 0) + line.loose
      if (qty <= 0) throw badRequest('INVALID_QTY', 'a delivery line must be > 0')

      return {
        id: newId(),
        item,
        packs: line.packs,
        loose: line.loose,
        packQtyUsed: line.pack_qty_used ?? null,
        qty,
        lineCostFen: line.line_cost_fen,
        // Milli-feninga per base unit: 30 KM for 700 ml is 4 286 mfen/ml, and
        // rounding that to 4 fen/ml loses 2,20 KM on one bottle (§2).
        unitCostMfen: Math.round((line.line_cost_fen * 1000) / qty),
        note: line.note ?? null,
      }
    })

    tx.insert(schema.deliveries).values({
      id,
      venueId,
      clientId: body.client_id,
      supplierName: body.supplier_name,
      invoiceNo: body.invoice_no ?? null,
      deliveredAt,
      totalFen: lines.reduce((sum, l) => sum + l.lineCostFen, 0),
      status: 'posted',
      source: 'manual',
      note: body.note ?? null,
      enteredBy: actor.userId,
      postedBy: actor.userId,
      postedAt: now,
      createdAt: now,
    }).run()

    for (const line of lines) {
      tx.insert(schema.deliveryLines).values({
        id: line.id,
        venueId,
        deliveryId: id,
        stockItemId: line.item.id,
        packQtyUsed: line.packQtyUsed,
        packs: line.packs,
        loose: line.loose,
        qty: line.qty,
        lineCostFen: line.lineCostFen,
        unitCostMfen: line.unitCostMfen,
        note: line.note,
      }).run()

      // The moving average is computed on the on-hand **before** this row, so
      // it must be read before `insertMovement` writes it.
      const before = onHand(tx, venueId, line.item.id)

      insertMovement(tx, venueId, {
        stockItemId: line.item.id,
        type: 'delivery',
        qtyDelta: line.qty,
        unitCostMfen: line.unitCostMfen,
        refType: 'delivery_line',
        refId: line.id,
        userId: actor.userId,
        note: line.note,
        occurredAt: deliveredAt,
        createdAt: now,
      })

      const current = tx.select({
        avgCostMfen: schema.stockItems.avgCostMfen,
      }).from(schema.stockItems).where(eq(schema.stockItems.id, line.item.id)).get()!

      tx.update(schema.stockItems)
        .set({
          avgCostMfen: movingAverage(before, current.avgCostMfen, line.qty, line.unitCostMfen),
          lastCostMfen: line.unitCostMfen,
        })
        .where(and(
          eq(schema.stockItems.venueId, venueId),
          eq(schema.stockItems.id, line.item.id),
        ))
        .run()
    }

    log(tx, venueId, {
      kind: 'delivery_posted',
      body: {
        delivery_id: id,
        supplier: body.supplier_name,
        total_fen: lines.reduce((sum, l) => sum + l.lineCostFen, 0),
        lines: lines.length,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'delivery', id },
      at: now,
    })

    bump(tx, venueId, 'stock')
    return { id, replayed: false }
  })

  return { ...getDelivery(db, venueId, deliveryId.id), already_applied: deliveryId.replayed }
}

/**
 * `avg = onHand <= 0 ? cost : round((onHand × avg + qty × cost) / (onHand + qty))`
 *
 * The `onHand <= 0` branch is not a rounding guard, it is the honest answer: an
 * empty (or negative) shelf has no old stock to average against, so the new
 * invoice *is* the average.
 */
export function movingAverage(
  before: number, avgMfen: number, qty: number, costMfen: number,
): number {
  if (before <= 0) return costMfen
  return Math.round((before * avgMfen + qty * costMfen) / (before + qty))
}

/**
 * `POST /api/stock/deliveries/:id/reverse` — the invoice was wrong, or the crate
 * went back on the van.
 *
 * One `correction` per line at the line's own cost, and the header stamped. The
 * average is deliberately **not** recomputed: a reversal is not a purchase
 * price, and re-deriving the average from a mistake is how a wrong number
 * becomes two wrong numbers.
 */
export function reverseDelivery(
  db: Db, venueId: string, actor: Actor, deliveryId: string, body: ReverseDeliveryBody,
  now = nowIso(),
): DeliveryView {
  db.transaction((tx) => {
    const header = tx.select().from(schema.deliveries)
      .where(and(eq(schema.deliveries.venueId, venueId), eq(schema.deliveries.id, deliveryId)))
      .get()
    if (!header) throw notFound('DELIVERY_NOT_FOUND', `delivery ${deliveryId} not found`)
    if (header.reversedAt) {
      throw conflict('DELIVERY_ALREADY_REVERSED', `delivery ${deliveryId} is already reversed`)
    }

    const lines = tx.select().from(schema.deliveryLines)
      .where(and(
        eq(schema.deliveryLines.venueId, venueId),
        eq(schema.deliveryLines.deliveryId, deliveryId),
      ))
      .all()

    for (const line of lines) {
      insertMovement(tx, venueId, {
        stockItemId: line.stockItemId,
        type: 'correction',
        qtyDelta: -line.qty,
        unitCostMfen: line.unitCostMfen,
        refType: 'delivery_line',
        refId: line.id,
        userId: actor.userId,
        note: body.note,
        occurredAt: now,
        createdAt: now,
      })
    }

    tx.update(schema.deliveries)
      .set({ reversedAt: now, reversedBy: actor.userId, reversalNote: body.note })
      .where(and(eq(schema.deliveries.venueId, venueId), eq(schema.deliveries.id, deliveryId)))
      .run()

    log(tx, venueId, {
      kind: 'delivery_reversed',
      body: { delivery_id: deliveryId, note: body.note },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'delivery', id: deliveryId },
      at: now,
    })

    bump(tx, venueId, 'stock')
  })

  return getDelivery(db, venueId, deliveryId)
}

/** One delivery with its lines — the shape both write routes answer with. */
export function getDelivery(q: Queryable, venueId: string, deliveryId: string): DeliveryView {
  const header = q.select({ d: schema.deliveries, enteredByName: schema.users.name })
    .from(schema.deliveries)
    .leftJoin(schema.users, eq(schema.users.id, schema.deliveries.enteredBy))
    .where(and(eq(schema.deliveries.venueId, venueId), eq(schema.deliveries.id, deliveryId)))
    .get()
  if (!header) throw notFound('DELIVERY_NOT_FOUND', `delivery ${deliveryId} not found`)

  const lines = q.select({ l: schema.deliveryLines, itemName: schema.stockItems.name })
    .from(schema.deliveryLines)
    .innerJoin(schema.stockItems, eq(schema.stockItems.id, schema.deliveryLines.stockItemId))
    .where(and(
      eq(schema.deliveryLines.venueId, venueId),
      eq(schema.deliveryLines.deliveryId, deliveryId),
    ))
    .all()

  return {
    id: header.d.id,
    client_id: header.d.clientId,
    supplier_name: header.d.supplierName,
    invoice_no: header.d.invoiceNo,
    delivered_at: header.d.deliveredAt,
    total_fen: header.d.totalFen,
    status: header.d.status,
    reversed_at: header.d.reversedAt,
    reversal_note: header.d.reversalNote,
    entered_by: header.d.enteredBy,
    entered_by_name: header.enteredByName ?? '',
    note: header.d.note,
    lines: lines.map(({ l, itemName }) => ({
      stock_item_id: l.stockItemId,
      item_name: itemName,
      packs: l.packs,
      loose: l.loose,
      qty: l.qty,
      line_cost_fen: l.lineCostFen,
      unit_cost_mfen: l.unitCostMfen,
      note: l.note,
    })),
    already_applied: false,
  }
}

/** `GET /api/stock/deliveries?from&to` — newest first. */
export function listDeliveries(
  q: Queryable, venueId: string, range: { from?: string, to?: string } = {},
): DeliveryView[] {
  const ids = q.select({ id: schema.deliveries.id })
    .from(schema.deliveries)
    .where(and(
      eq(schema.deliveries.venueId, venueId),
      range.from ? gte(schema.deliveries.deliveredAt, range.from) : sql`1 = 1`,
      range.to ? lte(schema.deliveries.deliveredAt, range.to) : sql`1 = 1`,
    ))
    .orderBy(desc(schema.deliveries.deliveredAt), desc(schema.deliveries.id))
    .limit(200)
    .all()

  return ids.map(r => getDelivery(q, venueId, r.id))
}

/**
 * Replay every delivery and derive what the moving average *should* be.
 *
 * A cached number that nothing ever checks is a number that drifts. This walks
 * the whole movement ledger, tracks the running on-hand per item and applies
 * §6.8's formula at each `delivery` row — and a test asserts the cached
 * `avg_cost_mfen` agrees with it. It writes nothing.
 *
 * The walk is in **write order** (SQLite's `rowid`), not `occurred_at` order,
 * because that is the order the cache was built in: `createDelivery` reads the
 * on-hand as it stands when the crate is booked, whatever date the invoice
 * carries. Replaying by `occurred_at` would disagree with the cache on exactly
 * the back-dated delivery the `late_sync` rule exists for, and the disagreement
 * would be the replay's, not the cache's.
 */
export function recomputeAvgCost(q: Queryable, venueId: string): Map<string, number> {
  const rows = q.select({
    stockItemId: schema.stockMovements.stockItemId,
    type: schema.stockMovements.type,
    qtyDelta: schema.stockMovements.qtyDelta,
    unitCostMfen: schema.stockMovements.unitCostMfen,
  })
    .from(schema.stockMovements)
    .where(eq(schema.stockMovements.venueId, venueId))
    .orderBy(sql`rowid`)
    .all()

  const hand = new Map<string, number>()
  const avg = new Map<string, number>()

  for (const row of rows) {
    const before = hand.get(row.stockItemId) ?? 0
    if (row.type === 'opening') {
      avg.set(row.stockItemId, row.unitCostMfen)
    } else if (row.type === 'delivery') {
      avg.set(
        row.stockItemId,
        movingAverage(before, avg.get(row.stockItemId) ?? 0, row.qtyDelta, row.unitCostMfen),
      )
    }
    hand.set(row.stockItemId, before + row.qtyDelta)
  }

  return avg
}

// ===========================================================================
// Waste (§6.8)
// ===========================================================================

/** What a waiter may write on his own: the two things that are visibly accidents. */
const WAITER_REASONS = new Set(['razbijeno', 'prosuto'])

/**
 * Whose PIN the otpis sheet will accept.
 *
 * The twin of `requireApproverUser` in `services/adjustments.ts`, with one rule
 * deliberately missing: **there is no self-approval check.** A void is somebody
 * else's money and a waiter approving his own is the fraud the rule exists for;
 * a broken bottle is the bartender's own shelf, and `settings.approver_roles` is
 * exactly the list of people who answer for it. Emir typing his own PIN over a
 * 12 KM bottle he dropped is the case S13 was drawn for.
 *
 * The owner's PIN still only works on the owner's own phone: accepting six
 * digits on every handset in the café turns each of them into a place to guess.
 */
function requireWasteApprover(
  q: Queryable, venueId: string, actor: Actor, approverId: string,
): { id: string, role: Role } {
  const settings = getSettings(q, venueId)
  const user = q.select().from(schema.users)
    .where(and(
      eq(schema.users.id, approverId),
      eq(schema.users.venueId, venueId),
      eq(schema.users.active, 1),
    ))
    .get()
  if (!user) throw notFound('USER_NOT_FOUND', `user ${approverId} not found`)
  if (!settings.approver_roles.includes(user.role)) {
    throw forbidden('NOT_APPROVER', 'this role does not approve an otpis')
  }
  if (user.role === 'admin' && actor.deviceBoundUserId !== user.id) {
    throw forbidden('ADMIN_PIN_FOREIGN_DEVICE', 'the owner types his PIN on his own phone')
  }
  return { id: user.id, role: user.role }
}

/**
 * `POST /api/stock/waste` — *otpis*.
 *
 * The movement is written **immediately and always**. The bottle is broken
 * whether or not anyone approves it, and a refusal teaches staff not to log
 * breakage at all — which is the one outcome that costs the owner real money
 * (§14.10). Approval is acknowledgement, not gating: `needs_approval` puts the
 * row on the bartender's list and writes a non-quiet Dnevnik entry.
 *
 * **The approver's PIN, typed on the spot (PHASE3 §3, WP2).** The body has
 * carried `approver_user_id` + `pin` since Korak 2 and the route has been on
 * `PIN_BEARING_ROUTES` all along; nothing read them, so S13's PIN sheet would
 * have been a keypad that changed nothing. When they arrive and check out, the
 * row is born acknowledged — a bartender standing beside the waiter with the
 * broken bottle in his hand is the whole point of the sheet.
 */
export function logWaste(
  db: Db, venueId: string, actor: Actor, body: LogWasteBody, now = nowIso(),
): WasteView {
  /**
   * Checked **before** the transaction opens, on `db` and not on `tx` — the same
   * rule `requestAdjustment` follows: `verifyPinMetered` writes an
   * `auth_attempts` row whether the PIN was right or wrong, and a row written
   * inside a transaction that later throws is rolled back with it, leaving a
   * lockout counter that never counts the attempts that matter.
   */
  const approver = body.approver_user_id && body.pin
    ? requireWasteApprover(db, venueId, actor, body.approver_user_id)
    : null
  if (approver && body.pin) {
    verifyPinMetered(db, venueId, approver.id, actor.deviceId, body.pin, {
      ip: '', kind: 'approve',
    })
  }

  const wasteId = db.transaction((tx) => {
    const replay = tx.select({ id: schema.wasteEvents.id }).from(schema.wasteEvents)
      .where(and(
        eq(schema.wasteEvents.venueId, venueId),
        eq(schema.wasteEvents.clientId, body.client_id),
      ))
      .get()
    if (replay) return { id: replay.id, replayed: true }

    const settings = getSettings(tx, venueId)
    const isApprover = settings.approver_roles.includes(actor.role)

    if (!isApprover && !WAITER_REASONS.has(body.reason)) {
      throw forbidden('REASON_FORBIDDEN', `reason ${body.reason} needs a bartender`)
    }

    const item = requireItem(tx, venueId, body.stock_item_id)
    const cost = unitCost(item)
    const costFen = valueFen(body.qty, cost.mfen)

    const skewS = actor.deviceId
      ? tx.select({ skew: schema.devices.clockSkewS }).from(schema.devices)
        .where(eq(schema.devices.id, actor.deviceId)).get()?.skew ?? 0
      : 0
    const occurredAt = clampEventAt(
      body.client_created_at, now, settings.max_sync_lag_h, skewS,
    )

    const shift = tx.select({ id: schema.shifts.id }).from(schema.shifts)
      .where(and(
        eq(schema.shifts.venueId, venueId),
        inArray(schema.shifts.status, ['open', 'closing']),
      ))
      .get()

    // How many this person has already logged this shift — the cap is per
    // person per shift, so it resets with the night and never accumulates.
    const already = shift
      ? tx.select({ n: sql<number>`count(*)` }).from(schema.wasteEvents)
        .where(and(
          eq(schema.wasteEvents.venueId, venueId),
          eq(schema.wasteEvents.shiftId, shift.id),
          eq(schema.wasteEvents.userId, actor.userId),
        ))
        .get()?.n ?? 0
      : 0

    const overCap = already >= settings.waste_events_per_shift_per_user
    const overThreshold = costFen >= settings.waste_pin_threshold_fen
    // A `kom` drink is a bottle off the shelf, which is the one waste a person
    // could quietly turn into a free round for a friend.
    const bottleByWaiter = !isApprover && item.kind === 'pice' && item.baseUnit === 'kom'
    // A PIN that checked out *is* the approval, so the row is not waiting for
    // one. `approved_by` still says who gave it, and the entry still says the
    // otpis was big enough to need one.
    const needsApproval = (overThreshold || bottleByWaiter || overCap) && !approver

    const id = newId()
    tx.insert(schema.wasteEvents).values({
      id,
      venueId,
      stockItemId: item.id,
      clientId: body.client_id,
      qty: body.qty,
      reason: body.reason,
      note: body.note ?? null,
      costFen,
      shiftId: shift?.id ?? null,
      userId: actor.userId,
      needsApproval: needsApproval ? 1 : 0,
      approvedBy: approver?.id ?? null,
      approvedAt: approver ? now : null,
      createdAt: now,
    }).run()

    insertMovement(tx, venueId, {
      stockItemId: item.id,
      type: 'waste',
      qtyDelta: -body.qty,
      unitCostMfen: cost.mfen,
      refType: 'waste_event',
      refId: id,
      userId: actor.userId,
      shiftId: shift?.id ?? null,
      note: body.note ?? body.reason,
      occurredAt,
      createdAt: now,
    })

    log(tx, venueId, {
      kind: 'waste_logged',
      body: {
        waste_id: id,
        stock_item_id: item.id,
        user_id: actor.userId,
        qty: body.qty,
        cost_fen: costFen,
        reason: body.reason,
        needs_approval: needsApproval,
        ...(approver ? { approved_by: approver.id } : {}),
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'waste_event', id },
      shiftId: shift?.id ?? null,
      at: now,
    })

    if (overCap) {
      log(tx, venueId, {
        kind: 'waste_capped',
        body: { waste_id: id, user_id: actor.userId, count: already + 1 },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'waste_event', id },
        shiftId: shift?.id ?? null,
        at: now,
      })
    }

    bump(tx, venueId, 'stock')
    return { id, replayed: false }
  })

  return { ...getWaste(db, venueId, wasteId.id), already_applied: wasteId.replayed }
}

/** `POST /api/stock/waste/:id/approve` — acknowledged, once. */
export function approveWaste(
  db: Db, venueId: string, actor: Actor, wasteId: string, now = nowIso(),
): WasteView {
  db.transaction((tx) => {
    const row = tx.select().from(schema.wasteEvents)
      .where(and(eq(schema.wasteEvents.venueId, venueId), eq(schema.wasteEvents.id, wasteId)))
      .get()
    if (!row) throw notFound('WASTE_NOT_FOUND', `waste event ${wasteId} not found`)
    if (row.approvedBy) {
      throw conflict('WASTE_ALREADY_APPROVED', `waste event ${wasteId} is already approved`)
    }

    tx.update(schema.wasteEvents)
      .set({ approvedBy: actor.userId, approvedAt: now })
      .where(and(eq(schema.wasteEvents.venueId, venueId), eq(schema.wasteEvents.id, wasteId)))
      .run()

    bump(tx, venueId, 'stock')
  })

  return getWaste(db, venueId, wasteId)
}

export function getWaste(q: Queryable, venueId: string, wasteId: string): WasteView {
  const row = q.select({
    w: schema.wasteEvents,
    item: schema.stockItems,
    approvedByName: schema.users.name,
  })
    .from(schema.wasteEvents)
    .innerJoin(schema.stockItems, eq(schema.stockItems.id, schema.wasteEvents.stockItemId))
    .leftJoin(schema.users, eq(schema.users.id, schema.wasteEvents.approvedBy))
    .where(and(eq(schema.wasteEvents.venueId, venueId), eq(schema.wasteEvents.id, wasteId)))
    .get()
  if (!row) throw notFound('WASTE_NOT_FOUND', `waste event ${wasteId} not found`)

  return {
    id: row.w.id,
    stock_item_id: row.w.stockItemId,
    item_name: row.item.name,
    qty: row.w.qty,
    reason: row.w.reason,
    note: row.w.note,
    cost_fen: row.w.costFen,
    estimated: unitCost(row.item).estimated,
    needs_approval: row.w.needsApproval === 1,
    approved_by: row.w.approvedBy,
    approved_by_name: row.approvedByName ?? null,
    created_at: row.w.createdAt,
    on_hand: onHand(q, venueId, row.w.stockItemId),
    already_applied: false,
  }
}

// ===========================================================================
// Corrections (§6.8)
// ===========================================================================

/**
 * `POST /api/stock/corrections` — the admin's fix, and how goods go back to a
 * supplier.
 *
 * `occurred_at` gets the same clamp as every other body-supplied timestamp, so a
 * mistyped year cannot back-date a correction past a confirmed count and rewrite
 * its theoretical stock. A *legitimately* back-dated one still gets its
 * `late_sync` offset from `insertMovement`, which is the whole point of putting
 * that rule in one place.
 */
export function correctStock(
  db: Db, venueId: string, actor: Actor, body: CorrectStockBody, now = nowIso(),
): StockItem {
  db.transaction((tx) => {
    const item = requireItem(tx, venueId, body.stock_item_id)
    if (body.type === 'return_supplier' && body.qty_delta >= 0) {
      throw badRequest('INVALID_QTY', 'a return to the supplier leaves the shelf')
    }

    const settings = getSettings(tx, venueId)
    const occurredAt = clampEventAt(body.occurred_at, now, settings.max_sync_lag_h)
    const cost = unitCost(item)

    const movementId = insertMovement(tx, venueId, {
      stockItemId: item.id,
      type: body.type,
      qtyDelta: body.qty_delta,
      unitCostMfen: cost.mfen,
      refType: 'correction',
      refId: item.id,
      userId: actor.userId,
      note: body.note,
      occurredAt,
      createdAt: now,
    })

    log(tx, venueId, {
      kind: 'stock_corrected',
      body: {
        movement_id: movementId,
        stock_item_id: item.id,
        qty_delta: body.qty_delta,
        note: body.note,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'stock_item', id: item.id },
      at: now,
    })

    bump(tx, venueId, 'stock')
  })

  const item = getStock(db, venueId).find(i => i.id === body.stock_item_id)
  if (item) return item
  // An inactive item is still correctable; `getStock` only lists the active ones.
  const row = requireItem(db, venueId, body.stock_item_id)
  const hand = onHand(db, venueId, row.id)
  const cost = unitCost(row)
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    base_unit: row.baseUnit as BaseUnit,
    pack_name: row.packName,
    pack_qty: row.packQty,
    is_spot: row.isSpot === 1,
    count_method: row.countMethod,
    tare_g: row.tareG,
    tolerance_qty: row.toleranceQty,
    on_hand: hand,
    status: stockStatus(row, hand),
    estimated: cost.estimated,
    unit_cost_mfen: cost.mfen,
    last_movement: null,
  }
}

// ===========================================================================

export function requireItem(q: Queryable, venueId: string, stockItemId: string): StockItemRow {
  const item = q.select().from(schema.stockItems)
    .where(and(eq(schema.stockItems.venueId, venueId), eq(schema.stockItems.id, stockItemId)))
    .get()
  if (!item) throw notFound('STOCK_ITEM_NOT_FOUND', `stock item ${stockItemId} not found`)
  return item
}
