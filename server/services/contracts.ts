/**
 * The seam between the work packages.
 *
 * Eight packages are written in parallel against one schema (docs/BACKEND.md
 * §12), and every one of them calls into the others: a lock needs a shift (WP2)
 * and a stock movement (WP4); a close needs `expectedCash` (WP2) and `log` (WP5).
 * If each package imported the others' service files directly, none of them
 * could run a test until all of them existed.
 *
 * So they all import from **here**, and this file has two halves:
 *
 *   **Real, and staying real.** Five helpers WP0 implements properly, because
 *   WP0's own tests walk them the moment the new triggers exist: a
 *   `orders_shift_required` trigger with no `ensureOpenShift` behind it is a
 *   database that refuses every order. WP2/WP3/WP4 extend these in place —
 *   summaries, logging, custodians — rather than replacing the call sites.
 *
 *   **Typed stubs.** Everything else throws `NOT_IMPLEMENTED` with a real
 *   signature, so a package written against it compiles and typechecks today
 *   and starts working the day its owner lands the implementation. None of them
 *   is on a path any WP0 test walks.
 *
 * When a package lands, it replaces the stub body here with a re-export of its
 * own service — one line changed, no caller touched.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { SankError } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { businessDate, localDate, localTime } from '#shared/dates'
import { mergeSettings, type Settings } from '#shared/settings'
import { log } from './log'
import type { Actor, Role } from '#shared/types'
import type { Queryable, Tx } from './types'

type ShiftRow = typeof schema.shifts.$inferSelect

function notImplemented(what: string): never {
  throw new SankError(
    501,
    'NOT_IMPLEMENTED',
    `${what}: this work package has not landed yet (docs/BACKEND.md §12)`,
  )
}

// ===========================================================================
// Real — WP0 implements these because its own tests need them
// ===========================================================================

/**
 * The venue's settings: `DEFAULT_SETTINGS` with the owner's overrides on top.
 *
 * No service parses `settings_json` itself, and nothing anywhere reads a raw
 * key — a setting nobody has touched must read as its documented default and
 * not as `undefined`.
 */
export function getSettings(q: Queryable, venueId: string): Settings {
  const row = q.select({ json: schema.venues.settingsJson })
    .from(schema.venues)
    .where(eq(schema.venues.id, venueId))
    .get()
  return mergeSettings(row?.json)
}

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

/** The shift that is taking money right now, if any. */
export function currentShift(q: Queryable, venueId: string): ShiftRow | null {
  return q.select().from(schema.shifts)
    .where(and(
      eq(schema.shifts.venueId, venueId),
      inArray(schema.shifts.status, ['open', 'closing']),
    ))
    .get() ?? null
}

/**
 * Put somebody on the shift. `INSERT … ON CONFLICT DO NOTHING`, because every
 * service that writes money or stock calls this and only the first one should
 * write a row. `role` is a snapshot: a bartender promoted next month keeps his
 * old shifts' lines exactly as they were.
 */
export function joinShift(
  tx: Tx, venueId: string, shiftId: string, userId: string, role: Role, at: string,
): void {
  tx.insert(schema.shiftMembers).values({
    id: newId(), venueId, shiftId, userId, role, joinedAt: at, leftAt: null, leftAtSource: null,
  }).onConflictDoNothing().run()
}

/**
 * The currently open shift, opening one if there is none — the "first lock of
 * the evening opens the night" rule. Also how an opening count opens a shift.
 *
 * A plain select-or-insert with no retry: better-sqlite3 is synchronous and
 * there is one Node process, so two first locks cannot both see "no open
 * shift". `shifts_one_open_uq` stays as belt and braces, proven by a raw-SQL
 * refusal test rather than by a catch-and-retry helper nothing could cover.
 *
 * `clientAt` only decides the **business date** of a shift this call is itself
 * creating — a round queued at 02:30 opens the previous night, not a new one.
 * It never redirects a round to a past shift: the answer is always the shift
 * that is open now.
 *
 * **The `shift_opened` entry is written here, not by the caller** (§8: the kind's
 * trigger is "`ensureOpenShift` creates a shift, from a first lock or an opening
 * count"). WP0 could not write it because `log` was a stub and WP2 left it out
 * for the same reason; WP5's `log` is real now, so it is here — `auto: true`,
 * because a shift born this way was opened by somebody serving a table, not by
 * somebody tapping *Otvori smjenu*. `shifts.ts`'s explicit `openShift` writes
 * its own entry with `auto: false` and never comes through this function.
 *
 * `setCustodian` stays with its callers: the custodian of the stock is whoever
 * submitted the opening count (§6.8), which is WP4's business and not every
 * first lock's.
 */
export function ensureOpenShift(
  tx: Tx, venueId: string, actor: Actor, at: string, clientAt?: string,
): { shift: ShiftRow, created: boolean } {
  const settings = getSettings(tx, venueId)

  const open = currentShift(tx, venueId)
  if (open) {
    joinShift(tx, venueId, open.id, actor.userId, actor.role, at)
    return { shift: open, created: false }
  }

  const id = newId()
  tx.insert(schema.shifts).values({
    id,
    venueId,
    businessDate: businessDate(clientAt ?? at, settings.timezone, settings.business_day_start_hour),
    openedAt: at,
    openedBy: actor.userId,
    autoOpened: 1,
    status: 'open',
    createdAt: at,
  }).run()

  const shift = tx.select().from(schema.shifts).where(eq(schema.shifts.id, id)).get()!
  joinShift(tx, venueId, id, actor.userId, actor.role, at)

  log(tx, venueId, {
    kind: 'shift_opened',
    body: { shift_id: id, user_id: actor.userId, at, auto: true },
    actorId: actor.userId,
    deviceId: actor.deviceId,
    ref: { type: 'shift', id },
    shiftId: id,
  })

  return { shift, created: true }
}

/** "12. tura" — the round's number within its shift. */
export function nextShiftSeq(tx: Tx, venueId: string, shiftId: string): number {
  const row = tx.select({ max: sql<number | null>`max(${schema.orders.shiftSeq})` })
    .from(schema.orders)
    .where(and(eq(schema.orders.venueId, venueId), eq(schema.orders.shiftId, shiftId)))
    .get()
  return (row?.max ?? 0) + 1
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

// ===========================================================================
// Typed stubs — the signature is the contract; the body lands with its package
// ===========================================================================

/**
 * WP5 (`services/log.ts`). Writes one Dnevnik entry inside the caller's
 * transaction.
 *
 * Imported rather than re-exported straight through, because `ensureOpenShift`
 * above calls it: a bare `export … from` gives this module no local binding.
 * `log.ts` imports `getSettings` back out of here, which is the same cycle every
 * other line in this file lives with — safe, because nothing runs at load.
 */
export { log }

/** WP5 (`services/changes.ts`). One `changes` row; a mutation without one is a bug. */
export { bump } from './changes'

/** WP5 (`services/alerts.ts`). Dedupes on `(venue, rule, ref_type, ref_id)`. */
export { queueAlert } from './alerts'

/**
 * §12 gives the heartbeat **service** to WP1 and the **route** to WP5, and both
 * branches wrote a body for it — WP5 in `services/heartbeat.ts` (because
 * creating `services/devices.ts` on its branch is the merge conflict §12 exists
 * to prevent), WP1 inside `services/devices.ts`. The integration keeps WP5's:
 * it is the tested one (`tests/unit/heartbeat.test.ts`), and it is the only one
 * that dedupes the nightly `clock_skew` entry on `hasEntryFor`, reports
 * `revoked`, and emits on the bus. WP1's copy is gone;
 * `api/devices/heartbeat.post.ts` still imports through this line.
 */
export { heartbeat } from './heartbeat'

/** WP2 (`services/cash.ts`). The reconciliation: venue = drawer + Σ waiters. */
export { expectedCash } from './cash'

/** WP2. Has this person already settled this shift? A later lock is `post_settle`. */
export { hasLiveSettlement } from './settlements'

/**
 * §6.6's one outbox check: refuses while a phone still holds rounds.
 *
 * Two branches touched this line and agreed. WP2 corrected the **signature** —
 * an `opts.userId` (a settle looks at one person's phones, a count at every
 * phone in the shift) and stale devices *returned* rather than thrown, so a
 * phone switched off in a drawer is reported instead of blocking an envelope —
 * and left the body a stub, because §6.6 puts the implementation in
 * `services/devices.ts` beside the `devices.pending_count` column it reads, and
 * that file is WP1's. WP1 then wrote exactly that body, widened to the same
 * signature. There is one signature and it is the one `settle` calls; the stub
 * is gone.
 */
export { assertNoPendingOutbox } from './devices'

/** WP2. The custodian of the stock for this shift. */
export { setCustodian } from './shifts'

/** WP2. Does this shift have a submitted count of that phase? Blocks the close. */
export { hasSubmittedCount } from './shifts'

/** WP2. A new `shift_summaries` version: 'close', 'decision' or 'late'. */
export { writeSummaryVersion } from './summaries'

/** WP1 (`services/auth.ts`). Takes `Db`, not `Tx`: it owns its own attempt rows. */
export { verifyPinMetered } from './auth'

/** WP3 (`services/payments.ts`). Which shift a payment belongs to. */
export function resolvePaymentShift(
  _tx: Tx, _venueId: string, _tabId: string, _at: string,
): string {
  return notImplemented('resolvePaymentShift')
}

/**
 * WP3. A negative payment row plus its `cash_movements(type='refund')` twin.
 *
 * **For WP3:** the `cash_movements` half already exists — WP2 shipped
 * `insertRefund(tx, venueId, actor, shiftId, { amountFen, adjustmentId?, note?, at })`
 * in `services/cash.ts`, which is §6.5's signature and not this stub's. WP3
 * writes the payment row, calls that, and replaces this line with its own
 * re-export; the two names collide only here, and only until it does.
 */
export function insertRefund(_tx: Tx, _venueId: string, _r: {
  tabId: string
  amountFen: number
  method: 'cash' | 'card'
  approvedBy: string
  adjustmentId?: string
  refundKind: 'none' | 'from_waiter' | 'from_drawer'
  at: string
}): string {
  return notImplemented('insertRefund')
}
