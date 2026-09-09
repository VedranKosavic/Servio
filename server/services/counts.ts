/**
 * *Popis* — the count (`docs/BACKEND.md` §6.8).
 *
 * Two states and no more: a count is **submitted** by whoever counted, and
 * **confirmed** by the owner. There is no server-side draft in Korak 2 (§14.5) —
 * the phone keeps the in-progress count in IndexedDB exactly like the cart — and
 * no witness route, though the columns are there for Korak 3.
 *
 * The one idea worth reading twice is **theoretical by `occurred_at`**. What the
 * count compares against is not "on hand right now" but "what the ledger says was
 * on the shelf at the moment the count was submitted". A round that happened at
 * 23:40 and reached the server at 01:15 was physically off the shelf at midnight,
 * so it belongs inside the midnight count — and the count must not turn into
 * shrinkage because a phone was in a pocket. That is why `submitCount` snapshots
 * `theoretical_qty` at `submitted_at`, why `confirmCount` recomputes the same
 * bound (picking up rounds that synced in between, reported as `late_delta`), and
 * why every `count_adjust` is written at `occurred_at = submitted_at`.
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { conflict, notFound, unprocessable } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import type {
  ConfirmCountBody, ConfirmResult, ConfirmResultLine, CountLineView, CountView, PendingCount,
  StaleDevice, SubmitCountBody,
} from '#shared/types'
import type { Actor } from '#shared/types'
import type { Db, Queryable, Tx } from './types'
import {
  assertNoPendingOutbox, bump, currentShift, ensureOpenShift, insertMovement, joinShift, log,
  setCustodian,
} from './contracts'
import { theoreticalAt, unitCost, valueFen } from './stock'

type CountRow = typeof schema.stockCounts.$inferSelect

// ===========================================================================
// Submit
// ===========================================================================

/**
 * `POST /api/stock/counts` — creates **and** submits, in one transaction.
 *
 * It resolves the shift itself rather than demanding one. F1 step 3 wants the
 * opening count to be possible before the first round is locked ("a šanker who
 * submits the opening count before any lock gets his row from that count"), so
 * requiring `POST /api/shifts/open` first would make the very first tap of the
 * night an error.
 */
export function submitCount(
  db: Db, venueId: string, actor: Actor, body: SubmitCountBody, now = nowIso(),
): CountView {
  const countId = db.transaction((tx) => {
    const shiftId = resolveShift(tx, venueId, actor, body.phase, now)

    // A round still sitting in a phone's outbox would land *after* the count and
    // be read as shrinkage. Stale phones are reported, never blocking (§6.6).
    const stale = assertNoPendingOutbox(tx, venueId, shiftId, {
      actor, override: body.override,
    }, now)

    if (body.kind === 'spot') assertEverySpotItem(tx, venueId, body)

    const id = newId()
    const overrideBy = body.override && actor.role === 'admin' ? actor.userId : null

    try {
      tx.insert(schema.stockCounts).values({
        id,
        venueId,
        kind: body.kind,
        phase: body.phase,
        shiftId,
        status: 'submitted',
        countedBy: actor.userId,
        overrideBy,
        submittedAt: now,
        note: body.note ?? null,
      }).run()
    } catch (err) {
      // `stock_counts_shift_phase_uq` — a shift has at most one opening and one
      // closing count. Catching the constraint beats a pre-check that races.
      const existing = tx.select({ id: schema.stockCounts.id }).from(schema.stockCounts)
        .where(and(
          eq(schema.stockCounts.venueId, venueId),
          shiftId === null
            ? sql`${schema.stockCounts.shiftId} IS NULL`
            : eq(schema.stockCounts.shiftId, shiftId),
          eq(schema.stockCounts.phase, body.phase),
        ))
        .get()
      if (existing) {
        throw conflict('COUNT_EXISTS', `this shift already has a ${body.phase} count`)
      }
      throw err
    }

    const needNote: string[] = []

    for (const line of body.lines) {
      const item = tx.select().from(schema.stockItems)
        .where(and(
          eq(schema.stockItems.venueId, venueId),
          eq(schema.stockItems.id, line.stock_item_id),
        ))
        .get()
      if (!item) {
        throw notFound('STOCK_ITEM_NOT_FOUND', `stock item ${line.stock_item_id} not found`)
      }

      // A scale weighs the tin, not the tobacco: gross grams less the tare.
      // Clamped at zero, because a tare typed larger than the weight is a typo,
      // not minus forty grams of tobacco.
      const countedQty = item.countMethod === 'weigh'
        ? Math.max(0, (line.weighed_g ?? 0) - (item.tareG ?? 0))
        : Math.max(0, (line.packs ?? 0) * (item.packQty ?? 0) + (line.loose ?? 0))

      const theoretical = theoreticalAt(tx, venueId, item.id, now)
      const variance = countedQty - theoretical
      const cost = unitCost(item)

      if (Math.abs(variance) > item.toleranceQty && !line.note) needNote.push(item.id)

      tx.insert(schema.stockCountLines).values({
        id: newId(),
        venueId,
        countId: id,
        stockItemId: item.id,
        countedPacks: item.countMethod === 'weigh' ? null : (line.packs ?? 0),
        countedLoose: item.countMethod === 'weigh' ? null : (line.loose ?? 0),
        weighedG: item.countMethod === 'weigh' ? (line.weighed_g ?? 0) : null,
        countedQty,
        theoreticalQty: theoretical,
        varianceQty: variance,
        unitCostMfen: cost.mfen,
        varianceFen: valueFen(variance, cost.mfen),
        appliedAdjust: null,
        note: line.note ?? null,
      }).run()
    }

    if (needNote.length > 0) {
      throw unprocessable(
        'NOTE_REQUIRED', 'a line beyond tolerance needs a note', { item_ids: needNote },
      )
    }

    // Whoever submits the opening count answers for the stock this shift.
    if (body.phase === 'open' && shiftId) setCustodian(tx, venueId, shiftId, actor.userId)

    const totals = countTotals(tx, venueId, id)
    log(tx, venueId, {
      kind: 'count_submitted',
      body: { count_id: id, items: totals.lines, out_of_tolerance: totals.out_of_tolerance },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'stock_count', id },
      shiftId,
      at: now,
    })

    bump(tx, venueId, 'count', id)
    bump(tx, venueId, 'stock')

    return { id, stale }
  })

  return { ...getCount(db, venueId, countId.id), stale_devices: countId.stale }
}

/**
 * Which shift this count belongs to (§6.8's table).
 *
 * `open` creates one if there is none — writing `shift_opened` exactly as a first
 * lock does. `close` refuses without one: there is nothing to close against.
 * `adhoc` takes whatever is open, and is content with nothing — a spot count on
 * a quiet afternoon is still a count.
 */
function resolveShift(
  tx: Tx, venueId: string, actor: Actor, phase: SubmitCountBody['phase'], at: string,
): string | null {
  if (phase === 'open') {
    const { shift } = ensureOpenShift(tx, venueId, actor, at)
    return shift.id
  }

  const open = currentShift(tx, venueId)
  if (phase === 'close') {
    if (!open) throw conflict('NO_OPEN_SHIFT', 'there is no open shift to count against')
    joinShift(tx, venueId, open.id, actor.userId, actor.role, at)
    return open.id
  }

  if (open) joinShift(tx, venueId, open.id, actor.userId, actor.role, at)
  return open?.id ?? null
}

/**
 * A *spot* count is the short list everybody agreed to count every night. Half a
 * spot count is not a count — the items left out silently keep their theoretical
 * quantity and the variance report reads clean.
 */
function assertEverySpotItem(tx: Tx, venueId: string, body: SubmitCountBody): void {
  const required = tx.select({ id: schema.stockItems.id }).from(schema.stockItems)
    .where(and(
      eq(schema.stockItems.venueId, venueId),
      eq(schema.stockItems.isSpot, 1),
      eq(schema.stockItems.active, 1),
    ))
    .all()
    .map(r => r.id)

  const present = new Set(body.lines.map(l => l.stock_item_id))
  const missing = required.filter(id => !present.has(id))
  if (missing.length > 0) {
    throw unprocessable('LINES_MISSING', 'a spot count must carry every spot item', {
      item_ids: missing,
    })
  }
}

// ===========================================================================
// Confirm
// ===========================================================================

/**
 * `POST /api/stock/counts/:id/confirm` — the admin signs the variance and the
 * ledger moves.
 *
 * The adjustment is **recomputed** rather than read off the submitted line:
 * rounds that synced between submit and confirm are inside the same
 * `theoreticalAt(submitted_at)` bound, so a phone that flushed at 03:05 changes
 * what the count adjusts and `late_delta` says by how much.
 */
export function confirmCount(
  db: Db, venueId: string, actor: Actor, countId: string, body: ConfirmCountBody,
  now = nowIso(),
): ConfirmResult {
  const lines = db.transaction((tx) => {
    const count = requireCount(tx, venueId, countId)
    if (count.status === 'confirmed') {
      throw conflict('COUNT_ALREADY_CONFIRMED', `count ${countId} is already confirmed`)
    }

    // Confirm is the one that writes the adjustment, so it is the one that most
    // needs the outbox empty (F9 step 2).
    assertNoPendingOutbox(tx, venueId, count.shiftId, {
      actor, override: body.override,
    }, now)

    const rows = tx.select({ line: schema.stockCountLines, item: schema.stockItems })
      .from(schema.stockCountLines)
      .innerJoin(schema.stockItems, eq(schema.stockItems.id, schema.stockCountLines.stockItemId))
      .where(and(
        eq(schema.stockCountLines.venueId, venueId),
        eq(schema.stockCountLines.countId, countId),
      ))
      .all()

    // Confirming a variance you cannot price is exactly the moment to stop: the
    // adjustment would be written and valued at 0,00 KM, and the whole report
    // that follows would read as if nothing went missing.
    const unpriced = rows
      .filter(r => Math.abs(r.line.varianceQty) > r.item.toleranceQty && r.line.unitCostMfen === 0)
      .map(r => r.item.id)
    if (unpriced.length > 0) {
      throw unprocessable('PRICE_MISSING', 'a variance cannot be priced', { item_ids: unpriced })
    }

    const out: ConfirmResultLine[] = []
    let adjustedItems = 0

    for (const { line, item } of rows) {
      const theoretical = theoreticalAt(tx, venueId, item.id, count.submittedAt)
      const adjust = line.countedQty - theoretical

      if (adjust !== 0) {
        insertMovement(tx, venueId, {
          stockItemId: item.id,
          type: 'count_adjust',
          qtyDelta: adjust,
          unitCostMfen: line.unitCostMfen,
          refType: 'stock_count_line',
          refId: line.id,
          userId: actor.userId,
          shiftId: count.shiftId,
          note: line.note,
          occurredAt: count.submittedAt,
          createdAt: now,
        })
        adjustedItems += 1
      }

      // Written on every line, zero included: `null` means "not confirmed yet",
      // `0` means "confirmed, and the shelf was right". The trigger allows the
      // column to move from NULL to a value exactly once, which is what this is.
      tx.update(schema.stockCountLines)
        .set({ appliedAdjust: adjust })
        .where(eq(schema.stockCountLines.id, line.id))
        .run()

      out.push({
        stock_item_id: item.id,
        item_name: item.name,
        submitted_variance: line.varianceQty,
        applied_adjust: adjust,
        late_delta: adjust - line.varianceQty,
      })
    }

    tx.update(schema.stockCounts)
      .set({
        status: 'confirmed',
        confirmedBy: actor.userId,
        confirmedAt: now,
        overrideBy: body.override && actor.role === 'admin' ? actor.userId : count.overrideBy,
        note: body.note ?? count.note,
      })
      .where(and(eq(schema.stockCounts.venueId, venueId), eq(schema.stockCounts.id, countId)))
      .run()

    const totals = countTotals(tx, venueId, countId)

    log(tx, venueId, {
      kind: 'count_confirmed',
      body: {
        count_id: countId,
        variance_fen: totals.variance_fen,
        adjusted_items: adjustedItems,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      // The alert dedupes on the count, not on the entry — one `stock_variance`
      // per count, however many times the screen is refreshed (§6.9).
      ref: { type: 'stock_count', id: countId },
      shiftId: count.shiftId,
      resolvesId: submittedEntryId(tx, venueId, countId),
      at: now,
    })

    bump(tx, venueId, 'count', countId)
    bump(tx, venueId, 'stock')

    return out
  })

  return { count: getCount(db, venueId, countId), lines }
}

/** The `count_submitted` entry this confirmation answers — the Dnevnik pairs them. */
function submittedEntryId(tx: Tx, venueId: string, countId: string): string | null {
  return tx.select({ id: schema.logEntries.id }).from(schema.logEntries)
    .where(and(
      eq(schema.logEntries.venueId, venueId),
      eq(schema.logEntries.kind, 'count_submitted'),
      eq(schema.logEntries.refType, 'stock_count'),
      eq(schema.logEntries.refId, countId),
    ))
    .get()?.id ?? null
}

// ===========================================================================
// Reads
// ===========================================================================

export function getCount(q: Queryable, venueId: string, countId: string): CountView {
  const count = requireCount(q, venueId, countId)
  return countView(q, venueId, count, [])
}

export function listCounts(
  q: Queryable, venueId: string,
  filter: { shiftId?: string, status?: 'submitted' | 'confirmed' } = {},
): CountView[] {
  const rows = q.select().from(schema.stockCounts)
    .where(and(
      eq(schema.stockCounts.venueId, venueId),
      filter.shiftId ? eq(schema.stockCounts.shiftId, filter.shiftId) : sql`1 = 1`,
      filter.status ? eq(schema.stockCounts.status, filter.status) : sql`1 = 1`,
    ))
    .orderBy(desc(schema.stockCounts.submittedAt))
    .limit(100)
    .all()

  return rows.map(row => countView(q, venueId, row, []))
}

/**
 * Counts waiting for an admin — WP7's *Puls* turns each of these into an
 * `AttentionItem` with the confirm route as its action (§6.10). It stays a plain
 * row shape here because `AttentionItem` is WP7's type and this package must not
 * define it.
 */
export function pendingCounts(q: Queryable, venueId: string): PendingCount[] {
  const rows = q.select({ c: schema.stockCounts, countedByName: schema.users.name })
    .from(schema.stockCounts)
    .innerJoin(schema.users, eq(schema.users.id, schema.stockCounts.countedBy))
    .where(and(
      eq(schema.stockCounts.venueId, venueId),
      eq(schema.stockCounts.status, 'submitted'),
    ))
    .orderBy(desc(schema.stockCounts.submittedAt))
    .all()

  return rows.map(({ c, countedByName }) => {
    const totals = countTotals(q, venueId, c.id)
    return {
      count_id: c.id,
      kind: c.kind,
      phase: c.phase,
      shift_id: c.shiftId,
      counted_by: c.countedBy,
      counted_by_name: countedByName,
      submitted_at: c.submittedAt,
      variance_fen: totals.variance_fen,
      out_of_tolerance: totals.out_of_tolerance,
    }
  })
}

function countView(
  q: Queryable, venueId: string, count: CountRow, stale: StaleDevice[],
): CountView {
  const names = new Map(
    q.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
      .where(eq(schema.users.venueId, venueId)).all().map(u => [u.id, u.name]),
  )

  const rows = q.select({ line: schema.stockCountLines, item: schema.stockItems })
    .from(schema.stockCountLines)
    .innerJoin(schema.stockItems, eq(schema.stockItems.id, schema.stockCountLines.stockItemId))
    .where(and(
      eq(schema.stockCountLines.venueId, venueId),
      eq(schema.stockCountLines.countId, count.id),
    ))
    .all()

  const lines: CountLineView[] = rows.map(({ line, item }) => ({
    id: line.id,
    stock_item_id: item.id,
    item_name: item.name,
    base_unit: item.baseUnit,
    counted_packs: line.countedPacks,
    counted_loose: line.countedLoose,
    weighed_g: line.weighedG,
    counted_qty: line.countedQty,
    theoretical_qty: line.theoreticalQty,
    variance_qty: line.varianceQty,
    unit_cost_mfen: line.unitCostMfen,
    variance_fen: line.varianceFen,
    // §6.8: `stock_count_lines` has no column for this — it is derived at read.
    // The line was priced by the fallback exactly when its snapshot cost equals
    // the item's last cost and the item still has no moving average.
    estimated: line.unitCostMfen === item.lastCostMfen && item.avgCostMfen === 0,
    out_of_tolerance: Math.abs(line.varianceQty) > item.toleranceQty,
    applied_adjust: line.appliedAdjust,
    note: line.note,
  }))

  return {
    id: count.id,
    kind: count.kind,
    phase: count.phase,
    shift_id: count.shiftId,
    status: count.status,
    counted_by: count.countedBy,
    counted_by_name: names.get(count.countedBy) ?? '',
    submitted_at: count.submittedAt,
    confirmed_by: count.confirmedBy,
    confirmed_by_name: count.confirmedBy ? names.get(count.confirmedBy) ?? '' : null,
    confirmed_at: count.confirmedAt,
    override_by: count.overrideBy,
    note: count.note,
    lines,
    totals: {
      lines: lines.length,
      out_of_tolerance: lines.filter(l => l.out_of_tolerance).length,
      variance_fen: lines.reduce((sum, l) => sum + l.variance_fen, 0),
    },
    stale_devices: stale,
  }
}

function countTotals(
  q: Queryable, venueId: string, countId: string,
): { lines: number, out_of_tolerance: number, variance_fen: number } {
  const rows = q.select({
    varianceQty: schema.stockCountLines.varianceQty,
    varianceFen: schema.stockCountLines.varianceFen,
    toleranceQty: schema.stockItems.toleranceQty,
  })
    .from(schema.stockCountLines)
    .innerJoin(schema.stockItems, eq(schema.stockItems.id, schema.stockCountLines.stockItemId))
    .where(and(
      eq(schema.stockCountLines.venueId, venueId),
      eq(schema.stockCountLines.countId, countId),
    ))
    .all()

  return {
    lines: rows.length,
    out_of_tolerance: rows.filter(r => Math.abs(r.varianceQty) > r.toleranceQty).length,
    variance_fen: rows.reduce((sum, r) => sum + r.varianceFen, 0),
  }
}

function requireCount(q: Queryable, venueId: string, countId: string): CountRow {
  const row = q.select().from(schema.stockCounts)
    .where(and(eq(schema.stockCounts.venueId, venueId), eq(schema.stockCounts.id, countId)))
    .get()
  if (!row) throw notFound('COUNT_NOT_FOUND', `count ${countId} not found`)
  return row
}
