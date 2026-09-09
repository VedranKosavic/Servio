/**
 * Locking a round — the one flow this whole app is built around.
 *
 * A "transaction" is a group of writes SQLite treats as a single all-or-nothing
 * step: if anything inside throws, every write in the group is undone as if it
 * never happened. That matters here because one tap by a waiter becomes a tab,
 * an order, its lines and one stock movement per ingredient. A crash halfway
 * through must not leave an order with no lines, or a charge with no stock
 * deduction — so all of it happens inside `db.transaction(...)`.
 *
 * better-sqlite3 is synchronous, so the body below is plain top-to-bottom code
 * with no `await` in it. That is deliberate: nothing else can interleave.
 */
import { and, eq, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { badRequest, notFound } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { bump, ensureOpenShift, insertMovement, nextShiftSeq, unitCost } from './contracts'
import { maxSeq } from './changes'
import { emitChange } from '../utils/bus'
import type { Actor, CreateOrderBody, CreateOrderResult, OrderLineInput } from '#shared/types'
import type { Db, Queryable, Tx } from './types'

export function createOrder(db: Db, venueId: string, body: CreateOrderBody): CreateOrderResult {
  const result = db.transaction((tx) => {
    /**
     * Idempotency, the property that lets a phone retry over bad Wi-Fi.
     *
     * The phone mints `client_id` once and re-sends the *same* request until it
     * gets an answer. If the first attempt actually landed and only the reply
     * was lost, this lookup finds the order and we answer with it instead of
     * charging the guest twice. The UNIQUE(venue_id, client_id) index is the
     * hard guarantee behind it; this SELECT is the graceful path.
     */
    const existing = tx.select().from(schema.orders)
      .where(and(eq(schema.orders.venueId, venueId), eq(schema.orders.clientId, body.client_id)))
      .get()
    if (existing) {
      return {
        order_id: existing.id,
        tab_id: existing.tabId,
        order_total_fen: orderTotal(tx, venueId, existing.id),
        tab_total_fen: tabTotal(tx, venueId, existing.tabId),
        already_applied: true,
      }
    }

    const table = tx.select().from(schema.tables)
      .where(and(
        eq(schema.tables.id, body.table_id),
        eq(schema.tables.venueId, venueId),
        eq(schema.tables.active, 1),
      ))
      .get()
    if (!table) throw notFound('TABLE_NOT_FOUND', `table ${body.table_id} not found`)

    const user = tx.select().from(schema.users)
      .where(and(
        eq(schema.users.id, body.user_id),
        eq(schema.users.venueId, venueId),
        eq(schema.users.active, 1),
      ))
      .get()
    // No auth in this slice: the phone tells us who it is and we believe it.
    // Real login (device token + PIN) is a later step, PLAN.md §5 "Auth".
    if (!user) throw notFound('USER_NOT_FOUND', `user ${body.user_id} not found`)

    const at = nowIso()

    /**
     * The first lock of the evening opens the night. Korak 2 made `shift_id`
     * and `shift_seq` mandatory on `orders` through the `orders_shift_required`
     * trigger — a column that REFERENCES another table cannot be declared NOT
     * NULL by an ALTER, so the trigger is what makes it mandatory — and these
     * three lines are what satisfy it. WP3 rewrites this whole service and
     * takes a real `Actor` from the session; until then the actor is built from
     * the user the body named, which is exactly what Korak 1 already trusted.
     */
    const actor: Actor = {
      venueId,
      userId: user.id,
      role: user.role,
      sessionId: '',
      sessionKind: 'staff',
      deviceId: null,
      deviceBoundUserId: null,
      borrowed: false,
    }
    const { shift } = ensureOpenShift(tx, venueId, actor, at)
    const shiftSeq = nextShiftSeq(tx, venueId, shift.id)

    const tabId = resolveTab(tx, venueId, table.id, body, at, shift.id)

    const orderId = newId()
    tx.insert(schema.orders).values({
      id: orderId,
      venueId,
      tabId,
      clientId: body.client_id,
      shiftId: shift.id,
      shiftSeq,
      lockedBy: user.id,
      note: body.note ?? null,
      createdAt: at,
      preparedAt: null,
      preparedBy: null,
    }).run()

    let orderTotalFen = 0
    for (const line of body.lines) {
      orderTotalFen += insertLine(tx, venueId, orderId, line, user.id, at, shift.id)
    }

    // The sync hook (BACKEND §4.1). Three entities move when a round is locked:
    // the floor plan (the table now has a total), the bartender's queue and the
    // shelf. Inside the transaction, after the business rows — a lock that rolls
    // back must not tell a phone it happened. WP3 keeps these when it rewrites
    // this service; `changes-coverage.test.ts` is what stops them being dropped.
    bump(tx, venueId, 'table', tabId)
    bump(tx, venueId, 'prep', orderId)
    bump(tx, venueId, 'stock')

    return {
      order_id: orderId,
      tab_id: tabId,
      order_total_fen: orderTotalFen,
      tab_total_fen: tabTotal(tx, venueId, tabId),
      already_applied: false,
    }
  })

  // **After** `db.transaction()` returns, never inside it: until the transaction
  // comes back the rows are written but not committed, and a listener that went
  // looking for them could see nothing — or see rows a later throw rolls back.
  // This is the hook point every mutating service uses (BACKEND §4.1); in Korak 2
  // the only listener is the alert drainer, and a Phase 5 SSE endpoint plugs in
  // here without touching a line of business logic.
  emitChange(venueId, { seq: maxSeq(db, venueId), entity: 'table', entityId: result.tab_id })

  return result
}

/**
 * Find the table's open tab, or open one.
 *
 * Two waiters can serve the same table; each phone carries its own
 * `tab_client_id`. The server owns the tab, so both resolve to one row: by the
 * phone's client id if it has been seen, otherwise by "the open tab on this
 * table", otherwise a new one. The phone adopts whatever id comes back.
 */
function resolveTab(
  tx: Tx, venueId: string, tableId: string, body: CreateOrderBody, at: string, shiftId: string,
): string {
  if (body.tab_client_id) {
    const byClient = tx.select().from(schema.tabs)
      .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.clientId, body.tab_client_id)))
      .get()
    if (byClient) {
      if (byClient.status !== 'open') {
        throw badRequest('TAB_CLOSED', `tab ${byClient.id} is already ${byClient.status}`)
      }
      return byClient.id
    }
  }

  const open = tx.select().from(schema.tabs)
    .where(and(
      eq(schema.tabs.venueId, venueId),
      eq(schema.tabs.tableId, tableId),
      eq(schema.tabs.status, 'open'),
    ))
    .get()
  if (open) return open.id

  const id = newId()
  tx.insert(schema.tabs).values({
    id,
    venueId,
    tableId,
    clientId: body.tab_client_id ?? newId(),
    status: 'open',
    shiftId,
    openedBy: body.user_id,
    openedAt: at,
    // Whose tab it is. Nullable in the DDL only because a REFERENCES column
    // cannot be added NOT NULL; `tabs_assigned_required` refuses an insert
    // without it, which is why no reader anywhere needs a fallback.
    assignedTo: body.user_id,
    offeredTo: null,
    closedAt: null,
    closedBy: null,
  }).run()
  return id
}

/**
 * One tapped line: what is charged, and what leaves the shelf because of it.
 *
 * `name_snapshot` and `unit_price_fen` are read from the product **here, now**,
 * inside the transaction. The phone sent a product id and a quantity and
 * nothing else; a phone that could send a price could send any price.
 */
function insertLine(
  tx: Tx,
  venueId: string,
  orderId: string,
  line: OrderLineInput,
  userId: string,
  at: string,
  shiftId: string,
): number {
  const product = tx.select().from(schema.products)
    .where(and(
      eq(schema.products.id, line.product_id),
      eq(schema.products.venueId, venueId),
      eq(schema.products.active, 1),
    ))
    .get()
  if (!product) throw notFound('PRODUCT_NOT_FOUND', `product ${line.product_id} not found`)

  const flavourIds = line.flavour_ids ?? []
  if (product.kind === 'shisha') {
    if (flavourIds.length < 1) throw badRequest('FLAVOURS_REQUIRED', `${product.name} needs 1–3 aromas`)
  } else if (flavourIds.length > 0) {
    throw badRequest('FLAVOURS_NOT_ALLOWED', `${product.name} is not a shisha product`)
  }

  const flavours = flavourIds.map((id) => {
    const item = tx.select().from(schema.stockItems)
      .where(and(
        eq(schema.stockItems.id, id),
        eq(schema.stockItems.venueId, venueId),
        eq(schema.stockItems.kind, 'duhan'),
      ))
      .get()
    if (!item) throw notFound('FLAVOUR_NOT_FOUND', `flavour ${id} is not a tobacco stock item`)
    return item
  })

  const lineId = newId()
  const chargedFen = product.priceFen * line.qty

  tx.insert(schema.orderLines).values({
    id: lineId,
    venueId,
    orderId,
    productId: product.id,
    nameSnapshot: product.name,
    qty: line.qty,
    unitPriceFen: product.priceFen,
    chargedFen,
    // ids, never names: an aroma renamed next month must not rewrite tonight.
    flavoursJson: flavours.length > 0 ? JSON.stringify(flavours.map(f => f.id)) : null,
    note: line.note ?? null,
  }).run()

  // Every movement goes through `insertMovement`, which is also where the
  // late-sync offset lives — one rule, one place, so `SUM(qty_delta)` stays true.
  for (const m of resolveStock(tx, venueId, product, line.qty, flavours.map(f => f.id))) {
    insertMovement(tx, venueId, {
      stockItemId: m.stockItemId,
      type: 'sale',
      qtyDelta: m.qtyDelta,
      // What that quantity was worth when it moved, so COGS never has to guess
      // at yesterday's price.
      unitCostMfen: m.unitCostMfen,
      refType: 'order_line',
      refId: lineId,
      userId,
      shiftId,
      occurredAt: at,
      createdAt: at,
    })
  }

  return chargedFen
}

interface PendingMovement { stockItemId: string, qtyDelta: number, unitCostMfen: number }

/**
 * What one line takes off the shelf. Three ways, and a product may use more
 * than one of them:
 *
 *   1:1        `sells_stock_item_id` — a bottle of Coca-Cola is a bottle.
 *   normativ   `recipe_lines` — a kafa is 7 g kafa + 5 g šećera.
 *   nargila    `kind='shisha'` — `shisha_grams` split evenly across the chosen
 *              aromas, plus `coal_pcs` off the coal item.
 *
 * Deltas are negative: a sale removes stock. Stock is allowed to go negative —
 * a sale is never blocked because the ledger disagrees with the shelf. The
 * *U minusu* list is what makes that visible, not a refusal at the till.
 */
function resolveStock(
  tx: Tx,
  venueId: string,
  product: typeof schema.products.$inferSelect,
  qty: number,
  flavourIds: string[],
): PendingMovement[] {
  const out: PendingMovement[] = []
  const push = (stockItemId: string, qtyDelta: number) => {
    out.push({ stockItemId, qtyDelta, unitCostMfen: costOf(tx, venueId, stockItemId) })
  }

  if (product.sellsStockItemId) {
    push(product.sellsStockItemId, -qty)
  }

  const recipe = tx.select().from(schema.recipeLines)
    .where(and(
      eq(schema.recipeLines.venueId, venueId),
      eq(schema.recipeLines.productId, product.id),
    ))
    .all()
  for (const r of recipe) {
    push(r.stockItemId, -(r.qty * qty))
  }

  if (product.kind === 'shisha') {
    const grams = (product.shishaGrams ?? 0) * qty
    if (grams > 0 && flavourIds.length > 0) {
      // A mixed bowl splits the venue norm across its aromas: 20 g over two
      // aromas is 10 g + 10 g (PLAN.md §9, the owner's monthly formula).
      const perFlavour = grams / flavourIds.length
      for (const id of flavourIds) push(id, -perFlavour)
    }

    const coal = (product.coalPcs ?? 0) * qty
    if (coal > 0) {
      const coalItem = coalStockItem(tx, venueId)
      if (coalItem) push(coalItem.id, -coal)
    }
  }

  return out
}

/**
 * What one base unit of this item costs, in milli-feninga — the moving average
 * when there is one, the last invoice price when there is not, and 0 only for an
 * item nobody has ever priced (`unitCost`, BACKEND §6.8).
 */
function costOf(tx: Tx, venueId: string, stockItemId: string): number {
  const item = tx.select({
    avgCostMfen: schema.stockItems.avgCostMfen,
    lastCostMfen: schema.stockItems.lastCostMfen,
  })
    .from(schema.stockItems)
    .where(and(eq(schema.stockItems.id, stockItemId), eq(schema.stockItems.venueId, venueId)))
    .get()
  return item ? unitCost(item).mfen : 0
}

/**
 * The venue's coal. One `kind='zar'` item per venue in v1; a venue that ever
 * stocks two kinds of coal gets a `coal_stock_item_id` on `venues` instead of
 * this lookup.
 */
function coalStockItem(tx: Tx, venueId: string) {
  return tx.select().from(schema.stockItems)
    .where(and(
      eq(schema.stockItems.venueId, venueId),
      eq(schema.stockItems.kind, 'zar'),
      eq(schema.stockItems.active, 1),
    ))
    .get()
}

export function orderTotal(db: Queryable, venueId: string, orderId: string): number {
  return db.select({ total: sql<number>`coalesce(sum(${schema.orderLines.chargedFen}), 0)` })
    .from(schema.orderLines)
    .where(and(eq(schema.orderLines.venueId, venueId), eq(schema.orderLines.orderId, orderId)))
    .get()?.total ?? 0
}

/** What the guests at this table owe: every line of every round on the tab. */
export function tabTotal(db: Queryable, venueId: string, tabId: string): number {
  return db.select({ total: sql<number>`coalesce(sum(${schema.orderLines.chargedFen}), 0)` })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .where(and(eq(schema.orders.venueId, venueId), eq(schema.orders.tabId, tabId)))
    .get()?.total ?? 0
}
