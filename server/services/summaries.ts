/**
 * What the night added up to — per person, per category, and versioned.
 *
 * Three rules shape this file.
 *
 * **One read, three answers.** `summarizeUser`, `summarizeShift` and `shiftLines`
 * all start from `loadLines()`, one query over the shift's order lines with the
 * live adjustment attached. That is not a performance trick, it is the
 * reconciliation: because the per-user total, the per-category total and the
 * shift total are three foldings of the *same array*, they cannot disagree, and
 * `summarizeShift` asserts exactly that before it returns —
 * `Σ by_user.promet_fen === Σ by_category.fen === promet_fen`, or a 500. The
 * check runs at write time, not only in a test.
 *
 * **Promet is charged minus applied voids.** A void unwinds a sale that never
 * should have been rung up, so it leaves the turnover. A *gratis* does not: the
 * café decided to give something away and the decision is worth seeing on the
 * same row as the takings, which is why `gratis` is its own pair of numbers
 * beside promet rather than quietly deducted from it (`docs/BACKEND.md` §6.7).
 *
 * **A summary is a row, never an edit.** `shift_summaries` is append-only, keyed
 * `(shift_id, version)`. Closing writes v1; every later decision that moves money
 * writes another. "What did the summary say when we closed?" is then a `SELECT`
 * and not a reconstruction.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { SankError } from '../utils/errors'
import { nowIso } from '../utils/ids'
import { countBowls } from '#shared/bowls'
import type {
  CategoryLine, CountFen, LineRow, LineStatus, LineTotals, LinesPage, MyShift, MyShiftRow,
  OwnerShift, ShiftCountBrief, ShiftSummary, StornoTotals, SummaryReason, UserSummary,
} from '#shared/types'
import type { Queryable, Tx } from './types'
import { expectedCash, listCashMovements, toleranceFen, withinTolerance } from './cash'
import { getSettings } from './contracts'
import { requireShift, shiftBriefFor, shiftView, userNames } from './shifts'
import { listSettlements } from './settlements'

// ===========================================================================
// The one read everything folds
// ===========================================================================

interface LedgerLine {
  lineId: string
  orderId: string
  tabId: string
  tabStatus: 'open' | 'paid' | 'unpaid' | 'voided'
  lockedBy: string
  at: string
  arrivedAt: string
  syncLagS: number
  lateSync: boolean
  shiftSeq: number
  postSettle: boolean
  tableName: string
  nameSnapshot: string
  note: string | null
  flavourIds: string[]
  qty: number
  unitPriceFen: number
  chargedFen: number
  compReason: string | null
  parentLineId: string | null
  categoryId: string
  productKind: 'simple' | 'shisha'
  /** The one live (`pending`/`applied`) adjustment, if any — the index says one. */
  adjId: string | null
  adjKind: 'void' | 'comp' | null
  adjStatus: 'pending' | 'applied' | 'rejected' | null
  adjAmountFen: number
  adjAuto: boolean
  adjRequestedBy: string | null
  adjApprovedBy: string | null
}

/**
 * Every line of the shift with its live adjustment.
 *
 * `line_adjustments_line_uq` is a partial unique index on
 * `status IN ('pending','applied')`, so joining on that condition can attach at
 * most one row per line — no `GROUP BY`, no "the newest one" guessing, and a
 * rejected void correctly leaves the line looking like an ordinary sale.
 */
function loadLines(q: Queryable, venueId: string, shiftId: string): LedgerLine[] {
  const live = and(
    eq(schema.lineAdjustments.orderLineId, schema.orderLines.id),
    inArray(schema.lineAdjustments.status, ['pending', 'applied']),
  )

  const rows = q.select({
    lineId: schema.orderLines.id,
    orderId: schema.orders.id,
    tabId: schema.orders.tabId,
    tabStatus: schema.tabs.status,
    lockedBy: schema.orders.lockedBy,
    at: schema.orders.createdAt,
    clientAt: schema.orders.clientCreatedAtAdj,
    syncLagS: schema.orders.syncLagS,
    lateSync: schema.orders.lateSync,
    shiftSeq: schema.orders.shiftSeq,
    postSettle: schema.orders.postSettle,
    tableName: schema.tables.name,
    nameSnapshot: schema.orderLines.nameSnapshot,
    note: schema.orderLines.note,
    flavoursJson: schema.orderLines.flavoursJson,
    qty: schema.orderLines.qty,
    unitPriceFen: schema.orderLines.unitPriceFen,
    chargedFen: schema.orderLines.chargedFen,
    compReason: schema.orderLines.compReason,
    parentLineId: schema.orderLines.parentLineId,
    categoryId: schema.products.categoryId,
    productKind: schema.products.kind,
    adjId: schema.lineAdjustments.id,
    adjKind: schema.lineAdjustments.kind,
    adjStatus: schema.lineAdjustments.status,
    adjAmountFen: schema.lineAdjustments.amountFen,
    adjAuto: schema.lineAdjustments.auto,
    adjRequestedBy: schema.lineAdjustments.requestedBy,
    adjApprovedBy: schema.lineAdjustments.approvedBy,
  })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .innerJoin(schema.tabs, eq(schema.tabs.id, schema.orders.tabId))
    .innerJoin(schema.tables, eq(schema.tables.id, schema.tabs.tableId))
    .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId))
    .leftJoin(schema.lineAdjustments, live)
    .where(and(eq(schema.orders.venueId, venueId), eq(schema.orders.shiftId, shiftId)))
    .all()

  return rows.map(r => ({
    lineId: r.lineId,
    orderId: r.orderId,
    tabId: r.tabId,
    tabStatus: r.tabStatus,
    lockedBy: r.lockedBy,
    at: r.at,
    arrivedAt: r.clientAt ?? r.at,
    syncLagS: r.syncLagS,
    lateSync: r.lateSync === 1,
    shiftSeq: r.shiftSeq ?? 0,
    postSettle: r.postSettle === 1,
    tableName: r.tableName,
    nameSnapshot: r.nameSnapshot,
    note: r.note,
    flavourIds: parseIds(r.flavoursJson),
    qty: r.qty,
    unitPriceFen: r.unitPriceFen,
    chargedFen: r.chargedFen,
    compReason: r.compReason,
    parentLineId: r.parentLineId,
    categoryId: r.categoryId,
    productKind: r.productKind,
    adjId: r.adjId,
    adjKind: r.adjKind,
    adjStatus: r.adjStatus,
    adjAmountFen: r.adjAmountFen ?? 0,
    adjAuto: r.adjAuto === 1,
    adjRequestedBy: r.adjRequestedBy,
    adjApprovedBy: r.adjApprovedBy,
  }))
}

function parseIds(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** An applied void leaves the turnover; everything else stays on it (§6.7). */
function appliedVoidFen(line: LedgerLine): number {
  return line.adjKind === 'void' && line.adjStatus === 'applied' ? line.adjAmountFen : 0
}

/** What this line is worth to the promet, after any applied void. */
function prometOf(line: LedgerLine): number {
  return line.chargedFen - appliedVoidFen(line)
}

/**
 * What the café gave away on this line: a line locked free (`comp_reason`, so it
 * is already charged 0 and invisible to promet) valued at its list price, or an
 * applied comp on a line that was charged.
 */
function gratisOf(line: LedgerLine): number {
  if (line.compReason) return Math.round(line.unitPriceFen * line.qty)
  if (line.adjKind === 'comp' && line.adjStatus === 'applied') return line.adjAmountFen
  return 0
}

function isGratis(line: LedgerLine): boolean {
  return Boolean(line.compReason)
    || (line.adjKind === 'comp' && line.adjStatus === 'applied')
}

function categoryTotals(lines: LedgerLine[]): CategoryLine[] {
  const byCategory = new Map<string, CategoryLine>()
  for (const line of lines) {
    let row = byCategory.get(line.categoryId)
    if (!row) {
      row = { category_id: line.categoryId, qty: 0, fen: 0 }
      byCategory.set(line.categoryId, row)
    }
    row.qty += line.qty
    row.fen += prometOf(line)
  }
  return [...byCategory.values()].sort((a, b) => a.category_id.localeCompare(b.category_id))
}

// ===========================================================================
// summarizeUser
// ===========================================================================

/**
 * One person's night.
 *
 * `settle` is passed at the moment somebody settles, before the row exists; on
 * every later read the numbers come from the stored settlement instead. Both
 * paths fill the same four optional fields, so the *Smjena* strip renders the
 * same whether it is showing the reveal or last Tuesday.
 */
export function summarizeUser(
  q: Queryable, venueId: string, shiftId: string, userId: string, now: string,
  settle?: { declaredFen: number, expectedFen: number },
): UserSummary {
  const settings = getSettings(q, venueId)
  const names = userNames(q, venueId)
  const lines = loadLines(q, venueId, shiftId).filter(l => l.lockedBy === userId)

  const member = q.select().from(schema.shiftMembers)
    .where(and(
      eq(schema.shiftMembers.venueId, venueId),
      eq(schema.shiftMembers.shiftId, shiftId),
      eq(schema.shiftMembers.userId, userId),
    ))
    .get()

  const settlement = q.select().from(schema.waiterSettlements)
    .where(and(
      eq(schema.waiterSettlements.venueId, venueId),
      eq(schema.waiterSettlements.shiftId, shiftId),
      eq(schema.waiterSettlements.userId, userId),
    ))
    .get()

  const payments = q.select({
    method: schema.payments.method,
    fen: sql<number>`coalesce(sum(${schema.payments.amountFen}), 0)`,
  })
    .from(schema.payments)
    .where(and(
      eq(schema.payments.venueId, venueId),
      eq(schema.payments.shiftId, shiftId),
      eq(schema.payments.paidBy, userId),
    ))
    .groupBy(schema.payments.method)
    .all()

  const waste = q.select({
    n: sql<number>`count(*)`,
    fen: sql<number>`coalesce(sum(${schema.wasteEvents.costFen}), 0)`,
  })
    .from(schema.wasteEvents)
    .where(and(
      eq(schema.wasteEvents.venueId, venueId),
      eq(schema.wasteEvents.shiftId, shiftId),
      eq(schema.wasteEvents.userId, userId),
    ))
    .get()

  // `expectedCash` owns the two terms that are not derivable from the lines —
  // what the drawer handed him and what he is answerable for on an unpaid tab.
  // Reading them from there rather than re-querying is what keeps the settle
  // reveal and the shift summary telling the same story.
  const cash = expectedCash(q, venueId, shiftId, userId, now).waiters[0]

  const storno: StornoTotals = { count: 0, fen: 0, pending_count: 0, pending_fen: 0 }
  const selfVoids: CountFen = { count: 0, fen: 0 }
  const gratis: CountFen = { count: 0, fen: 0 }
  const postSettleLocks: CountFen = { count: 0, fen: 0 }
  let promet = 0
  const tabs = new Set<string>()
  const rounds = new Set<string>()
  const lateRounds = new Set<string>()

  for (const line of lines) {
    promet += prometOf(line)
    tabs.add(line.tabId)
    rounds.add(line.orderId)

    if (line.adjKind === 'void' && line.adjStatus === 'applied') {
      storno.count += 1
      storno.fen += line.adjAmountFen
      // A self-void is one a rule applied with no human in the loop: the same
      // person asked and "approved" it inside the 300 s window.
      if (line.adjAuto && line.adjRequestedBy === line.adjApprovedBy) {
        selfVoids.count += 1
        selfVoids.fen += line.adjAmountFen
      }
    }
    if (line.adjKind === 'void' && line.adjStatus === 'pending') {
      storno.pending_count += 1
      storno.pending_fen += line.adjAmountFen
    }
    if (isGratis(line)) {
      gratis.count += 1
      gratis.fen += gratisOf(line)
    }
    if (line.postSettle) {
      lateRounds.add(line.orderId)
      postSettleLocks.fen += line.chargedFen
    }
  }
  postSettleLocks.count = lateRounds.size

  const declared = settle?.declaredFen ?? settlement?.declaredFen
  const expected = settle?.expectedFen ?? settlement?.expectedAtDeclareFen
  const verdict = declared === undefined || expected === undefined
    ? {}
    : {
        expected_fen: expected,
        declared_fen: declared,
        tolerance_fen: toleranceFen(expected, settings),
        within_tolerance: withinTolerance(declared - expected, expected, settings),
      }

  return {
    user_id: userId,
    name: names.get(userId) ?? '—',
    joined_at: member?.joinedAt ?? null,
    settled_at: settlement?.createdAt ?? (settle ? now : null),
    hours: hoursBetween(member?.joinedAt ?? null, member?.leftAt ?? null, now),
    promet_fen: promet,
    unpaid_fen: cash?.unpaid_fen ?? 0,
    cash_fen: payments.find(p => p.method === 'cash')?.fen ?? 0,
    card_fen: payments.find(p => p.method === 'card')?.fen ?? 0,
    float_out_fen: cash?.float_out_fen ?? 0,
    tabs: tabs.size,
    rounds: rounds.size,
    bowls: countBowls(lines.map(l => ({
      kind: l.productKind, qty: l.qty, parent_line_id: l.parentLineId,
    }))),
    by_category: categoryTotals(lines),
    storno,
    self_voids: selfVoids,
    gratis,
    waste: { count: waste?.n ?? 0, fen: waste?.fen ?? 0 },
    post_settle_locks: postSettleLocks,
    ...verdict,
  }
}

function hoursBetween(from: string | null, to: string | null, now: string): number {
  if (!from) return 0
  const end = Date.parse(to ?? now)
  const hours = (end - Date.parse(from)) / 3_600_000
  return Math.max(0, Math.round(hours * 100) / 100)
}

// ===========================================================================
// summarizeShift
// ===========================================================================

/**
 * The whole night.
 *
 * `by_user` is over the union of the shift's members **and** everybody who
 * actually locked a round, took a payment or handed in an envelope on it. Over
 * members alone the three-way reconciliation would silently fail the day a row
 * reached the ledger without its `shift_members` line — and a summary that
 * quietly drops a waiter's promet is worse than one that refuses to be written.
 */
export function summarizeShift(
  q: Queryable, venueId: string, shiftId: string, now: string,
): ShiftSummary {
  const shift = requireShift(q, venueId, shiftId)
  const lines = loadLines(q, venueId, shiftId)
  const ec = expectedCash(q, venueId, shiftId, undefined, now)

  const users = new Set<string>()
  for (const row of q.select({ id: schema.shiftMembers.userId }).from(schema.shiftMembers)
    .where(and(
      eq(schema.shiftMembers.venueId, venueId),
      eq(schema.shiftMembers.shiftId, shiftId),
    ))
    .all()) users.add(row.id)
  for (const line of lines) users.add(line.lockedBy)
  for (const w of ec.waiters) users.add(w.user_id)

  const byUser = [...users]
    .map(id => summarizeUser(q, venueId, shiftId, id, now))
    .sort((a, b) => a.name.localeCompare(b.name, 'bs'))

  const byCategory = categoryTotals(lines)
  const promet = lines.reduce((sum, l) => sum + prometOf(l), 0)

  const payments = q.select({
    method: schema.payments.method,
    fen: sql<number>`coalesce(sum(${schema.payments.amountFen}), 0)`,
  })
    .from(schema.payments)
    .where(and(eq(schema.payments.venueId, venueId), eq(schema.payments.shiftId, shiftId)))
    .groupBy(schema.payments.method)
    .all()

  const waste = q.select({ fen: sql<number>`coalesce(sum(${schema.wasteEvents.costFen}), 0)` })
    .from(schema.wasteEvents)
    .where(and(eq(schema.wasteEvents.venueId, venueId), eq(schema.wasteEvents.shiftId, shiftId)))
    .get()

  // The closing count's money answer: what the shelf says is missing, priced.
  const variance = q.select({
    fen: sql<number>`coalesce(sum(${schema.stockCountLines.varianceFen}), 0)`,
  })
    .from(schema.stockCountLines)
    .innerJoin(schema.stockCounts, eq(schema.stockCounts.id, schema.stockCountLines.countId))
    .where(and(
      eq(schema.stockCounts.venueId, venueId),
      eq(schema.stockCounts.shiftId, shiftId),
      eq(schema.stockCounts.phase, 'close'),
      eq(schema.stockCounts.status, 'confirmed'),
    ))
    .get()

  // Tobacco and coal come from the stock ledger rather than from the menu: a
  // bowl's grams depend on the aromas chosen at the table, and a *Dodatni žar*
  // burns coal without being a bowl.
  const consumed = q.select({
    kind: schema.stockItems.kind,
    qty: sql<number>`coalesce(sum(${schema.stockMovements.qtyDelta}), 0)`,
  })
    .from(schema.stockMovements)
    .innerJoin(schema.stockItems, eq(schema.stockItems.id, schema.stockMovements.stockItemId))
    .where(and(
      eq(schema.stockMovements.venueId, venueId),
      eq(schema.stockMovements.shiftId, shiftId),
      inArray(schema.stockMovements.type, ['sale', 'sale_storno']),
    ))
    .groupBy(schema.stockItems.kind)
    .all()

  const expectedCashFen = ec.waiters.reduce(
    (sum, w) => (w.settled ? sum + w.expected_fen : sum),
    ec.drawer_expected_fen,
  )
  const outstanding = ec.waiters.reduce((sum, w) => (w.settled ? sum : sum + w.expected_fen), 0)
  const counted = shift.cashCountedFen

  const summary: ShiftSummary = {
    shift_id: shiftId,
    version: 0,
    reason: 'close',
    promet_fen: promet,
    cash_fen: payments.find(p => p.method === 'cash')?.fen ?? 0,
    card_fen: payments.find(p => p.method === 'card')?.fen ?? 0,
    comp_fen: lines.reduce((sum, l) => sum + gratisOf(l), 0),
    void_count: byUser.reduce((n, u) => n + u.storno.count, 0),
    void_fen: byUser.reduce((n, u) => n + u.storno.fen, 0),
    self_void_count: byUser.reduce((n, u) => n + u.self_voids.count, 0),
    self_void_fen: byUser.reduce((n, u) => n + u.self_voids.fen, 0),
    unpaid_fen: ec.waiters.reduce((n, w) => n + w.unpaid_fen, 0),
    expected_cash_fen: expectedCashFen,
    outstanding_fen: outstanding,
    counted_cash_fen: counted,
    diff_fen: counted === null ? null : counted - expectedCashFen,
    stock_variance_fen: variance?.fen ?? 0,
    waste_fen: waste?.fen ?? 0,
    bowls: countBowls(lines.map(l => ({
      kind: l.productKind, qty: l.qty, parent_line_id: l.parentLineId,
    }))),
    tobacco_g: -(consumed.find(c => c.kind === 'duhan')?.qty ?? 0),
    coals: Math.round(-(consumed.find(c => c.kind === 'zar')?.qty ?? 0)),
    by_category: byCategory,
    by_user: byUser,
    computed_at: now,
  }

  // The reconciliation, checked where it is written and not only in a test.
  const byUserPromet = byUser.reduce((sum, u) => sum + u.promet_fen, 0)
  const byCategoryPromet = byCategory.reduce((sum, c) => sum + c.fen, 0)
  if (byUserPromet !== promet || byCategoryPromet !== promet) {
    throw new SankError(500, 'SUMMARY_MISMATCH', 'the shift summary does not reconcile', {
      promet_fen: promet, by_user_fen: byUserPromet, by_category_fen: byCategoryPromet,
    })
  }

  return summary
}

/**
 * A new `shift_summaries` version. Called by the close, the force close, and
 * every later decision that moves money (a cash decision, a pickup, a late
 * settlement, an adjustment or unpaid decision). There is no nightly recompute
 * in Korak 2 — the version *is* the history.
 */
export function writeSummaryVersion(
  tx: Tx, venueId: string, shiftId: string, reason: SummaryReason, at: string,
): number {
  const summary = summarizeShift(tx, venueId, shiftId, at)

  const previous = tx.select({ v: sql<number | null>`max(${schema.shiftSummaries.version})` })
    .from(schema.shiftSummaries)
    .where(and(
      eq(schema.shiftSummaries.venueId, venueId),
      eq(schema.shiftSummaries.shiftId, shiftId),
    ))
    .get()
  const version = (previous?.v ?? 0) + 1

  tx.insert(schema.shiftSummaries).values({
    shiftId,
    venueId,
    version,
    reason,
    prometFen: summary.promet_fen,
    cashFen: summary.cash_fen,
    cardFen: summary.card_fen,
    compFen: summary.comp_fen,
    voidCount: summary.void_count,
    voidFen: summary.void_fen,
    selfVoidCount: summary.self_void_count,
    selfVoidFen: summary.self_void_fen,
    unpaidFen: summary.unpaid_fen,
    expectedCashFen: summary.expected_cash_fen,
    outstandingFen: summary.outstanding_fen,
    countedCashFen: summary.counted_cash_fen,
    diffFen: summary.diff_fen,
    stockVarianceFen: summary.stock_variance_fen,
    wasteFen: summary.waste_fen,
    bowls: summary.bowls,
    tobaccoG: summary.tobacco_g,
    coals: summary.coals,
    // Purely numeric JSON: names are joined at read, so renaming a person or a
    // category tomorrow does not rewrite what happened tonight (§3.2).
    byCategoryJson: JSON.stringify(summary.by_category.map(stripName)),
    byUserJson: JSON.stringify(summary.by_user.map(stripName)),
    computedAt: at,
  }).run()

  return version
}

function stripName<T extends { name?: string }>(row: T): Omit<T, 'name'> {
  const { name: _name, ...rest } = row
  return rest
}

/** The newest version of a shift's numbers, with names joined back on. */
export function latestSummary(
  q: Queryable, venueId: string, shiftId: string,
): ShiftSummary | null {
  const row = q.select().from(schema.shiftSummaries)
    .where(and(
      eq(schema.shiftSummaries.venueId, venueId),
      eq(schema.shiftSummaries.shiftId, shiftId),
    ))
    .orderBy(desc(schema.shiftSummaries.version))
    .get()
  if (!row) return null

  const names = userNames(q, venueId)
  const categories = new Map(
    q.select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .where(eq(schema.categories.venueId, venueId))
      .all()
      .map(c => [c.id, c.name]),
  )

  const byCategory = (JSON.parse(row.byCategoryJson) as CategoryLine[])
    .map(c => ({ ...c, name: categories.get(c.category_id) ?? '—' }))
  const byUser = (JSON.parse(row.byUserJson) as UserSummary[])
    .map(u => ({ ...u, name: names.get(u.user_id) ?? '—' }))

  return {
    shift_id: row.shiftId,
    version: row.version,
    reason: row.reason,
    promet_fen: row.prometFen,
    cash_fen: row.cashFen,
    card_fen: row.cardFen,
    comp_fen: row.compFen,
    void_count: row.voidCount,
    void_fen: row.voidFen,
    self_void_count: row.selfVoidCount,
    self_void_fen: row.selfVoidFen,
    unpaid_fen: row.unpaidFen,
    expected_cash_fen: row.expectedCashFen,
    outstanding_fen: row.outstandingFen,
    counted_cash_fen: row.countedCashFen,
    diff_fen: row.diffFen,
    stock_variance_fen: row.stockVarianceFen,
    waste_fen: row.wasteFen,
    bowls: row.bowls,
    tobacco_g: row.tobaccoG,
    coals: row.coals,
    by_category: byCategory,
    by_user: byUser,
    computed_at: row.computedAt,
  }
}

// ===========================================================================
// The drill-down
// ===========================================================================

/**
 * The lines behind a number, paged.
 *
 * Paging a money screen has exactly one rule it must not break: **the totals are
 * computed over the whole filtered set, never over the page**, so the footer of
 * page 1 and the footer of page 3 agree. The cursor is a keyset on
 * `(at, shift_seq, line_id)` rather than an offset, because an offset skips a
 * row the moment a late round arrives mid-scroll.
 */
export function shiftLines(
  q: Queryable, venueId: string, shiftId: string,
  opts: { userId?: string, kat: string, cursor?: string, limit?: number },
): LinesPage {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300)
  const names = userNames(q, venueId)
  const stockNames = new Map(
    q.select({ id: schema.stockItems.id, name: schema.stockItems.name })
      .from(schema.stockItems)
      .where(eq(schema.stockItems.venueId, venueId))
      .all()
      .map(s => [s.id, s.name]),
  )

  let lines = loadLines(q, venueId, shiftId)
  if (opts.userId) lines = lines.filter(l => l.lockedBy === opts.userId)
  lines = lines.filter(l => matchesKat(l, opts.kat))
  lines.sort(byKey)

  const totals: LineTotals = {
    rows: lines.length,
    qty: lines.reduce((n, l) => n + l.qty, 0),
    charged_fen: lines.reduce((n, l) => n + l.chargedFen, 0),
    storno_fen: lines.reduce((n, l) => n + appliedVoidFen(l), 0),
    gratis_fen: lines.reduce((n, l) => n + gratisOf(l), 0),
  }

  const after = opts.cursor ? decodeCursor(opts.cursor) : null
  const page = (after ? lines.filter(l => keyOf(l) > after) : lines).slice(0, limit)

  const rows: LineRow[] = page.map(l => ({
    line_id: l.lineId,
    at: l.at,
    arrived_at: l.arrivedAt,
    sync_lag_s: l.syncLagS,
    shift_seq: l.shiftSeq,
    table_name: l.tableName,
    name_snapshot: l.nameSnapshot,
    note: l.note,
    flavour_names: l.flavourIds.map(id => stockNames.get(id) ?? '—'),
    qty: l.qty,
    charged_fen: l.chargedFen,
    unit_price_fen: l.unitPriceFen,
    status: statusOf(l),
    late_sync: l.lateSync,
    locked_by: l.lockedBy,
    locked_by_name: names.get(l.lockedBy) ?? '—',
  }))

  const last = page.at(-1)
  return {
    rows,
    totals,
    ...(page.length === limit && last ? { next_cursor: encodeCursor(last) } : {}),
  }
}

function statusOf(line: LedgerLine): LineStatus {
  if (line.adjKind === 'void' && line.adjStatus === 'applied') return 'storno'
  if (line.adjKind === 'void' && line.adjStatus === 'pending') return 'storno_na_cekanju'
  if (isGratis(line)) return 'gratis'
  if (line.tabStatus === 'paid') return 'naplaceno'
  if (line.tabStatus === 'unpaid') return 'nije_placeno'
  if (line.tabStatus === 'voided') return 'storno'
  return 'otvoreno'
}

function matchesKat(line: LedgerLine, kat: string): boolean {
  switch (kat) {
    case '':
    case 'sve': return true
    case 'storno': return line.adjKind === 'void'
      && (line.adjStatus === 'applied' || line.adjStatus === 'pending')
    case 'gratis': return isGratis(line)
    case 'nijeplaceno': return line.tabStatus === 'unpaid'
    default: return line.categoryId === kat
  }
}

function keyOf(line: LedgerLine): string {
  return `${line.at}|${String(line.shiftSeq).padStart(6, '0')}|${line.lineId}`
}

function byKey(a: LedgerLine, b: LedgerLine): number {
  return keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0
}

function encodeCursor(line: LedgerLine): string {
  return Buffer.from(keyOf(line), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf8')
}

// ===========================================================================
// The two shift reads
// ===========================================================================

/**
 * `GET /api/me/shift` — the waiter's own night.
 *
 * **Blindness is a nudge, not a control.** `summary` stays `null` until he has
 * declared, so the screen cannot show him the answer before he writes it down —
 * but `/api/me/shift/lines` returns per-line prices, so anyone who can add knows
 * his number anyway. The evidence is the recorded pair `declared_fen` /
 * `expected_at_declare_fen` on the settlement row, not this strip. Do not let a
 * future feature lean on it as if it were a control.
 *
 * `float_out_fen` and his own `cash_movements` are returned **always**, before
 * settlement included: what a person was handed is not part of the blindness,
 * and hiding it would let a bartender push his own shortfall onto a colleague
 * who was structurally prevented from noticing.
 */
export function getMyShift(q: Queryable, venueId: string, userId: string): MyShift {
  const now = nowIso()
  const brief = shiftBriefFor(q, venueId, userId)
  if (!brief) {
    return {
      shift: null, joined_at: null, hours: 0, settled: false, settlement: null,
      float_out_fen: 0, cash_movements: [], summary: null,
    }
  }

  const member = q.select().from(schema.shiftMembers)
    .where(and(
      eq(schema.shiftMembers.venueId, venueId),
      eq(schema.shiftMembers.shiftId, brief.id),
      eq(schema.shiftMembers.userId, userId),
    ))
    .get()

  const settlements = listSettlements(q, venueId, brief.id, userId)
  const settlement = settlements[0] ?? null
  const movements = listCashMovements(q, venueId, brief.id, userId)
  const floatOut = movements
    .filter(m => m.type === 'float_out' && m.status === 'approved')
    .reduce((sum, m) => sum + m.amount_fen, 0)

  return {
    shift: brief,
    joined_at: member?.joinedAt ?? null,
    hours: hoursBetween(member?.joinedAt ?? null, member?.leftAt ?? null, now),
    settled: Boolean(settlement),
    settlement,
    float_out_fen: floatOut,
    cash_movements: movements,
    summary: settlement ? summarizeUser(q, venueId, brief.id, userId, now) : null,
  }
}

/** `GET /api/me/shifts` — *Moja smjena*, the last few nights. */
export function listMyShifts(
  q: Queryable, venueId: string, userId: string, limit: number,
): MyShiftRow[] {
  const rows = q.select({
    shiftId: schema.shifts.id,
    businessDate: schema.shifts.businessDate,
    openedAt: schema.shifts.openedAt,
    joinedAt: schema.shiftMembers.joinedAt,
    leftAt: schema.shiftMembers.leftAt,
    declaredFen: schema.waiterSettlements.declaredFen,
    expectedFen: schema.waiterSettlements.expectedAtDeclareFen,
  })
    .from(schema.shiftMembers)
    .innerJoin(schema.shifts, eq(schema.shifts.id, schema.shiftMembers.shiftId))
    .leftJoin(schema.waiterSettlements, and(
      eq(schema.waiterSettlements.shiftId, schema.shiftMembers.shiftId),
      eq(schema.waiterSettlements.userId, schema.shiftMembers.userId),
    ))
    .where(and(
      eq(schema.shiftMembers.venueId, venueId),
      eq(schema.shiftMembers.userId, userId),
    ))
    .orderBy(desc(schema.shifts.openedAt))
    .limit(Math.min(Math.max(limit, 1), 90))
    .all()

  const now = nowIso()
  return rows.map(r => ({
    shift_id: r.shiftId,
    business_date: r.businessDate,
    joined_at: r.joinedAt,
    left_at: r.leftAt,
    hours: hoursBetween(r.joinedAt, r.leftAt, now),
    declared_fen: r.declaredFen ?? null,
    diff_fen: r.declaredFen === null || r.expectedFen === null
      ? null
      : r.declaredFen - r.expectedFen,
  }))
}

/** `GET /api/owner/shift/:id` — one night, everything the owner can drill into. */
export function getOwnerShift(q: Queryable, venueId: string, shiftId: string): OwnerShift {
  const now = nowIso()
  const shift = requireShift(q, venueId, shiftId)
  const summary = latestSummary(q, venueId, shiftId) ?? summarizeShift(q, venueId, shiftId, now)
  const names = userNames(q, venueId)

  const counts: ShiftCountBrief[] = q.select({
    count: schema.stockCounts,
    variance: sql<number>`(
      select coalesce(sum(l.variance_fen), 0)
      from stock_count_lines l where l.count_id = ${schema.stockCounts.id}
    )`,
  })
    .from(schema.stockCounts)
    .where(and(
      eq(schema.stockCounts.venueId, venueId),
      eq(schema.stockCounts.shiftId, shiftId),
    ))
    .orderBy(asc(schema.stockCounts.submittedAt))
    .all()
    .map(row => ({
      id: row.count.id,
      kind: row.count.kind,
      phase: row.count.phase,
      status: row.count.status,
      counted_by: row.count.countedBy,
      counted_by_name: names.get(row.count.countedBy) ?? '—',
      submitted_at: row.count.submittedAt,
      confirmed_at: row.count.confirmedAt,
      variance_fen: row.variance,
    }))

  // Rounds that arrived after the night was already a record — the source of the
  // owner card "2 ture stigle nakon zatvaranja".
  const late = q.select({ body: schema.logEntries.bodyJson, actor: schema.logEntries.actorId })
    .from(schema.logEntries)
    .where(and(
      eq(schema.logEntries.venueId, venueId),
      eq(schema.logEntries.shiftId, shiftId),
      eq(schema.logEntries.kind, 'late_after_close'),
    ))
    .all()
  const lateNames = new Set<string>()
  let lateFen = 0
  for (const entry of late) {
    try {
      const body = JSON.parse(entry.body) as { amount_fen?: number, user_id?: string }
      lateFen += body.amount_fen ?? 0
      const who = body.user_id ?? entry.actor
      if (who) lateNames.add(names.get(who) ?? '—')
    } catch { /* a body we cannot read is still a round that arrived late */ }
  }

  return {
    shift: shiftView(q, venueId, shiftId),
    summary,
    by_user: summary.by_user,
    cash_movements: listCashMovements(q, venueId, shiftId),
    settlements: listSettlements(q, venueId, shiftId),
    counts,
    late_after_close: { count: late.length, fen: lateFen, user_names: [...lateNames] },
  }
}
