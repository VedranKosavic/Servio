/**
 * A whole café in memory.
 *
 * `:memory:` is a real SQLite database that lives only inside this process and
 * disappears when the test ends — so every test gets the *real* migrations and
 * the *real* triggers on a clean venue, in a few milliseconds, with nothing to
 * clean up. A test running against a different schema, or with the triggers
 * missing, would prove nothing about production.
 *
 * **The row-writing helpers write rows, not calls.** `lock`, `pay`, `voidLine`,
 * `cashMovement` and `settle` insert their ledger rows with plain SQL through
 * the schema — they never call `createOrder` / `createPayment` /
 * `requestAdjustment`. That is deliberate and it is what lets eight work
 * packages be written in parallel: `expectedCash` reads *columns*
 * (`payments.method/paid_by/post_settle`, `tabs.status/unpaid_by`,
 * `line_adjustments.kind/was_paid/status`, `cash_movements.type/status`), so a
 * fixture that produces the right columns is a complete fixture months before
 * the service that will produce them in production exists. The package that
 * owns the service later adds its own tests that go through the real code and
 * assert the same columns come out. Two helpers, one shape, no package waiting
 * on another's stub.
 */
import { and, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import type Database from 'better-sqlite3'
import { openDatabase, type Db } from '../../server/database/client'
import * as schema from '../../server/database/schema'
import { seed } from '../../server/database/seed'
import type { Actor, Role } from '#shared/types'

const id = () => randomUUID()

export interface LockLine {
  product: string
  qty?: number
  /** Tobacco stock item names, for a nargila line. */
  flavours?: string[]
}

export interface LockResult {
  orderId: string
  tabId: string
  lineIds: string[]
  totalFen: number
}

export interface Fixture {
  db: Db
  sqlite: Database.Database
  close: () => void
  venueId: string
  userId: (name: string) => string
  tableId: (name: string) => string
  productId: (name: string) => string
  stockItemId: (name: string) => string
  onHand: (name: string) => number

  /** An `Actor` for `name`, built directly — what almost every test wants. */
  actor: (name: string, opts?: { device?: string | null, bound?: boolean }) => Actor
  /** Haris, the admin. */
  adminActor: () => Actor

  /** Open a shift and put `members` on it. Returns the shift id. */
  openShift: (opts?: { members?: string[], at?: string, businessDate?: string }) => string
  /** Write a locked round straight into the ledger. */
  lock: (name: string, table: string, lines: LockLine[], opts?: { at?: string }) => LockResult
  /** Write a payment row. Negative amounts need `approvedBy` (a trigger says so). */
  pay: (name: string, tabId: string, fen: number, opts?: {
    method?: 'cash' | 'card', approvedBy?: string, postSettle?: boolean, at?: string,
  }) => string
  /** Write a `line_adjustments` row. */
  voidLine: (name: string, lineId: string, opts?: {
    kind?: 'void' | 'comp', amountFen?: number, status?: 'pending' | 'applied' | 'rejected',
    wasPaid?: boolean, approvedBy?: string, at?: string,
  }) => string
  cashMovement: (opts: {
    type: 'float_in' | 'float_out' | 'payout' | 'owner_pickup' | 'refund'
    amountFen: number, user: string, createdBy?: string,
    status?: 'pending' | 'approved' | 'rejected', at?: string,
  }) => string
  settle: (name: string, opts?: { declaredFen?: number, expectedFen?: number, at?: string }) => string
  /** A submitted count with one line per named item. */
  submitCount: (name: string, items: string[], opts?: {
    phase?: 'open' | 'close' | 'adhoc', kind?: 'spot' | 'full', at?: string,
  }) => { countId: string, lineIds: string[] }
  /** A posted delivery with one line per named item. */
  postDelivery: (name: string, lines: Array<{ item: string, qty: number, costFen: number }>) => {
    deliveryId: string, lineIds: string[]
  }
  wasteEvent: (name: string, item: string, qty: number, opts?: { needsApproval?: boolean }) => string
  logEntry: (opts?: { kind?: string, title?: string }) => string
  alertEvent: (opts?: { ruleKey?: string }) => string
  authAttempt: (name: string, ok: boolean) => string

  /** The venue's settings, overridden for this test. */
  settingsWith: (patch: Record<string, unknown>) => void
  /**
   * Run raw SQL and assert the database refuses it. Raw, because a rule that
   * only holds when it is reached through a service is not a rule.
   */
  expectRefused: (statement: string, message: string | RegExp) => void
  /** An injectable now, so a test can put two events an hour apart. */
  clock: { now: () => string, advance: (seconds: number) => void }
}

export function makeFixture(): Fixture {
  const { db, sqlite } = openDatabase(':memory:')
  seed(db, { devSecrets: true })

  const venueId = db.select().from(schema.venues).get()!.id

  const byName = <T extends { id: string, name: string }>(rows: T[], name: string): string => {
    const row = rows.find(r => r.name === name)
    if (!row) throw new Error(`fixture: no row named "${name}"`)
    return row.id
  }

  const users = db.select().from(schema.users).all()
  const tables = db.select().from(schema.tables).all()
  const products = db.select().from(schema.products).all()
  const stockItems = db.select().from(schema.stockItems).all()

  const userId = (name: string) => byName(users, name)
  const tableId = (name: string) => byName(tables, name)
  const productId = (name: string) => byName(products, name)
  const stockItemId = (name: string) => byName(stockItems, name)
  const roleOf = (name: string): Role => users.find(u => u.name === name)!.role

  let clockMs = Date.now()
  const clock = {
    now: () => new Date(clockMs).toISOString(),
    advance: (seconds: number) => { clockMs += seconds * 1000 },
  }

  const actor = (name: string, opts: { device?: string | null, bound?: boolean } = {}): Actor => ({
    venueId,
    userId: userId(name),
    role: roleOf(name),
    sessionId: `session-${name}`,
    sessionKind: roleOf(name) === 'admin' && !opts.device ? 'admin' : 'staff',
    deviceId: opts.device ?? null,
    deviceBoundUserId: opts.bound ? userId(name) : null,
    borrowed: false,
  })

  function openShift(opts: { members?: string[], at?: string, businessDate?: string } = {}): string {
    const at = opts.at ?? clock.now()
    const shiftId = id()
    db.insert(schema.shifts).values({
      id: shiftId,
      venueId,
      businessDate: opts.businessDate ?? at.slice(0, 10),
      openedAt: at,
      openedBy: userId(opts.members?.[0] ?? 'Amar'),
      autoOpened: 0,
      status: 'open',
      createdAt: at,
    }).run()
    for (const name of opts.members ?? []) {
      db.insert(schema.shiftMembers).values({
        id: id(), venueId, shiftId, userId: userId(name), role: roleOf(name), joinedAt: at,
      }).onConflictDoNothing().run()
    }
    return shiftId
  }

  /** The shift that is open now, opening one if a helper needs it. */
  function shiftNow(): string {
    const open = db.select({ id: schema.shifts.id }).from(schema.shifts)
      .where(and(eq(schema.shifts.venueId, venueId), eq(schema.shifts.status, 'open')))
      .get()
    return open?.id ?? openShift()
  }

  function lock(name: string, table: string, lines: LockLine[], opts: { at?: string } = {}): LockResult {
    const at = opts.at ?? clock.now()
    const shiftId = shiftNow()
    const tblId = tableId(table)
    const uid = userId(name)

    let tabId = db.select({ id: schema.tabs.id }).from(schema.tabs)
      .where(and(
        eq(schema.tabs.venueId, venueId),
        eq(schema.tabs.tableId, tblId),
        eq(schema.tabs.status, 'open'),
      ))
      .get()?.id
    if (!tabId) {
      tabId = id()
      db.insert(schema.tabs).values({
        id: tabId, venueId, tableId: tblId, clientId: id(), status: 'open',
        shiftId, openedBy: uid, openedAt: at, assignedTo: uid,
      }).run()
    }

    const seq = (db.select({ max: sql<number | null>`max(${schema.orders.shiftSeq})` })
      .from(schema.orders)
      .where(and(eq(schema.orders.venueId, venueId), eq(schema.orders.shiftId, shiftId)))
      .get()?.max ?? 0) + 1

    const orderId = id()
    db.insert(schema.orders).values({
      id: orderId, venueId, tabId, clientId: id(), shiftId, shiftSeq: seq,
      lockedBy: uid, createdAt: at,
    }).run()

    const lineIds: string[] = []
    let totalFen = 0
    for (const line of lines) {
      const product = products.find(p => p.name === line.product)
      if (!product) throw new Error(`fixture: no product named "${line.product}"`)
      const qty = line.qty ?? 1
      const chargedFen = product.priceFen * qty
      const lineId = id()
      db.insert(schema.orderLines).values({
        id: lineId, venueId, orderId, productId: product.id,
        nameSnapshot: product.name, qty, unitPriceFen: product.priceFen, chargedFen,
        flavoursJson: line.flavours
          ? JSON.stringify(line.flavours.map(stockItemId))
          : null,
      }).run()
      lineIds.push(lineId)
      totalFen += chargedFen
    }

    return { orderId, tabId, lineIds, totalFen }
  }

  function pay(name: string, tabId: string, fen: number, opts: {
    method?: 'cash' | 'card', approvedBy?: string, postSettle?: boolean, at?: string,
  } = {}): string {
    const at = opts.at ?? clock.now()
    const paymentId = id()
    db.insert(schema.payments).values({
      id: paymentId, venueId, tabId, shiftId: shiftNow(), clientId: id(),
      method: opts.method ?? 'cash', amountFen: fen,
      paidBy: userId(name),
      approvedBy: opts.approvedBy ? userId(opts.approvedBy) : null,
      postSettle: opts.postSettle ? 1 : 0,
      createdAt: at,
    }).run()
    return paymentId
  }

  function voidLine(name: string, lineId: string, opts: {
    kind?: 'void' | 'comp', amountFen?: number, status?: 'pending' | 'applied' | 'rejected',
    wasPaid?: boolean, approvedBy?: string, at?: string,
  } = {}): string {
    const at = opts.at ?? clock.now()
    const line = db.select().from(schema.orderLines).where(eq(schema.orderLines.id, lineId)).get()!
    const order = db.select().from(schema.orders).where(eq(schema.orders.id, line.orderId)).get()!
    const adjId = id()
    const status = opts.status ?? 'pending'
    db.insert(schema.lineAdjustments).values({
      id: adjId, venueId, orderLineId: lineId, tabId: order.tabId, clientId: id(),
      kind: opts.kind ?? 'void', reason: 'greska', qty: line.qty,
      amountFen: opts.amountFen ?? line.chargedFen, restock: 1,
      requestedBy: userId(name), secondsSinceLock: 10, wasPaid: opts.wasPaid ? 1 : 0,
      status,
      approvedBy: status === 'pending' ? null : userId(opts.approvedBy ?? 'Emir'),
      decidedAt: status === 'pending' ? null : at,
      createdAt: at,
    }).run()
    return adjId
  }

  function cashMovement(opts: {
    type: 'float_in' | 'float_out' | 'payout' | 'owner_pickup' | 'refund'
    amountFen: number, user: string, createdBy?: string,
    status?: 'pending' | 'approved' | 'rejected', at?: string,
  }): string {
    const at = opts.at ?? clock.now()
    const movementId = id()
    db.insert(schema.cashMovements).values({
      id: movementId, venueId, shiftId: shiftNow(), type: opts.type,
      amountFen: opts.amountFen, userId: userId(opts.user),
      createdBy: userId(opts.createdBy ?? 'Haris'),
      status: opts.status ?? 'approved', createdAt: at,
    }).run()
    return movementId
  }

  function settle(name: string, opts: {
    declaredFen?: number, expectedFen?: number, at?: string,
  } = {}): string {
    const at = opts.at ?? clock.now()
    const settlementId = id()
    db.insert(schema.waiterSettlements).values({
      id: settlementId, venueId, shiftId: shiftNow(), userId: userId(name),
      declaredFen: opts.declaredFen ?? 0,
      expectedAtDeclareFen: opts.expectedFen ?? 0,
      breakdownJson: '{}', summaryJson: '{}', createdAt: at,
    }).run()
    return settlementId
  }

  function submitCount(name: string, items: string[], opts: {
    phase?: 'open' | 'close' | 'adhoc', kind?: 'spot' | 'full', at?: string,
  } = {}): { countId: string, lineIds: string[] } {
    const at = opts.at ?? clock.now()
    const countId = id()
    db.insert(schema.stockCounts).values({
      id: countId, venueId, kind: opts.kind ?? 'spot', phase: opts.phase ?? 'adhoc',
      shiftId: shiftNow(), status: 'submitted', countedBy: userId(name), submittedAt: at,
    }).run()
    const lineIds = items.map((item) => {
      const lineId = id()
      db.insert(schema.stockCountLines).values({
        id: lineId, venueId, countId, stockItemId: stockItemId(item),
        countedQty: 10, theoreticalQty: 12, varianceQty: -2,
        unitCostMfen: 1000, varianceFen: -2,
      }).run()
      return lineId
    })
    return { countId, lineIds }
  }

  function postDelivery(
    name: string,
    lines: Array<{ item: string, qty: number, costFen: number }>,
  ): { deliveryId: string, lineIds: string[] } {
    const at = clock.now()
    const deliveryId = id()
    db.insert(schema.deliveries).values({
      id: deliveryId, venueId, clientId: id(), supplierName: 'Dobavljač',
      deliveredAt: at, totalFen: lines.reduce((s, l) => s + l.costFen, 0),
      status: 'posted', enteredBy: userId(name), createdAt: at,
    }).run()
    const lineIds = lines.map((l) => {
      const lineId = id()
      db.insert(schema.deliveryLines).values({
        id: lineId, venueId, deliveryId, stockItemId: stockItemId(l.item),
        packs: 0, loose: l.qty, qty: l.qty, lineCostFen: l.costFen,
        unitCostMfen: Math.round((l.costFen * 1000) / l.qty),
      }).run()
      return lineId
    })
    return { deliveryId, lineIds }
  }

  function wasteEvent(
    name: string, item: string, qty: number, opts: { needsApproval?: boolean } = {},
  ): string {
    const at = clock.now()
    const wasteId = id()
    db.insert(schema.wasteEvents).values({
      id: wasteId, venueId, stockItemId: stockItemId(item), clientId: id(),
      qty, reason: 'razbijeno', costFen: 100, shiftId: shiftNow(),
      userId: userId(name), needsApproval: opts.needsApproval ? 1 : 0, createdAt: at,
    }).run()
    return wasteId
  }

  function logEntry(opts: { kind?: string, title?: string } = {}): string {
    const at = clock.now()
    const entryId = id()
    db.insert(schema.logEntries).values({
      id: entryId, venueId, kind: opts.kind ?? 'override',
      titleBs: opts.title ?? 'Preskočeno pravilo · test', bodyJson: '{}',
      businessDate: at.slice(0, 10), createdAt: at,
    }).run()
    return entryId
  }

  function alertEvent(opts: { ruleKey?: string } = {}): string {
    const at = clock.now()
    const eventId = id()
    db.insert(schema.alertEvents).values({
      id: eventId, venueId, ruleKey: opts.ruleKey ?? 'shift_closed',
      refType: 'shift', refId: id(), payloadJson: '{}',
      createdAt: at, sendAfter: at,
    }).run()
    return eventId
  }

  function authAttempt(name: string, ok: boolean): string {
    const at = clock.now()
    const attemptId = id()
    db.insert(schema.authAttempts).values({
      id: attemptId, venueId, deviceId: null, userId: userId(name),
      ip: '127.0.0.1', kind: 'pin', ok: ok ? 1 : 0, createdAt: at,
    }).run()
    return attemptId
  }

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
    venueId,
    userId,
    tableId,
    productId,
    stockItemId,
    onHand: (name) => {
      const itemId = stockItemId(name)
      return db.select().from(schema.stockMovements)
        .where(and(
          eq(schema.stockMovements.venueId, venueId),
          eq(schema.stockMovements.stockItemId, itemId),
        ))
        .all()
        .reduce((sum, m) => sum + m.qtyDelta, 0)
    },
    actor,
    adminActor: () => actor('Haris'),
    openShift,
    lock,
    pay,
    voidLine,
    cashMovement,
    settle,
    submitCount,
    postDelivery,
    wasteEvent,
    logEntry,
    alertEvent,
    authAttempt,
    settingsWith: (patch) => {
      db.update(schema.venues)
        .set({ settingsJson: JSON.stringify(patch) })
        .where(eq(schema.venues.id, venueId))
        .run()
    },
    expectRefused: (statement, message) => {
      expect(() => sqlite.exec(statement)).toThrow(message)
    },
    clock,
  }
}

export { schema }
