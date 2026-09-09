/**
 * Tabs: the floor-plan state, and *naplati* (pay).
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { conflict, notFound } from '../utils/errors'
import { nowIso } from '../utils/ids'
import type { Tab, TableState } from '#shared/types'
import type { Db, Queryable } from './types'
import { tabTotal } from './orders'
import { bump } from './contracts'

/**
 * `GET /api/tables/state` — one row per table, whether or not it has guests.
 *
 * The waiter's floor plan polls this every 15 s. Tables with no open tab come
 * back with `tab_id: null` and a zero total, so the screen can render the whole
 * room from one array without a second lookup per table.
 */
export function getTablesState(db: Queryable, venueId: string): TableState[] {
  const tables = db.select()
    .from(schema.tables)
    .where(and(eq(schema.tables.venueId, venueId), eq(schema.tables.active, 1)))
    .orderBy(asc(schema.tables.sort))
    .all()

  const openTabs = db.select({
    tabId: schema.tabs.id,
    tableId: schema.tabs.tableId,
    openedAt: schema.tabs.openedAt,
    openedByName: schema.users.name,
  })
    .from(schema.tabs)
    .innerJoin(schema.users, eq(schema.users.id, schema.tabs.openedBy))
    .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.status, 'open')))
    .all()

  const totals = new Map<string, number>(
    db.select({
      tabId: schema.orders.tabId,
      total: sql<number>`coalesce(sum(${schema.orderLines.chargedFen}), 0)`,
    })
      .from(schema.orderLines)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
      .where(eq(schema.orders.venueId, venueId))
      .groupBy(schema.orders.tabId)
      .all()
      .map(r => [r.tabId, r.total ?? 0]),
  )

  const lastOrder = new Map<string, string>(
    db.select({
      tabId: schema.orders.tabId,
      at: sql<string>`max(${schema.orders.createdAt})`,
    })
      .from(schema.orders)
      .where(eq(schema.orders.venueId, venueId))
      .groupBy(schema.orders.tabId)
      .all()
      .map(r => [r.tabId, r.at]),
  )

  const byTable = new Map(openTabs.map(t => [t.tableId, t]))

  return tables.map((table) => {
    const tab = byTable.get(table.id)
    if (!tab) {
      return {
        table_id: table.id,
        tab_id: null,
        total_fen: 0,
        opened_by_name: null,
        opened_at: null,
        last_order_at: null,
      }
    }
    return {
      table_id: table.id,
      tab_id: tab.tabId,
      total_fen: totals.get(tab.tabId) ?? 0,
      opened_by_name: tab.openedByName,
      opened_at: tab.openedAt,
      last_order_at: lastOrder.get(tab.tabId) ?? null,
    }
  })
}

export function getTab(db: Queryable, venueId: string, tabId: string): Tab {
  const row = db.select({
    tab: schema.tabs,
    tableName: schema.tables.name,
  })
    .from(schema.tabs)
    .innerJoin(schema.tables, eq(schema.tables.id, schema.tabs.tableId))
    .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.id, tabId)))
    .get()
  if (!row) throw notFound('TAB_NOT_FOUND', `tab ${tabId} not found`)

  return {
    id: row.tab.id,
    table_id: row.tab.tableId,
    table_name: row.tableName,
    client_id: row.tab.clientId,
    status: row.tab.status,
    total_fen: tabTotal(db, venueId, row.tab.id),
    opened_by: row.tab.openedBy,
    opened_at: row.tab.openedAt,
    closed_at: row.tab.closedAt,
    closed_by: row.tab.closedBy,
  }
}

/**
 * `POST /api/tabs/:id/pay` — *naplati*.
 *
 * The only change a tab row will ever accept: open → paid, stamping who and
 * when. A trigger enforces that (see `triggers.sql`), so the 409 below is the
 * friendly version of a rule the database would refuse anyway.
 */
export function payTab(db: Db, venueId: string, tabId: string, userId: string): Tab {
  return db.transaction((tx) => {
    const tab = tx.select().from(schema.tabs)
      .where(and(eq(schema.tabs.venueId, venueId), eq(schema.tabs.id, tabId)))
      .get()
    if (!tab) throw notFound('TAB_NOT_FOUND', `tab ${tabId} not found`)
    if (tab.status === 'paid') throw conflict('TAB_ALREADY_PAID', `tab ${tabId} is already paid`)

    const user = tx.select({ id: schema.users.id }).from(schema.users)
      .where(and(eq(schema.users.id, userId), eq(schema.users.venueId, venueId)))
      .get()
    if (!user) throw notFound('USER_NOT_FOUND', `user ${userId} not found`)

    tx.update(schema.tabs)
      .set({ status: 'paid', closedAt: nowIso(), closedBy: userId })
      .where(eq(schema.tabs.id, tabId))
      .run()

    // The sync hook (BACKEND §4.1): the table is free again on every floor plan.
    bump(tx, venueId, 'table', tabId)

    return getTab(tx, venueId, tabId)
  })
}
