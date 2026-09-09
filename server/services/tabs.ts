/**
 * The tab: the floor plan, what a table owes, and the four things that can
 * happen to a tab which are not a payment — *nije plaćeno* and its decision,
 * a move to another table, and handing the table to a colleague.
 *
 * Money on a tab is **never stored**. `tabMoney` recomputes it from three
 * ledgers on every read, which is why a void decided at 02:00 on a tab paid at
 * 23:00 needs no correcting write anywhere: the number simply comes out
 * different the next time somebody asks.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { badRequest, conflict, forbidden, notFound } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { clampEventAt } from '#shared/dates'
import type {
  MarkUnpaidBody, DecideUnpaidBody, MoveTabBody, AssignTabBody,
  Tab, TabDetail, TabLine, TabMoney, TableState, TablesStateResponse, UnpaidResult,
} from '#shared/types'
import type { Actor, Db, Queryable, Tx } from './types'
import { bump, getSettings, log, writeSummaryVersion } from './contracts'
import { changeTag, maxSeq } from './changes'
import { emitChange } from '../utils/bus'
import { type AttentionItem, shiftBrief, userNames } from './shifts'

type TabRow = typeof schema.tabs.$inferSelect

// ===========================================================================
// The money
// ===========================================================================

const ZERO: TabMoney = { total_fen: 0, pending_void_fen: 0, paid_fen: 0, remaining_fen: 0 }

/**
 * **The one place a tab's money is computed.**
 *
 *   total     = Σ order_lines.charged_fen − Σ applied line_adjustments.amount_fen
 *   remaining = total − Σ pending void amount_fen − Σ payments.amount_fen
 *
 * A reversal is a negative `payments` row, so it adds back to `remaining` by
 * arithmetic rather than by a special case. A **pending** void leaves
 * `remaining` but not `total`: the guest is not asked for money that is about to
 * be cancelled, while the line is still on the tab and still on the requester's
 * `waiterExpected` until somebody decides.
 *
 * A comp is an adjustment like any other. A line locked free (`charged_fen = 0`,
 * §6.1 step 9) never enters the sum at all — there is nothing to subtract.
 */
export function tabMoney(q: Queryable, venueId: string, tabId: string): TabMoney {
  return tabMoneyMany(q, venueId, [tabId]).get(tabId) ?? { ...ZERO }
}

/** The same arithmetic for a screen full of tables, in four queries instead of 4N. */
export function tabMoneyMany(
  q: Queryable, venueId: string, tabIds: string[],
): Map<string, TabMoney> {
  const out = new Map<string, TabMoney>()
  if (tabIds.length === 0) return out
  for (const id of tabIds) out.set(id, { ...ZERO })

  const charged = q.select({
    tabId: schema.orders.tabId,
    fen: sql<number>`coalesce(sum(${schema.orderLines.chargedFen}), 0)`,
  })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .where(and(eq(schema.orders.venueId, venueId), inArray(schema.orders.tabId, tabIds)))
    .groupBy(schema.orders.tabId)
    .all()
  for (const row of charged) out.get(row.tabId)!.total_fen += row.fen

  const adjustments = q.select({
    tabId: schema.lineAdjustments.tabId,
    status: schema.lineAdjustments.status,
    kind: schema.lineAdjustments.kind,
    fen: sql<number>`coalesce(sum(${schema.lineAdjustments.amountFen}), 0)`,
  })
    .from(schema.lineAdjustments)
    .where(and(
      eq(schema.lineAdjustments.venueId, venueId),
      inArray(schema.lineAdjustments.tabId, tabIds),
      inArray(schema.lineAdjustments.status, ['applied', 'pending']),
    ))
    .groupBy(schema.lineAdjustments.tabId, schema.lineAdjustments.status, schema.lineAdjustments.kind)
    .all()
  for (const row of adjustments) {
    const money = out.get(row.tabId)
    if (!money) continue
    if (row.status === 'applied') money.total_fen -= row.fen
    else if (row.kind === 'void') money.pending_void_fen += row.fen
  }

  const paid = q.select({
    tabId: schema.payments.tabId,
    fen: sql<number>`coalesce(sum(${schema.payments.amountFen}), 0)`,
  })
    .from(schema.payments)
    .where(and(eq(schema.payments.venueId, venueId), inArray(schema.payments.tabId, tabIds)))
    .groupBy(schema.payments.tabId)
    .all()
  for (const row of paid) out.get(row.tabId)!.paid_fen += row.fen

  for (const money of out.values()) {
    money.remaining_fen = money.total_fen - money.pending_void_fen - money.paid_fen
  }
  return out
}

/**
 * What a table owes, for the Korak 1 callers that only ever wanted the total.
 * One formula, one place: `tabTotal` is `tabMoney().total_fen` and nothing else.
 */
export function tabTotal(q: Queryable, venueId: string, tabId: string): number {
  return tabMoney(q, venueId, tabId).total_fen
}

// ===========================================================================
// Reads
// ===========================================================================

/**
 * `GET /api/tables/state` — one row per table, whether or not it has guests,
 * with the shift strip in the same envelope.
 *
 * The strip travels with the floor plan on purpose: a phone that polled the two
 * separately would draw a *Završi smjenu* bar for a shift that had already
 * closed. `actor` is here for the same reason the ETag carries the user —
 * `my_settled`, `my_open_tabs` and the colleague badge are per person.
 */
/**
 * The ETag for `GET /api/tables/state`.
 *
 * **An ETag is a fingerprint of an answer** (see `server/utils/etag.ts`): the
 * browser sends it back on the next request, and an unchanged server replies
 * `304 Not Modified` with no body. The fingerprint must therefore move whenever
 * the body could, which is why it is `changeTag` — `MAX(seq)` for the venue plus
 * the role and the user — and not `MAX(seq)` alone. This envelope carries `shift.my_settled` and `shift.my_open_tabs`, which
 * are the actor's own numbers: on the shared bar tablet — one browser profile
 * that Emir, then Haris, then Amar sign into — a tag without the user would
 * serve the first one's numbers to the second out of his own cache.
 */
export function tablesStateTag(q: Queryable, venueId: string, actor: Actor): string {
  return changeTag(q, venueId, actor)
}

export function getTablesState(
  q: Queryable, venueId: string, actor: Actor,
): TablesStateResponse {
  const tables = q.select()
    .from(schema.tables)
    .where(and(eq(schema.tables.venueId, venueId), eq(schema.tables.active, 1)))
    .orderBy(asc(schema.tables.sort))
    .all()

  // Open tabs only: a paid tab frees the table, and so does an unpaid one.
  const openTabs = q.select({
    tab: schema.tabs,
    openedByName: schema.users.name,
  })
    .from(schema.tabs)
    .innerJoin(schema.users, eq(schema.users.id, schema.tabs.openedBy))
    .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.status, 'open')))
    .all()

  const money = tabMoneyMany(q, venueId, openTabs.map(t => t.tab.id))

  const lastOrder = new Map<string, string>(
    q.select({
      tabId: schema.orders.tabId,
      at: sql<string>`max(${schema.orders.createdAt})`,
    })
      .from(schema.orders)
      .where(eq(schema.orders.venueId, venueId))
      .groupBy(schema.orders.tabId)
      .all()
      .map(r => [r.tabId, r.at]),
  )

  const initials = new Map<string, string>(
    q.select({ id: schema.users.id, initials: schema.users.initials })
      .from(schema.users)
      .where(eq(schema.users.venueId, venueId))
      .all()
      .map(u => [u.id, u.initials]),
  )

  /**
   * One row per open tab that sits on a table. A *Bez stola* tab has a null
   * `table_id`, so it can never be found by a table's id and drops out of this
   * map on its own — `loose_tabs` below is where it goes instead.
   */
  const byTable = new Map(openTabs.filter(t => t.tab.tableId !== null)
    .map(t => [t.tab.tableId!, t]))

  const stateOf = (tab: TabRow, openedByName: string): TableState => {
    const m = money.get(tab.id) ?? ZERO
    return {
      table_id: tab.tableId,
      tab_id: tab.id,
      tab_client_id: tab.clientId,
      total_fen: m.total_fen,
      remaining_fen: m.remaining_fen,
      assigned_to: tab.assignedTo,
      assigned_to_initials: tab.assignedTo ? initials.get(tab.assignedTo) ?? null : null,
      opened_by_name: openedByName,
      opened_at: tab.openedAt,
      last_order_at: lastOrder.get(tab.id) ?? null,
      pending_review: tab.pendingReview === 1,
      late_sync: tab.lateSync === 1,
      offered_to: tab.offeredTo,
    }
  }

  const rows: TableState[] = tables.map((table) => {
    const found = byTable.get(table.id)
    if (!found) {
      return {
        table_id: table.id,
        tab_id: null,
        tab_client_id: null,
        total_fen: 0,
        remaining_fen: 0,
        assigned_to: null,
        assigned_to_initials: null,
        opened_by_name: null,
        opened_at: null,
        last_order_at: null,
        pending_review: false,
        late_sync: false,
        offered_to: null,
      }
    }
    return stateOf(found.tab, found.openedByName)
  })

  const looseTabs: TableState[] = openTabs
    .filter(t => t.tab.tableId === null)
    .map(t => stateOf(t.tab, t.openedByName))

  return {
    seq: maxSeq(q, venueId),
    shift: shiftBrief(q, venueId, actor),
    tables: rows,
    loose_tabs: looseTabs,
  }
}

/** The `tabs` row as a screen sees it, with its money and its two names. */
export function tabView(q: Queryable, venueId: string, tabId: string): Tab {
  // A **left** join since `0003_phase3.sql`: a *Bez stola* tab has no table row
  // to join to, and an inner join would simply drop it from every read.
  const row = q.select({ tab: schema.tabs, tableName: schema.tables.name })
    .from(schema.tabs)
    .leftJoin(schema.tables, eq(schema.tables.id, schema.tabs.tableId))
    .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.id, tabId)))
    .get()
  if (!row) throw notFound('TAB_NOT_FOUND', `tab ${tabId} not found`)

  const names = userNames(q, venueId)
  const money = tabMoney(q, venueId, tabId)
  const tab = row.tab

  return {
    id: tab.id,
    table_id: tab.tableId,
    table_name: row.tableName,
    client_id: tab.clientId,
    status: tab.status,
    shift_id: tab.shiftId,
    total_fen: money.total_fen,
    remaining_fen: money.remaining_fen,
    opened_by: tab.openedBy,
    opened_at: tab.openedAt,
    assigned_to: tab.assignedTo,
    assigned_to_name: tab.assignedTo ? names.get(tab.assignedTo) ?? null : null,
    offered_to: tab.offeredTo,
    offered_to_name: tab.offeredTo ? names.get(tab.offeredTo) ?? null : null,
    pending_review: tab.pendingReview === 1,
    late_sync: tab.lateSync === 1,
    unpaid_reason: tab.unpaidReason,
    unpaid_by: tab.unpaidBy,
    closed_at: tab.closedAt,
    closed_by: tab.closedBy,
  }
}

/**
 * `GET /api/tabs/:id` — *Pokaži narudžbu* and the naplata sheet.
 *
 * Every line carries the status the sheet paints it in, so no screen has to
 * re-derive "is this struck, pending or free" out of two joined tables.
 */
export function getTab(q: Queryable, venueId: string, tabId: string, _actor: Actor): TabDetail {
  const tab = tabView(q, venueId, tabId)
  const names = userNames(q, venueId)

  const flavourNames = new Map<string, string>(
    q.select({ id: schema.stockItems.id, name: schema.stockItems.name })
      .from(schema.stockItems)
      .where(eq(schema.stockItems.venueId, venueId))
      .all()
      .map(i => [i.id, i.name]),
  )

  const orders = q.select().from(schema.orders)
    .where(and(eq(schema.orders.venueId, venueId), eq(schema.orders.tabId, tabId)))
    .orderBy(asc(schema.orders.createdAt))
    .all()

  const lines = q.select().from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .where(and(eq(schema.orders.venueId, venueId), eq(schema.orders.tabId, tabId)))
    .all()
    .map(r => r.order_lines)

  // The live adjustment of a line, if any. `line_adjustments_line_uq` makes
  // "any" mean "at most one" for `pending` and `applied` alike.
  const live = new Map<string, { id: string, kind: string, status: string }>()
  for (const adj of q.select().from(schema.lineAdjustments)
    .where(and(
      eq(schema.lineAdjustments.venueId, venueId),
      eq(schema.lineAdjustments.tabId, tabId),
      inArray(schema.lineAdjustments.status, ['pending', 'applied']),
    ))
    .all()) {
    live.set(adj.orderLineId, { id: adj.id, kind: adj.kind, status: adj.status })
  }

  const linesByOrder = new Map<string, TabLine[]>()
  for (const line of lines) {
    const adj = live.get(line.id)
    const status: TabLine['status'] = adj
      ? (adj.status === 'pending'
          ? 'storno_na_cekanju'
          : (adj.kind === 'comp' ? 'gratis' : 'storno'))
      : (line.compReason ? 'gratis' : 'ok')

    const ids: string[] = line.flavoursJson ? JSON.parse(line.flavoursJson) : []
    const list = linesByOrder.get(line.orderId) ?? []
    list.push({
      id: line.id,
      name_snapshot: line.nameSnapshot,
      note: line.note,
      flavour_names: ids.map(id => flavourNames.get(id) ?? '—'),
      qty: line.qty,
      unit_price_fen: line.unitPriceFen,
      charged_fen: line.chargedFen,
      comp_reason: line.compReason,
      status,
      adjustment_id: adj?.id ?? null,
    })
    linesByOrder.set(line.orderId, list)
  }

  const payments = q.select().from(schema.payments)
    .where(and(eq(schema.payments.venueId, venueId), eq(schema.payments.tabId, tabId)))
    .orderBy(asc(schema.payments.createdAt))
    .all()

  return {
    tab,
    money: tabMoney(q, venueId, tabId),
    orders: orders.map(o => ({
      id: o.id,
      client_id: o.clientId,
      shift_seq: o.shiftSeq,
      locked_by: o.lockedBy,
      locked_by_name: names.get(o.lockedBy) ?? '—',
      at: o.createdAt,
      late_sync: o.lateSync === 1,
      lines: linesByOrder.get(o.id) ?? [],
    })),
    payments: payments.map(p => ({
      id: p.id,
      method: p.method,
      amount_fen: p.amountFen,
      paid_by: p.paidBy,
      paid_by_name: names.get(p.paidBy) ?? '—',
      at: p.createdAt,
      reverses_id: p.reversesId,
    })),
  }
}

/** The unpaid tabs waiting for the owner's *Otpis* or *Naplatiti*. */
export function pendingFor(q: Queryable, venueId: string, _now: string): AttentionItem[] {
  const names = userNames(q, venueId)
  const rows = q.select({ tab: schema.tabs, tableName: schema.tables.name })
    .from(schema.tabs)
    .innerJoin(schema.tables, eq(schema.tables.id, schema.tabs.tableId))
    .where(and(
      eq(schema.tabs.venueId, venueId),
      eq(schema.tabs.status, 'unpaid'),
      eq(schema.tabs.pendingReview, 1),
    ))
    .all()

  const money = tabMoneyMany(q, venueId, rows.map(r => r.tab.id))
  return rows.map(({ tab, tableName }) => ({
    kind: 'unpaid_tab' as const,
    ref_type: 'tab' as const,
    ref_id: tab.id,
    title_bs: `Nije plaćeno · ${names.get(tab.unpaidBy ?? '') ?? '—'} · ${tableName}`,
    amount_fen: money.get(tab.id)?.remaining_fen ?? 0,
    at: tab.closedAt ?? tab.openedAt,
    actions: ['approve', 'reject'] as ('approve' | 'reject' | 'note')[],
  }))
}

// ===========================================================================
// Writes
// ===========================================================================

function requireTab(q: Queryable, venueId: string, tabId: string): TabRow {
  const row = q.select().from(schema.tabs)
    .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.id, tabId)))
    .get()
  if (!row) throw notFound('TAB_NOT_FOUND', `tab ${tabId} not found`)
  return row
}

/** A tab that is still taking rounds. Anything else is a 409 with its reason. */
function requireOpenTab(q: Queryable, venueId: string, tabId: string): TabRow {
  const tab = requireTab(q, venueId, tabId)
  if (tab.status === 'paid') throw conflict('TAB_ALREADY_PAID', `tab ${tabId} is paid`)
  if (tab.status === 'voided') throw conflict('TAB_VOIDED', `tab ${tabId} is voided`)
  if (tab.status !== 'open') throw conflict('TAB_CLOSED', `tab ${tabId} is ${tab.status}`)
  return tab
}

/**
 * Whose tab it is. `assigned_to` is never NULL in fact — `tabs_assigned_required`
 * refuses an insert without it — so this is a straight comparison and not a
 * fallback nobody could ever cover with a test.
 */
function requireAssignee(tab: TabRow, actor: Actor): void {
  if (actor.role === 'admin') return
  if (tab.assignedTo !== actor.userId) {
    throw forbidden('NOT_ASSIGNED', 'this table is somebody else\'s')
  }
}

/**
 * `POST /api/tabs/unpaid` — *Nije plaćeno*.
 *
 * Queueable, because a guest can walk out while the phone has no signal: the
 * mark carries its own `client_id` and `tabs_unpaid_client_uq` is what makes a
 * retry one row. The amount stays on the waiter's `waiterExpected` (term 3)
 * until the owner writes it off — it is money he is answerable for, not money
 * he has.
 */
export function markUnpaid(
  db: Db, venueId: string, actor: Actor, body: MarkUnpaidBody,
): UnpaidResult {
  const result = db.transaction((tx) => {
    const replay = tx.select().from(schema.tabs)
      .where(and(
        eq(schema.tabs.venueId, venueId),
        eq(schema.tabs.unpaidClientId, body.client_id),
      ))
      .get()
    if (replay) return { tab: tabView(tx, venueId, replay.id), already_applied: true }

    const found = tx.select().from(schema.tabs)
      .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.clientId, body.tab_client_id)))
      .get()
    if (!found) throw notFound('TAB_NOT_FOUND', `tab ${body.tab_client_id} not found`)

    const tab = requireOpenTab(tx, venueId, found.id)
    requireAssignee(tab, actor)

    const money = tabMoney(tx, venueId, tab.id)
    if (money.remaining_fen <= 0) {
      throw conflict('NOTHING_TO_MARK', `tab ${tab.id} owes nothing`)
    }

    const settings = getSettings(tx, venueId)
    const at = nowIso()
    const clientAt = clampEventAt(body.client_created_at, at, settings.max_sync_lag_h)

    tx.update(schema.tabs)
      .set({
        status: 'unpaid',
        pendingReview: 1,
        unpaidBy: actor.userId,
        unpaidReason: body.reason,
        unpaidClientId: body.client_id,
        closedAt: clientAt,
        closedBy: actor.userId,
      })
      .where(eq(schema.tabs.id, tab.id))
      .run()

    log(tx, venueId, {
      kind: 'unpaid_marked',
      body: {
        tab_id: tab.id,
        table_id: tab.tableId,
        user_id: actor.userId,
        remaining_fen: money.remaining_fen,
        reason: body.reason,
        note: body.note ?? null,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'tab', id: tab.id },
      shiftId: tab.shiftId,
      at,
    })

    bump(tx, venueId, 'table', tab.id)
    // The owner's *Zahtijeva pažnju* counts unpaid tabs beside the pending voids.
    bump(tx, venueId, 'adjustment', tab.id)

    return { tab: tabView(tx, venueId, tab.id), already_applied: false }
  })

  emitChange(venueId, { seq: maxSeq(db, venueId), entity: 'table', entityId: result.tab.id })
  return result
}

/**
 * `POST /api/tabs/:id/unpaid/decide` — the owner's *Otpis* or *Naplatiti*.
 *
 * *Otpis* takes the amount off the waiter's expected cash: the café has decided
 * the money is gone and stopped asking him for it. *Naplatiti* writes nothing
 * but the entry — the tab stays pending until a payment actually lands, which
 * is what keeps the amount on his line in the meantime.
 */
export function decideUnpaid(
  db: Db, venueId: string, actor: Actor, tabId: string, body: DecideUnpaidBody,
): Tab {
  const result = db.transaction((tx) => {
    const tab = requireTab(tx, venueId, tabId)
    if (tab.status !== 'unpaid' || tab.pendingReview !== 1) {
      throw conflict('NOT_PENDING', `tab ${tabId} is not awaiting a decision`)
    }

    const at = nowIso()
    const money = tabMoney(tx, venueId, tabId)

    if (body.outcome === 'otpis') {
      tx.update(schema.tabs)
        .set({ pendingReview: 0, unpaidApprovedBy: actor.userId })
        .where(eq(schema.tabs.id, tabId))
        .run()
    }

    log(tx, venueId, {
      kind: 'unpaid_decided',
      body: {
        tab_id: tabId,
        table_id: tab.tableId,
        amount_fen: money.remaining_fen,
        outcome: body.outcome,
        note: body.note ?? null,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'tab', id: tabId },
      shiftId: tab.shiftId,
      at,
    })

    // A write-off moves `expectedCash`, so a shift that has already closed gets
    // a new version of its numbers rather than a silent edit of the old one.
    if (body.outcome === 'otpis' && tab.shiftId) {
      const shift = tx.select({ status: schema.shifts.status }).from(schema.shifts)
        .where(eq(schema.shifts.id, tab.shiftId))
        .get()
      if (shift && (shift.status === 'closed' || shift.status === 'reviewed')) {
        writeSummaryVersion(tx, venueId, tab.shiftId, 'decision', at)
      }
    }

    bump(tx, venueId, 'table', tabId)
    bump(tx, venueId, 'adjustment', tabId)
    bump(tx, venueId, 'shift', tab.shiftId ?? undefined)

    return tabView(tx, venueId, tabId)
  })

  emitChange(venueId, { seq: maxSeq(db, venueId), entity: 'table', entityId: tabId })
  return result
}

/**
 * `POST /api/tabs/:id/move` — the guests moved to another table.
 *
 * The partial unique index `(venue_id, table_id) WHERE status='open'` is the
 * hard guarantee; the 409 below is the friendly version of the same rule.
 */
export function moveTab(
  db: Db, venueId: string, actor: Actor, tabId: string, body: MoveTabBody,
): Tab {
  const result = db.transaction((tx) => {
    const tab = requireOpenTab(tx, venueId, tabId)

    const table = tx.select().from(schema.tables)
      .where(and(
        eq(schema.tables.id, body.table_id),
        eq(schema.tables.venueId, venueId),
        eq(schema.tables.active, 1),
      ))
      .get()
    if (!table) throw notFound('TABLE_NOT_FOUND', `table ${body.table_id} not found`)

    if (table.id === tab.tableId) return tabView(tx, venueId, tabId)

    const occupied = tx.select({ id: schema.tabs.id }).from(schema.tabs)
      .where(and(
        eq(schema.tabs.venueId, venueId),
        eq(schema.tabs.tableId, table.id),
        eq(schema.tabs.status, 'open'),
      ))
      .get()
    if (occupied) throw conflict('TABLE_OCCUPIED', `table ${table.id} already has an open tab`)

    tx.update(schema.tabs).set({ tableId: table.id }).where(eq(schema.tabs.id, tabId)).run()

    log(tx, venueId, {
      kind: 'tab_moved',
      body: {
        tab_id: tabId, user_id: actor.userId,
        from_table_id: tab.tableId, to_table_id: table.id,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'tab', id: tabId },
      shiftId: tab.shiftId,
    })

    bump(tx, venueId, 'table', tabId)
    return tabView(tx, venueId, tabId)
  })

  emitChange(venueId, { seq: maxSeq(db, venueId), entity: 'table', entityId: tabId })
  return result
}

/**
 * `POST /api/tabs/:id/assign` — *Predaj sto kolegi*, the offer half.
 *
 * Online only, and deliberately: a handover the colleague has not seen yet is
 * not a handover, so there is no offline queue for it. Re-offering to somebody
 * else overwrites; passing the current holder's own id clears the offer.
 *
 * **Money does not follow the tab.** Rounds stay attributed to whoever locked
 * them (`orders.locked_by`), so nobody's promet moves. What moves is
 * responsibility for what happens *next*: who may mark it unpaid, and whose
 * *Završi smjenu* bar still counts it.
 */
export function assignTab(
  db: Db, venueId: string, actor: Actor, tabId: string, body: AssignTabBody,
): Tab {
  const result = db.transaction((tx) => {
    const tab = requireOpenTab(tx, venueId, tabId)
    requireAssignee(tab, actor)

    const target = tx.select().from(schema.users)
      .where(and(
        eq(schema.users.id, body.user_id),
        eq(schema.users.venueId, venueId),
        eq(schema.users.active, 1),
      ))
      .get()
    if (!target) throw badRequest('INVALID_TARGET', `user ${body.user_id} cannot take a table`)

    // Handing it back to whoever already holds it is how an offer is withdrawn.
    if (target.id === tab.assignedTo) {
      tx.update(schema.tabs).set({ offeredTo: null }).where(eq(schema.tabs.id, tabId)).run()
      bump(tx, venueId, 'table', tabId)
      return tabView(tx, venueId, tabId)
    }
    if (target.id === actor.userId) {
      throw badRequest('INVALID_TARGET', 'a table cannot be offered to yourself')
    }

    tx.update(schema.tabs).set({ offeredTo: target.id }).where(eq(schema.tabs.id, tabId)).run()

    log(tx, venueId, {
      kind: 'tab_offered',
      body: { tab_id: tabId, table_id: tab.tableId, user_id: actor.userId, to: target.id },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'tab', id: tabId },
      shiftId: tab.shiftId,
    })

    bump(tx, venueId, 'table', tabId)
    return tabView(tx, venueId, tabId)
  })

  emitChange(venueId, { seq: maxSeq(db, venueId), entity: 'table', entityId: tabId })
  return result
}

/** `POST /api/tabs/:id/accept` — the colleague takes the table. */
export function acceptTab(db: Db, venueId: string, actor: Actor, tabId: string): Tab {
  const result = db.transaction((tx) => {
    const tab = requireOpenTab(tx, venueId, tabId)
    if (tab.offeredTo !== actor.userId) {
      throw forbidden('NOT_OFFERED', `tab ${tabId} was not offered to you`)
    }

    const from = tab.assignedTo
    tx.update(schema.tabs)
      .set({ assignedTo: actor.userId, offeredTo: null })
      .where(eq(schema.tabs.id, tabId))
      .run()

    log(tx, venueId, {
      kind: 'tab_handed',
      body: { tab_id: tabId, table_id: tab.tableId, from, to: actor.userId },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'tab', id: tabId },
      shiftId: tab.shiftId,
    })

    bump(tx, venueId, 'table', tabId)
    return tabView(tx, venueId, tabId)
  })

  emitChange(venueId, { seq: maxSeq(db, venueId), entity: 'table', entityId: tabId })
  return result
}
