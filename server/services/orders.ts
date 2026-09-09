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
 *
 * Three rules run through everything here, and each one exists because the
 * alternative loses money:
 *
 *   - **the server owns the price.** The phone sends a product id and a
 *     quantity. Everything else is read from the catalogue inside the
 *     transaction.
 *   - **the server owns the person.** The actor comes from the session, never
 *     from the body. A phone that could send a `user_id` could spend anybody's
 *     night.
 *   - **a late round is accepted, recorded and flagged — never refused.**
 *     Refusing loses the sale entirely: the guest has already drunk the coffee.
 */
import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { badRequest, conflict, forbidden, notFound } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { clampEventAt, syncLagS } from '#shared/dates'
import type { Settings } from '#shared/settings'
import {
  bump, ensureOpenShift, getSettings, hasLiveSettlement, insertMovement, log,
  nextShiftSeq, unitCost, writeSummaryVersion,
} from './contracts'
import { maxSeq } from './changes'
import { emitChange } from '../utils/bus'
import { tabMoney } from './tabs'
import type {
  Actor, CreateOrderBody, CreateOrderResult, DiscardDraftBody, OrderLineInput,
} from '#shared/types'
import type { Db, Queryable, Tx } from './types'

type TabRow = typeof schema.tabs.$inferSelect

export function createOrder(
  db: Db, venueId: string, actor: Actor, body: CreateOrderBody,
): CreateOrderResult {
  const result = db.transaction((tx) => {
    /**
     * Idempotency, the property that lets a phone retry over bad Wi-Fi.
     *
     * The phone mints `client_id` once and re-sends the *same* request until it
     * gets an answer. If the first attempt actually landed and only the reply
     * was lost, this lookup finds the order and we answer with it instead of
     * charging the guest twice. The UNIQUE(venue_id, client_id) index is the
     * hard guarantee behind it; this SELECT is the graceful path, and it is the
     * first statement in the transaction so nothing can be written before it.
     */
    const existing = tx.select().from(schema.orders)
      .where(and(eq(schema.orders.venueId, venueId), eq(schema.orders.clientId, body.client_id)))
      .get()
    if (existing) {
      const tab = tx.select().from(schema.tabs).where(eq(schema.tabs.id, existing.tabId)).get()!
      return {
        order_id: existing.id,
        tab_id: existing.tabId,
        tab_client_id: tab.clientId,
        shift_id: existing.shiftId!,
        shift_seq: existing.shiftSeq!,
        order_total_fen: orderTotal(tx, venueId, existing.id),
        tab_total_fen: tabMoney(tx, venueId, existing.tabId).total_fen,
        late_sync: existing.lateSync === 1,
        post_settle: existing.postSettle === 1,
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

    const settings = getSettings(tx, venueId)
    const at = nowIso()
    const skewS = deviceSkew(tx, actor.deviceId)
    const clientAt = clampEventAt(body.client_created_at, at, settings.max_sync_lag_h, skewS)
    // The claim was older than the venue's tolerance and had to be pulled
    // forward — the round is late, and the row says so rather than pretending.
    const clampedUp = wasClampedUp(body.client_created_at, at, settings.max_sync_lag_h, skewS)

    // The first lock of the evening opens the night. `clientAt` only decides the
    // business date of a shift this call is itself creating: a round can never
    // open a shift on a past date, and it can never redirect itself into one.
    const { shift } = ensureOpenShift(tx, venueId, actor, at, clientAt)

    /**
     * Taking an order after you have already handed your envelope in.
     *
     * PLAN F10 refused this with a 409. Refusing loses the sale — the guest has
     * been served and no line would exist — so the round is accepted, stamped,
     * added to the settler's expected cash by `expectedCash`'s fifth term, and
     * flagged loudly enough that nobody has to guess where the surplus came
     * from (open decision 4).
     */
    const postSettle = hasLiveSettlement(tx, venueId, shift.id, actor.userId)
    const shiftSeq = nextShiftSeq(tx, venueId, shift.id)

    const resolved = resolveTab(tx, venueId, table.id, body, actor, at, clientAt, shift.id)

    const orderId = newId()
    tx.insert(schema.orders).values({
      id: orderId,
      venueId,
      tabId: resolved.tabId,
      clientId: body.client_id,
      shiftId: shift.id,
      shiftSeq,
      lockedBy: actor.userId,
      deviceId: actor.deviceId,
      note: body.note ?? null,
      clientCreatedAt: body.client_created_at ?? null,
      clientCreatedAtAdj: clientAt,
      syncLagS: syncLagS(clientAt, at),
      lateSync: (clampedUp || resolved.late || postSettle) ? 1 : 0,
      postSettle: postSettle ? 1 : 0,
      source: 'app',
      createdAt: at,
    }).run()

    const inserted = new Set<string>()
    let orderTotalFen = 0
    for (const line of body.lines) {
      orderTotalFen += insertLine(
        tx, venueId, actor, settings, orderId, line, shift.id, at, clientAt, inserted,
      )
    }

    // 7b — a round on a colleague's table is allowed and recorded, never silent.
    // Without the entry a waiter could pile his rounds onto somebody else's tab
    // and the money would land on the colleague's line with nothing anywhere
    // saying who actually served it.
    if (resolved.crossWaiter) {
      log(tx, venueId, {
        kind: 'cross_waiter_lock',
        body: {
          tab_id: resolved.tabId,
          order_id: orderId,
          table_id: table.id,
          assigned_to: resolved.assignedTo,
          locked_by: actor.userId,
        },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'tab', id: resolved.tabId },
        shiftId: shift.id,
        at,
      })
    }

    if (resolved.late) {
      // The card the owner reads: "2 ture stigle nakon zatvaranja · Amar · 38,00 KM".
      // `count` is how many late tabs this person already has on that shift, so
      // the sentence can say "2. tura" without a second query on the screen.
      log(tx, venueId, {
        kind: 'late_after_close',
        body: {
          tab_id: resolved.tabId,
          order_id: orderId,
          shift_id: resolved.tabShiftId,
          table_id: table.id,
          user_id: actor.userId,
          amount_fen: orderTotalFen,
          count: lateTabCount(tx, venueId, resolved.tabShiftId, actor.userId),
        },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'tab', id: resolved.tabId },
        shiftId: resolved.tabShiftId,
        at,
      })

      // The night it belongs to has already been written up: give it a new
      // version rather than letting the numbers quietly disagree with the rows.
      const tabShift = tx.select({ status: schema.shifts.status }).from(schema.shifts)
        .where(eq(schema.shifts.id, resolved.tabShiftId))
        .get()
      if (tabShift && (tabShift.status === 'closed' || tabShift.status === 'reviewed')) {
        writeSummaryVersion(tx, venueId, resolved.tabShiftId, 'late', at)
      }
    }

    if (postSettle) {
      log(tx, venueId, {
        kind: 'late_after_settle',
        body: {
          order_id: orderId,
          tab_id: resolved.tabId,
          table_id: table.id,
          user_id: actor.userId,
          shift_seq: shiftSeq,
          amount_fen: orderTotalFen,
        },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'order', id: orderId },
        shiftId: shift.id,
        at,
      })
    }

    // The sync hook (BACKEND §4.1). Three entities move when a round is locked:
    // the floor plan (the table now has a total), the bartender's queue and the
    // shelf. Inside the transaction, after the business rows — a lock that rolls
    // back must not tell a phone it happened.
    bump(tx, venueId, 'table', resolved.tabId)
    bump(tx, venueId, 'prep', orderId)
    bump(tx, venueId, 'stock')

    return {
      order_id: orderId,
      tab_id: resolved.tabId,
      tab_client_id: resolved.tabClientId,
      shift_id: shift.id,
      shift_seq: shiftSeq,
      order_total_fen: orderTotalFen,
      tab_total_fen: tabMoney(tx, venueId, resolved.tabId).total_fen,
      late_sync: clampedUp || resolved.late || postSettle,
      post_settle: postSettle,
      already_applied: false,
    }
  })

  // **After** `db.transaction()` returns, never inside it: until the transaction
  // comes back the rows are written but not committed, and a listener that went
  // looking for them could see nothing — or see rows a later throw rolls back.
  emitChange(venueId, { seq: maxSeq(db, venueId), entity: 'table', entityId: result.tab_id })

  return result
}

/**
 * `POST /api/drafts/discard` — *Odbaci*.
 *
 * The one route in the whole app that writes nothing but a log entry. A shift
 * cannot close while an unlocked cart sits on somebody's phone (F10 step 1), so
 * the waiter either locks it or taps *Odbaci* — and *Odbaci* has to leave a
 * trace, or the closing check is a check on nothing.
 *
 * All three fields describe a cart the server has never seen, `total_fen`
 * included. It is therefore **evidence, not money**: it is written into the log
 * body and summed into nothing, which is the only reason a phone is allowed to
 * send an amount at all (§2). There is no `bump` — no ledger row moved — and no
 * idempotency key: discarding the same phantom cart twice is two honest entries.
 */
export function discardDraft(
  db: Db, venueId: string, actor: Actor, body: DiscardDraftBody,
): { ok: true } {
  db.transaction((tx) => {
    const table = tx.select().from(schema.tables)
      .where(and(
        eq(schema.tables.id, body.table_id),
        eq(schema.tables.venueId, venueId),
        eq(schema.tables.active, 1),
      ))
      .get()
    if (!table) throw notFound('TABLE_NOT_FOUND', `table ${body.table_id} not found`)

    const shift = tx.select({ id: schema.shifts.id }).from(schema.shifts)
      .where(and(eq(schema.shifts.venueId, venueId), eq(schema.shifts.status, 'open')))
      .get()

    log(tx, venueId, {
      kind: 'draft_discarded',
      body: {
        table_id: table.id,
        user_id: actor.userId,
        lines: body.lines,
        total_fen: body.total_fen,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'table', id: table.id },
      shiftId: shift?.id ?? null,
    })
  })

  return { ok: true }
}

// ===========================================================================
// The tab a round lands on
// ===========================================================================

interface ResolvedTab {
  tabId: string
  tabClientId: string
  /** The shift the *tab* belongs to — the closed one, when the round is late. */
  tabShiftId: string
  /** The round arrived after its table had already been settled up. */
  late: boolean
  /** The tab existed and belongs to somebody else. */
  crossWaiter: boolean
  assignedTo: string
}

/**
 * Find the table's open tab, or open one — and notice when a round has arrived
 * too late for the tab it names.
 *
 * Two waiters can serve the same table; each phone carries its own
 * `tab_client_id`. The server owns the tab, so both resolve to one row: by the
 * phone's client id if it has been seen, otherwise by "the open tab on this
 * table", otherwise a new one. The phone adopts whatever id comes back.
 *
 * The late branch is the interesting one. A round queued at 21:50 that reaches
 * the server at 22:10, after a colleague has already closed and paid that
 * table, cannot join the paid tab — a paid tab never reopens, which is a rule a
 * trigger enforces and Korak 1 already proved. Throwing `TAB_CLOSED` would lose
 * the sale. So it opens a **new** tab, born `unpaid` with `pending_review`, and
 * says so loudly enough that somebody looks: the money is real, and it is
 * exactly the money that explains a surplus in somebody's envelope.
 */
function resolveTab(
  tx: Tx, venueId: string, tableId: string, body: CreateOrderBody, actor: Actor,
  at: string, clientAt: string, shiftId: string,
): ResolvedTab {
  const settings = getSettings(tx, venueId)

  let byClient: TabRow | undefined
  if (body.tab_client_id) {
    byClient = tx.select().from(schema.tabs)
      .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.clientId, body.tab_client_id)))
      .get()
    // Korak 1 silently charged the other table. Once tabs can be moved, a stale
    // phone would keep doing it and nothing would ever say which table was right.
    if (byClient && byClient.tableId !== tableId) {
      throw conflict('TAB_TABLE_MISMATCH', `tab ${byClient.id} is on another table`)
    }
  }

  // The last time somebody closed a tab on this table. A round claiming to have
  // happened before that moment belongs to a night that is already settled.
  const lastClosed = tx.select({ at: schema.tabs.closedAt, shiftId: schema.tabs.shiftId })
    .from(schema.tabs)
    .where(and(
      eq(schema.tabs.venueId, venueId),
      eq(schema.tabs.tableId, tableId),
      isNotNull(schema.tabs.closedAt),
    ))
    .orderBy(desc(schema.tabs.closedAt))
    .get()

  const closedByClient = byClient !== undefined && byClient.status !== 'open'
  const beforeLastClose = lastClosed?.at !== undefined && lastClosed.at !== null
    && clientAt < lastClosed.at

  if (closedByClient || beforeLastClose) {
    // The tab keeps the shift of the night it belongs to, so that night's
    // `unpaid_fen` and `expected_cash_fen` move with it; the *order* stays on
    // the shift that is open now (§6.1 step 4).
    const tabShiftId = (closedByClient ? byClient!.shiftId : lastClosed?.shiftId) ?? shiftId
    const id = newId()
    const clientId = newId()
    tx.insert(schema.tabs).values({
      id,
      venueId,
      tableId,
      clientId,
      status: 'unpaid',
      shiftId: tabShiftId,
      openedBy: actor.userId,
      openedAt: clientAt,
      assignedTo: actor.userId,
      offeredTo: null,
      lateSync: 1,
      pendingReview: 1,
      unpaidReason: 'late_sync',
      // Whose money it is until somebody decides. Without this the amount sits
      // on nobody's line and the surplus in his envelope has no explanation.
      unpaidBy: actor.userId,
      closedAt: at,
      closedBy: actor.userId,
    }).run()
    return {
      tabId: id, tabClientId: clientId, tabShiftId,
      late: true, crossWaiter: false, assignedTo: actor.userId,
    }
  }

  const existing = byClient ?? tx.select().from(schema.tabs)
    .where(and(
      eq(schema.tabs.venueId, venueId),
      eq(schema.tabs.tableId, tableId),
      eq(schema.tabs.status, 'open'),
    ))
    .get()

  if (existing) {
    const crossWaiter = existing.assignedTo !== actor.userId
    if (crossWaiter && actor.role === 'waiter' && !settings.allow_cross_waiter_rounds) {
      throw forbidden('NOT_ASSIGNED', `tab ${existing.id} is assigned to somebody else`)
    }
    return {
      tabId: existing.id,
      tabClientId: existing.clientId,
      tabShiftId: existing.shiftId ?? shiftId,
      late: false,
      crossWaiter,
      assignedTo: existing.assignedTo!,
    }
  }

  const id = newId()
  const clientId = body.tab_client_id ?? newId()
  tx.insert(schema.tabs).values({
    id,
    venueId,
    tableId,
    clientId,
    status: 'open',
    shiftId,
    openedBy: actor.userId,
    openedAt: at,
    // Whose tab it is. Nullable in the DDL only because a REFERENCES column
    // cannot be added NOT NULL; `tabs_assigned_required` refuses an insert
    // without it, which is why no reader anywhere needs a fallback.
    assignedTo: actor.userId,
    offeredTo: null,
    closedAt: null,
    closedBy: null,
  }).run()
  return {
    tabId: id, tabClientId: clientId, tabShiftId: shiftId,
    late: false, crossWaiter: false, assignedTo: actor.userId,
  }
}

/** How many late tabs this person already has on that shift, this one included. */
function lateTabCount(tx: Tx, venueId: string, shiftId: string, userId: string): number {
  return tx.select({ n: count() }).from(schema.tabs)
    .where(and(
      eq(schema.tabs.venueId, venueId),
      eq(schema.tabs.shiftId, shiftId),
      eq(schema.tabs.lateSync, 1),
      eq(schema.tabs.unpaidBy, userId),
    ))
    .get()?.n ?? 1
}

// ===========================================================================
// The lines
// ===========================================================================

/**
 * One tapped line: what is charged, and what leaves the shelf because of it.
 *
 * `name_snapshot` and `unit_price_fen` are read from the product **here, now**,
 * inside the transaction. The phone sent a product id and a quantity and
 * nothing else; a phone that could send a price could send any price.
 *
 * A *gratis* is the one case where the charge is not simply the price. Two of
 * them lock at zero on the spot, because a rule already authorises them: a
 * staff drink inside the per-shift cap, and the owner's own guest. Every other
 * draft comp **locks at full price** and writes a `pending` adjustment beside
 * it — so a comp the bartender rejects costs nothing to undo, and a comp
 * nobody ever decides is money the guest still owes rather than money the café
 * has quietly given away.
 */
function insertLine(
  tx: Tx,
  venueId: string,
  actor: Actor,
  settings: Settings,
  orderId: string,
  line: OrderLineInput,
  shiftId: string,
  at: string,
  clientAt: string,
  inserted: Set<string>,
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

  // *Dodatni žar* points at the bowl it tops up, and the bowl has to be on this
  // same round — the phone mints both ids in the same cart.
  if (line.parent_line_id && !inserted.has(line.parent_line_id)) {
    throw notFound('PARENT_LINE_NOT_FOUND', `line ${line.parent_line_id} is not on this order`)
  }

  const lineId = line.id
  const fullFen = product.priceFen * line.qty

  const freeNow = line.comp_reason !== undefined && (
    (line.comp_reason === 'staff_drink'
      && staffDrinkAllowed(tx, venueId, actor.userId, shiftId, product, fullFen, settings))
    || (line.comp_reason === 'owner_guest' && actor.role === 'admin')
  )
  const chargedFen = freeNow ? 0 : fullFen

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
    compReason: freeNow ? line.comp_reason! : null,
    authorisedBy: freeNow ? actor.userId : null,
    parentLineId: line.parent_line_id ?? null,
    note: line.note ?? null,
  }).run()
  inserted.add(lineId)

  if (line.comp_reason !== undefined && !freeNow) {
    /**
     * The derived key, not a minted one. The order body carries no `client_id`
     * for this row, and `line_adjustments_client_uq` needs one — so it is built
     * out of the line id, which is itself a phone-minted uuid unique in the
     * venue. A replayed order therefore produces the same key, and the replay
     * guard holds even if the outer check is ever bypassed.
     */
    tx.insert(schema.lineAdjustments).values({
      id: newId(),
      venueId,
      orderLineId: lineId,
      tabId: tx.select({ tabId: schema.orders.tabId }).from(schema.orders)
        .where(eq(schema.orders.id, orderId)).get()!.tabId,
      clientId: `${lineId}:comp`,
      kind: 'comp',
      reason: line.comp_reason,
      note: null,
      qty: line.qty,
      amountFen: fullFen,
      restock: 0,
      requestedBy: actor.userId,
      deviceId: actor.deviceId,
      secondsSinceLock: 0,
      wasPaid: 0,
      status: 'pending',
      auto: 0,
      refundKind: 'none',
      createdAt: at,
    }).run()
  }

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
      userId: actor.userId,
      shiftId,
      occurredAt: clientAt,
      createdAt: at,
    })
  }

  return chargedFen
}

/**
 * May this drink be free? Three questions, all of them the venue's settings:
 * is the product on the staff list, is it under the per-drink cap, and has this
 * person already had his two tonight.
 *
 * A drink that fails any of them is not refused — it locks at full price with a
 * pending comp beside it, and somebody decides.
 */
export function staffDrinkAllowed(
  tx: Tx, venueId: string, userId: string, shiftId: string,
  product: { staffDrinkAllowed: number }, amountFen: number, settings?: Settings,
): boolean {
  const s = settings ?? getSettings(tx, venueId)
  if (product.staffDrinkAllowed !== 1) return false
  if (amountFen > s.staff_drink_max_fen) return false

  const locked = tx.select({ n: count() })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .where(and(
      eq(schema.orderLines.venueId, venueId),
      eq(schema.orders.shiftId, shiftId),
      eq(schema.orders.lockedBy, userId),
      eq(schema.orderLines.compReason, 'staff_drink'),
    ))
    .get()?.n ?? 0

  const granted = tx.select({ n: count() })
    .from(schema.lineAdjustments)
    .innerJoin(schema.orderLines, eq(schema.orderLines.id, schema.lineAdjustments.orderLineId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .where(and(
      eq(schema.lineAdjustments.venueId, venueId),
      eq(schema.lineAdjustments.kind, 'comp'),
      eq(schema.lineAdjustments.reason, 'staff_drink'),
      eq(schema.lineAdjustments.status, 'applied'),
      eq(schema.lineAdjustments.requestedBy, userId),
      eq(schema.orders.shiftId, shiftId),
    ))
    .get()?.n ?? 0

  return locked + granted < s.staff_drinks_per_shift
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
 * *U minusu* list is what makes that visible, not a refusal at the till. A
 * comped line still takes its goods off the shelf: the bowl was smoked.
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

/** How far this phone's clock is from the server's, as the heartbeat measured it. */
function deviceSkew(tx: Tx, deviceId: string | null): number {
  if (!deviceId) return 0
  const row = tx.select({ skew: schema.devices.clockSkewS }).from(schema.devices)
    .where(eq(schema.devices.id, deviceId))
    .get()
  return row?.skew ?? 0
}

/** Did the clamp have to pull the claim forward? Then the round is `late_sync`. */
function wasClampedUp(
  claimed: string | undefined, now: string, maxLagH: number, skewS: number,
): boolean {
  if (!claimed) return false
  const claimedMs = Date.parse(claimed)
  if (!Number.isFinite(claimedMs)) return false
  return claimedMs - skewS * 1000 < Date.parse(now) - maxLagH * 3_600_000
}

export function orderTotal(db: Queryable, venueId: string, orderId: string): number {
  return db.select({ total: sql<number>`coalesce(sum(${schema.orderLines.chargedFen}), 0)` })
    .from(schema.orderLines)
    .where(and(eq(schema.orderLines.venueId, venueId), eq(schema.orderLines.orderId, orderId)))
    .get()?.total ?? 0
}
