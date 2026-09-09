/**
 * The owner's stock reads (`docs/BACKEND.md` §6.8, "Reports"). Read-only, every
 * one of them: nothing in this file writes a row.
 *
 * Four answers: *Roba* (the stock list with its per-item ledger drill-down),
 * *Kategorije* (what each category cost and what it brought in) and *Nargila*
 * (the tobacco-to-bowls reconciliation the owner does on paper today).
 *
 * **Money is multiplied and divided by 1000 exactly once, at the end.** Costs
 * are milli-feninga per base unit, so a group's value is
 * `round(Σ (qty × unit_cost_mfen) / 1000)` — the sum stays integral all the way
 * and one rounding happens per group, not one per row. Rounding per row and then
 * summing is how a 19-item report ends up 7 feninga away from the ledger it was
 * computed from.
 */
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { notFound } from '../utils/errors'
import { cutoffIso, nextBusinessDate } from '#shared/dates'
import { gpbWithinBand, gramsPerBowl } from '#shared/bowls'
import type {
  CategoriesReport, CategoryReportRow, ItemMovementRow, ItemMovementsPage, MovementType,
  NargilaReport, NargilaReportItem, OwnerStockReport,
} from '#shared/types'
import type { Queryable } from './types'
import { getSettings } from './contracts'
import {
  movementLabel, onHand, ownerStockItems, theoreticalAt, unitCost, valueFen,
} from './stock'

// ===========================================================================
// Roba — the stock list and one item's ledger
// ===========================================================================

/** `GET /api/owner/stock` — every item, priced, with the shelf's total value. */
export function ownerStock(q: Queryable, venueId: string): OwnerStockReport {
  const items = ownerStockItems(q, venueId)
  return {
    items,
    totals: {
      items: items.length,
      value_fen: items.reduce((sum, i) => sum + i.value_fen, 0),
      u_minusu: items.filter(i => i.status === 'u_minusu').length,
      bez_cijene: items.filter(i => i.status === 'bez_cijene').length,
      nisko: items.filter(i => i.status === 'nisko').length,
    },
  }
}

/**
 * `GET /api/owner/stock/:id/movements?before&limit` — one page of the ledger,
 * newest first, with the on-hand after each row.
 *
 * `before` is an `occurred_at`, not an offset: an offset shifts under a page
 * when a round lands mid-scroll and the owner silently skips a movement.
 */
export function itemMovements(
  q: Queryable, venueId: string, stockItemId: string,
  opts: { before?: string, limit?: number } = {},
): ItemMovementsPage {
  const item = q.select().from(schema.stockItems)
    .where(and(eq(schema.stockItems.venueId, venueId), eq(schema.stockItems.id, stockItemId)))
    .get()
  if (!item) throw notFound('STOCK_ITEM_NOT_FOUND', `stock item ${stockItemId} not found`)

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)

  const rows = q.select({
    m: schema.stockMovements,
    userName: schema.users.name,
  })
    .from(schema.stockMovements)
    .leftJoin(schema.users, eq(schema.users.id, schema.stockMovements.userId))
    .where(and(
      eq(schema.stockMovements.venueId, venueId),
      eq(schema.stockMovements.stockItemId, stockItemId),
      opts.before ? lt(schema.stockMovements.occurredAt, opts.before) : sql`1 = 1`,
    ))
    .orderBy(desc(schema.stockMovements.occurredAt), desc(schema.stockMovements.id))
    .limit(limit + 1)
    .all()

  const page = rows.slice(0, limit)
  const nextCursor = rows.length > limit ? page[page.length - 1]!.m.occurredAt : null

  // The on-hand *after* the oldest row on this page is everything at or below it.
  const tables = tableByLine(q, venueId)
  const oldest = page[page.length - 1]
  let running = oldest ? theoreticalAt(q, venueId, stockItemId, oldest.m.occurredAt) : 0

  const out: ItemMovementRow[] = []
  for (let i = page.length - 1; i >= 0; i--) {
    const { m, userName } = page[i]!
    if (i !== page.length - 1) running += m.qtyDelta
    out.unshift({
      id: m.id,
      type: m.type,
      qty_delta: m.qtyDelta,
      unit_cost_mfen: m.unitCostMfen,
      value_fen: valueFen(m.qtyDelta, m.unitCostMfen),
      occurred_at: m.occurredAt,
      created_at: m.createdAt,
      user_name: userName ?? null,
      ref_label: movementLabel(m.type, m.refType, m.refId, tables),
      note: m.note,
      running_on_hand: running,
    })
  }

  return {
    item: {
      id: item.id,
      name: item.name,
      base_unit: item.baseUnit,
      on_hand: onHand(q, venueId, stockItemId),
    },
    rows: out,
    next_cursor: nextCursor,
  }
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

// ===========================================================================
// The period every report shares
// ===========================================================================

/**
 * `[06:00 of the first business day, 06:00 after the last)`.
 *
 * Half-open on purpose: the delivery at 23:00 on the last day of the month is
 * inside it and the round at 04:00 the next morning is not — because that round
 * belongs to the last night, which is the previous month's business day, and it
 * is already counted there.
 */
export function periodBounds(
  q: Queryable, venueId: string, fromDay: string, toDay: string,
): { from: string, to: string } {
  const settings = getSettings(q, venueId)
  return {
    from: cutoffIso(fromDay, settings.timezone, settings.business_day_start_hour),
    to: cutoffIso(nextBusinessDate(toDay), settings.timezone, settings.business_day_start_hour),
  }
}

/** `YYYY-MM` → the first and last business day of that month. */
export function monthBounds(month: string): { fromDay: string, toDay: string } {
  const [year, mon] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year!, mon!, 0)).getUTCDate()
  return {
    fromDay: `${month}-01`,
    toDay: `${month}-${String(last).padStart(2, '0')}`,
  }
}

// ===========================================================================
// Kategorije
// ===========================================================================

/**
 * `GET /api/owner/categories?from&to` — the four columns the owner reads down.
 *
 *   *nabavka* — Σ `delivery_lines.line_cost_fen` of posted deliveries, less what
 *               a reversal took back and less what went back to the supplier.
 *               Grouped by the **stock item's** category: money leaves by what
 *               was bought.
 *   *prodaja* — Σ `charged_fen` − applied void `amount_fen`, grouped by the
 *               **product's** category. This is the same arithmetic
 *               `summaries.ts` uses for `promet_fen`, deliberately: the two must
 *               reconcile to the fen over the same period, and `invariants.test.ts`
 *               (WP8) asserts exactly that.
 *   *utrošak* — what the sales took off the shelf, at cost (`sale|sale_storno`).
 *   *otpis*   — waste, count adjustments and late-sync offsets, at cost.
 */
export function categoriesReport(
  db: Queryable, venueId: string, fromIso: string, toIso: string,
): CategoriesReport {
  const rows = new Map<string, CategoryReportRow>()
  const categories = db.select().from(schema.categories)
    .where(eq(schema.categories.venueId, venueId)).all()

  for (const c of categories) {
    rows.set(c.id, {
      category_id: c.id,
      category_name: c.name,
      kind: c.kind,
      nabavka_fen: 0,
      prodaja_fen: 0,
      utrosak_fen: 0,
      otpis_fen: 0,
      marza_fen: 0,
    })
  }
  /** An item or product with no category still has to land somewhere visible. */
  const bucket = (id: string | null): CategoryReportRow => {
    const key = id ?? 'bez-kategorije'
    let row = rows.get(key)
    if (!row) {
      row = {
        category_id: key,
        category_name: 'Bez kategorije',
        kind: 'ostalo',
        nabavka_fen: 0,
        prodaja_fen: 0,
        utrosak_fen: 0,
        otpis_fen: 0,
        marza_fen: 0,
      }
      rows.set(key, row)
    }
    return row
  }

  // -- nabavka --------------------------------------------------------------
  const delivered = db.select({
    categoryId: schema.stockItems.categoryId,
    lineCostFen: schema.deliveryLines.lineCostFen,
  })
    .from(schema.deliveryLines)
    .innerJoin(schema.deliveries, eq(schema.deliveries.id, schema.deliveryLines.deliveryId))
    .innerJoin(schema.stockItems, eq(schema.stockItems.id, schema.deliveryLines.stockItemId))
    .where(and(
      eq(schema.deliveries.venueId, venueId),
      eq(schema.deliveries.status, 'posted'),
      gte(schema.deliveries.deliveredAt, fromIso),
      lt(schema.deliveries.deliveredAt, toIso),
    ))
    .all()
  for (const row of delivered) bucket(row.categoryId).nabavka_fen += row.lineCostFen

  // A reversal writes `correction` rows against the delivery line, and a return
  // to the supplier writes `return_supplier`; both are negative, so both reduce
  // *nabavka* by the same addition.
  const returned = movementValueByCategory(db, venueId, fromIso, toIso, {
    types: ['return_supplier'],
  })
  const reversals = movementValueByCategory(db, venueId, fromIso, toIso, {
    types: ['correction'],
    refType: 'delivery_line',
  })
  for (const [categoryId, mfen] of merge(returned, reversals)) {
    bucket(categoryId).nabavka_fen += Math.round(mfen / 1000)
  }

  // -- prodaja --------------------------------------------------------------
  const sold = db.select({
    categoryId: schema.products.categoryId,
    chargedFen: schema.orderLines.chargedFen,
    adjKind: schema.lineAdjustments.kind,
    adjStatus: schema.lineAdjustments.status,
    adjAmountFen: schema.lineAdjustments.amountFen,
  })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId))
    .leftJoin(schema.lineAdjustments, and(
      eq(schema.lineAdjustments.orderLineId, schema.orderLines.id),
      inArray(schema.lineAdjustments.status, ['pending', 'applied']),
    ))
    .where(and(
      eq(schema.orders.venueId, venueId),
      gte(schema.orders.createdAt, fromIso),
      lt(schema.orders.createdAt, toIso),
    ))
    .all()
  for (const row of sold) {
    const voided = row.adjKind === 'void' && row.adjStatus === 'applied' ? row.adjAmountFen ?? 0 : 0
    bucket(row.categoryId).prodaja_fen += row.chargedFen - voided
  }

  // -- utrošak i otpis ------------------------------------------------------
  const consumed = movementValueByCategory(db, venueId, fromIso, toIso, {
    types: ['sale', 'sale_storno'],
  })
  for (const [categoryId, mfen] of consumed) {
    bucket(categoryId).utrosak_fen += Math.round(-mfen / 1000)
  }

  const written = movementValueByCategory(db, venueId, fromIso, toIso, {
    types: ['waste', 'count_adjust', 'late_sync'],
  })
  for (const [categoryId, mfen] of written) {
    bucket(categoryId).otpis_fen += Math.round(-mfen / 1000)
  }

  const out = [...rows.values()]
    .map(row => ({ ...row, marza_fen: row.prodaja_fen - row.utrosak_fen }))
    .filter(row => row.nabavka_fen || row.prodaja_fen || row.utrosak_fen || row.otpis_fen)
    .sort((a, b) => a.category_name.localeCompare(b.category_name, 'bs'))

  return {
    from: fromIso,
    to: toIso,
    rows: out,
    totals: {
      nabavka_fen: out.reduce((s, r) => s + r.nabavka_fen, 0),
      prodaja_fen: out.reduce((s, r) => s + r.prodaja_fen, 0),
      utrosak_fen: out.reduce((s, r) => s + r.utrosak_fen, 0),
      otpis_fen: out.reduce((s, r) => s + r.otpis_fen, 0),
      marza_fen: out.reduce((s, r) => s + r.marza_fen, 0),
    },
  }
}

/**
 * `Σ qty_delta × unit_cost_mfen` per category, still in milli-feninga — the
 * caller divides by 1000 once, after summing (§2).
 */
function movementValueByCategory(
  q: Queryable, venueId: string, fromIso: string, toIso: string,
  filter: { types: MovementType[], refType?: string },
): Map<string | null, number> {
  const rows = q.select({
    categoryId: schema.stockItems.categoryId,
    mfen: sql<number>`sum(${schema.stockMovements.qtyDelta} * ${schema.stockMovements.unitCostMfen})`,
  })
    .from(schema.stockMovements)
    .innerJoin(schema.stockItems, eq(schema.stockItems.id, schema.stockMovements.stockItemId))
    .where(and(
      eq(schema.stockMovements.venueId, venueId),
      inArray(schema.stockMovements.type, filter.types),
      filter.refType ? eq(schema.stockMovements.refType, filter.refType) : sql`1 = 1`,
      gte(schema.stockMovements.occurredAt, fromIso),
      lt(schema.stockMovements.occurredAt, toIso),
    ))
    .groupBy(schema.stockItems.categoryId)
    .all()

  return new Map(rows.map(r => [r.categoryId, r.mfen ?? 0]))
}

function merge(...maps: Map<string | null, number>[]): Map<string | null, number> {
  const out = new Map<string | null, number>()
  for (const map of maps) {
    for (const [key, value] of map) out.set(key, (out.get(key) ?? 0) + value)
  }
  return out
}

// ===========================================================================
// Nargila
// ===========================================================================

/**
 * `GET /api/owner/nargila?month=YYYY-MM` — the owner's own arithmetic, done by
 * the server.
 *
 * He does it on paper today: *"15 kila duhana je ušlo, 4 kile su ostale, znači
 * 11 kila je otišlo — a to je 550 lula. Prodali smo 500."* The 50 bowls between
 * those two numbers are the whole reason this report exists, and they are priced
 * at the **cheapest** active shisha product, because the honest reading of a
 * missing bowl is the least it could have been worth.
 *
 * `početno_g` comes from the last confirmed count before the period (the shelf
 * as somebody actually saw it) and falls back to the theoretical figure;
 * `završno_g` comes from the last confirmed count inside the period and falls
 * back the same way, flagged `estimated` so nobody reads a computed number as a
 * counted one.
 */
export function nargilaReport(
  db: Queryable, venueId: string, fromIso: string, toIso: string, month: string | null = null,
): NargilaReport {
  const settings = getSettings(db, venueId)

  const items = db.select().from(schema.stockItems)
    .where(and(eq(schema.stockItems.venueId, venueId), eq(schema.stockItems.kind, 'duhan')))
    .orderBy(asc(schema.stockItems.name))
    .all()

  const lines: NargilaReportItem[] = items.map((item) => {
    const opening = countedAt(db, venueId, item.id, { before: fromIso })
    const closing = countedAt(db, venueId, item.id, { from: fromIso, before: toIso })

    // An `opening` movement inside the period belongs on the **opening** side,
    // not the received side. It is the *Početno stanje* screen writing down the
    // shelf as the owner found it on the evening the app was switched on — the
    // one month that happens, `theoreticalAt(from)` is 0 and the tin was already
    // in the cupboard. Counting it as *primljeno* would say two kilos arrived
    // that never did; leaving it out altogether makes *potrošeno* negative.
    const foundOnTheShelf = movementGrams(db, venueId, item.id, ['opening'], fromIso, toIso)

    const pocetno = opening ?? theoreticalAt(db, venueId, item.id, fromIso) + foundOnTheShelf
    const zavrsno = closing ?? theoreticalAt(db, venueId, item.id, toIso)

    const primljeno = movementGrams(db, venueId, item.id, ['delivery'], fromIso, toIso)

    return {
      stock_item_id: item.id,
      item_name: item.name,
      pocetno_g: pocetno,
      primljeno_g: primljeno,
      zavrsno_g: zavrsno,
      potroseno_g: pocetno + primljeno - zavrsno,
      estimated: closing === null,
    }
  })

  const pocetno = sum(lines, l => l.pocetno_g)
  const primljeno = sum(lines, l => l.primljeno_g)
  const zavrsno = sum(lines, l => l.zavrsno_g)
  const potroseno = pocetno + primljeno - zavrsno

  const prodano = bowlsSold(db, venueId, fromIso, toIso)
  const norm = settings.grams_per_bowl_default
  const ocekivano = norm > 0 ? Math.round(potroseno / norm) : 0
  const razlika = ocekivano - prodano
  const gpb = gramsPerBowl(potroseno, prodano)

  return {
    from: fromIso,
    to: toIso,
    month,
    pocetno_g: pocetno,
    primljeno_g: primljeno,
    zavrsno_g: zavrsno,
    potroseno_g: potroseno,
    prodano_lula: prodano,
    ocekivano_lula: ocekivano,
    razlika_lula: razlika,
    razlika_fen: razlika * cheapestBowlFen(db, venueId),
    grams_per_bowl: gpb,
    gpb_norm: norm,
    within_band: gpbWithinBand(gpb, norm, settings.gpb_band_pct),
    estimated: lines.some(l => l.estimated),
    items: lines,
  }
}

/** `Σ qty_delta` of one item over a window, for the movement types named. */
function movementGrams(
  q: Queryable, venueId: string, stockItemId: string, types: MovementType[],
  fromIso: string, toIso: string,
): number {
  return q.select({
    g: sql<number | null>`coalesce(sum(${schema.stockMovements.qtyDelta}), 0)`,
  })
    .from(schema.stockMovements)
    .where(and(
      eq(schema.stockMovements.venueId, venueId),
      eq(schema.stockMovements.stockItemId, stockItemId),
      inArray(schema.stockMovements.type, types),
      gte(schema.stockMovements.occurredAt, fromIso),
      lt(schema.stockMovements.occurredAt, toIso),
    ))
    .get()?.g ?? 0
}

/** The counted quantity from the last confirmed count in a window, or `null`. */
function countedAt(
  q: Queryable, venueId: string, stockItemId: string,
  window: { from?: string, before: string },
): number | null {
  const row = q.select({ qty: schema.stockCountLines.countedQty })
    .from(schema.stockCountLines)
    .innerJoin(schema.stockCounts, eq(schema.stockCounts.id, schema.stockCountLines.countId))
    .where(and(
      eq(schema.stockCountLines.venueId, venueId),
      eq(schema.stockCountLines.stockItemId, stockItemId),
      eq(schema.stockCounts.status, 'confirmed'),
      window.from ? gte(schema.stockCounts.submittedAt, window.from) : sql`1 = 1`,
      lt(schema.stockCounts.submittedAt, window.before),
    ))
    .orderBy(desc(schema.stockCounts.submittedAt))
    .get()
  return row?.qty ?? null
}

/**
 * *Prodano lula* over the period — `shared/bowls.ts`'s rule, in SQL.
 *
 * A bowl is a line whose product is `kind='shisha'`; `qty` counts, so one line of
 * 2 × Nargila is two bowls. *Dodatni žar* is a `simple` product and is
 * deliberately **not** a bowl (counting it would inflate the count and make
 * grams-per-bowl look far too low). An applied void takes its bowls back out.
 */
function bowlsSold(q: Queryable, venueId: string, fromIso: string, toIso: string): number {
  const rows = q.select({
    qty: schema.orderLines.qty,
    adjKind: schema.lineAdjustments.kind,
    adjStatus: schema.lineAdjustments.status,
  })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId))
    .leftJoin(schema.lineAdjustments, and(
      eq(schema.lineAdjustments.orderLineId, schema.orderLines.id),
      inArray(schema.lineAdjustments.status, ['pending', 'applied']),
    ))
    .where(and(
      eq(schema.orders.venueId, venueId),
      eq(schema.products.kind, 'shisha'),
      gte(schema.orders.createdAt, fromIso),
      lt(schema.orders.createdAt, toIso),
    ))
    .all()

  return rows.reduce(
    (n, r) => (r.adjKind === 'void' && r.adjStatus === 'applied' ? n : n + r.qty),
    0,
  )
}

/** The least a missing bowl could have been worth. */
function cheapestBowlFen(q: Queryable, venueId: string): number {
  return q.select({ priceFen: schema.products.priceFen })
    .from(schema.products)
    .where(and(
      eq(schema.products.venueId, venueId),
      eq(schema.products.kind, 'shisha'),
      eq(schema.products.active, 1),
    ))
    .orderBy(asc(schema.products.priceFen))
    .get()?.priceFen ?? 0
}

function sum<T>(rows: T[], of: (row: T) => number): number {
  return rows.reduce((n, row) => n + of(row), 0)
}
