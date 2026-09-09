/**
 * The row-writing helpers `tests/helpers/db.ts` does not have yet, plus the two
 * assertion shapes WP2's tests use everywhere. WP3 and WP4 build on the same
 * fixtures (`docs/BACKEND.md` §12, "Order"), so they live here rather than being
 * copied into four test files.
 *
 * **This file imports no service module, on purpose.** See the note below.
 *
 * ---
 *
 * ## The `vi.mock('server/services/contracts')` ordering rule
 *
 * `contracts.ts` is the seam between the work packages (§12), and WP2 wired its
 * five functions into it as re-exports — so `contracts.ts` imports
 * `cash/settlements/shifts/summaries` **and those four import `contracts` back**.
 * That cycle is inherent to the design, and it makes module mocking
 * order-sensitive in a way that costs an hour to rediscover:
 *
 * When a test mocks `contracts` with a factory that calls `importOriginal()`,
 * the factory runs the first time *any* module imports `contracts`. At that
 * moment the module that triggered it is mid-load and picks up the **mocked**
 * bindings; every other service module is pulled in fresh by `importOriginal()`
 * and picks up the **real** ones — so `log` and `verifyPinMetered` run for real
 * there. Before WP1 and WP5 merged that showed up as a `NOT_IMPLEMENTED` throw,
 * which was at least loud; now it is a silent second graph writing real rows,
 * which is worse. The rule below is the same either way.
 *
 * Two rules follow, and they are all a test needs:
 *
 *   1. Import the service module whose *writes* you are testing **first**, with
 *      a dynamic `await import(...)` after the `vi.mock` call, and import
 *      `contracts` itself **last**.
 *   2. Within one test file, drive mutations through that one module. Other
 *      modules' reads are safe — every read path in WP2 uses only `getSettings`
 *      from `contracts`, which is real in both graphs.
 *
 * `rawClose` below exists for exactly this: a settlement test needs a closed
 * shift without calling `shifts.ts`'s `closeShift`, whose `log` would be the
 * unmocked one.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { expect } from 'vitest'
import * as schema from '../../server/database/schema'
import type { Fixture } from './db'
import type { SankError } from '../../server/utils/errors'

/**
 * Assert on the error **code**, not on the sentence. The code is the stable
 * contract the phone branches on; the message is developer-facing English that
 * anybody may reword without breaking a screen.
 */
export function refuses(fn: () => unknown, code: string, status?: number): void {
  try {
    fn()
  } catch (err) {
    expect((err as SankError).code).toBe(code)
    if (status !== undefined) expect((err as SankError).status).toBe(status)
    return
  }
  throw new Error(`expected ${code}, but nothing was thrown`)
}

/** Every `*_fen` key anywhere in a response, however deep — the blindness check. */
export function fenKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) fenKeys(item, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key.endsWith('_fen')) out.push(key)
      fenKeys(child, out)
    }
  }
  return out
}

/** The guest paid and left: `open → paid`, which is all the trigger allows. */
export function closeTab(f: Fixture, tabId: string, by: string): void {
  f.db.update(schema.tabs)
    .set({ status: 'paid', closedAt: f.clock.now(), closedBy: f.userId(by) })
    .where(eq(schema.tabs.id, tabId))
    .run()
}

/**
 * *Nije plaćeno*, waiting for the owner's decision — the columns
 * `expectedCash`'s third term reads (`status`, `pending_review`, `unpaid_by`).
 */
export function markUnpaid(f: Fixture, tabId: string, by: string): void {
  f.db.update(schema.tabs)
    .set({
      status: 'unpaid',
      pendingReview: 1,
      unpaidBy: f.userId(by),
      unpaidReason: 'walked_out',
      closedAt: f.clock.now(),
      closedBy: f.userId(by),
    })
    .where(eq(schema.tabs.id, tabId))
    .run()
}

/**
 * A round written with columns `f.lock` cannot produce.
 *
 * `f.lock` cannot be used and then patched: `orders` and `order_lines` are both
 * append-only, so `post_settle` on the order and `comp_reason` / a zero
 * `charged_fen` on the line have to be there at insert.
 */
export function lockRow(
  f: Fixture, name: string, table: string, product: string,
  opts: { qty?: number, postSettle?: boolean, compReason?: string } = {},
): { tabId: string, orderId: string, lineId: string, chargedFen: number } {
  const qty = opts.qty ?? 1
  const at = f.clock.now()
  const uid = f.userId(name)
  const shiftId = f.db.select({ id: schema.shifts.id }).from(schema.shifts)
    .where(and(
      eq(schema.shifts.venueId, f.venueId),
      eq(schema.shifts.status, 'open'),
    ))
    .get()!.id

  const row = f.db.select().from(schema.products)
    .where(and(eq(schema.products.venueId, f.venueId), eq(schema.products.name, product)))
    .get()!

  const tabId = randomUUID()
  f.db.insert(schema.tabs).values({
    id: tabId, venueId: f.venueId, tableId: f.tableId(table), clientId: randomUUID(),
    status: 'open', shiftId, openedBy: uid, openedAt: at, assignedTo: uid,
  }).run()

  const seq = (f.db.select({ max: sql<number | null>`max(${schema.orders.shiftSeq})` })
    .from(schema.orders)
    .where(and(eq(schema.orders.venueId, f.venueId), eq(schema.orders.shiftId, shiftId)))
    .get()?.max ?? 0) + 1

  const orderId = randomUUID()
  f.db.insert(schema.orders).values({
    id: orderId, venueId: f.venueId, tabId, clientId: randomUUID(), shiftId, shiftSeq: seq,
    lockedBy: uid, postSettle: opts.postSettle ? 1 : 0,
    lateSync: opts.postSettle ? 1 : 0, createdAt: at,
  }).run()

  const lineId = randomUUID()
  // A line locked free is charged nothing — promet never sees it — and carries
  // the reason plus who authorised it.
  const chargedFen = opts.compReason ? 0 : row.priceFen * qty
  f.db.insert(schema.orderLines).values({
    id: lineId, venueId: f.venueId, orderId, productId: row.id, nameSnapshot: row.name,
    qty, unitPriceFen: row.priceFen, chargedFen,
    compReason: opts.compReason ?? null,
    authorisedBy: opts.compReason ? f.userId('Emir') : null,
  }).run()

  return { tabId, orderId, lineId, chargedFen }
}

/** A round locked **after** its waiter had already settled. */
export function lockPostSettle(
  f: Fixture, name: string, table: string, product: string, qty = 1,
) {
  return lockRow(f, name, table, product, { qty, postSettle: true })
}

/** *Na račun kuće*: locked at zero with a `comp_reason`. */
export function lockComped(
  f: Fixture, name: string, table: string, product: string, reason = 'staff_drink',
) {
  return lockRow(f, name, table, product, { compReason: reason })
}

/**
 * Close a shift by writing the row, not by calling `closeShift`.
 *
 * A settlement test needs a *closed* shift to prove the late path, and calling
 * WP2's own close from a file whose mock is bound to `settlements.ts` would run
 * the unmocked `verifyPinMetered` (see the ordering rule at the top).
 */
export function rawClose(
  f: Fixture, shiftId: string, opts: { countedFen?: number | null, by?: string } = {},
): void {
  const at = f.clock.now()
  f.db.update(schema.shifts)
    .set({
      status: 'closed',
      closedAt: at,
      closedBy: f.userId(opts.by ?? 'Haris'),
      closedKind: 'normal',
      cashCountedFen: opts.countedFen ?? null,
    })
    .where(eq(schema.shifts.id, shiftId))
    .run()
}

/** The venue's money, split two ways, must add up. Returns the venue total. */
export function expectReconciled(
  ec: { venue_expected_fen: number, drawer_expected_fen: number,
    waiters: { expected_fen: number }[] },
): number {
  const sum = ec.waiters.reduce((n, w) => n + w.expected_fen, ec.drawer_expected_fen)
  expect(ec.venue_expected_fen).toBe(sum)
  return ec.venue_expected_fen
}

export { schema }
