/**
 * *Analitika* — one month of the café, in the owner's own lines (16.09.2026).
 *
 * Every number here is read from something that already exists and already has
 * one definition; this file adds folds, not new arithmetic:
 *
 *   *Pazar*       — `promet_fen` of each shift whose **business day** is in the
 *                   month, through `listOwnerShifts` (the stored summary for a
 *                   closed night, the live one for tonight). The same number
 *                   *Smjene* and `dnevni_pazar.csv` print.
 *   *Za predati*  — Σ `shift_closings.za_predati_fen`: what the šanker handed
 *                   over. A night closed any other way has none, and adds none.
 *   *Neplaćeno*   — `shiftCategories` of every shift in the month: the tabs
 *                   closed as *Otpis*, *Rashod*, *Policija*, *Osoblje*, at what
 *                   was left on them. The same reader *Zaključi smjenu* uses.
 *   *Roba, Okusi, Žar* — `nabavkaByKind`, the *Kategorije* report's *nabavka*
 *                   grouped by stock item kind, over the month's
 *                   `[06:00 on the 1st, 06:00 after the last day)`.
 *   *Dnevnice*    — Σ `shift_closings.dnevnica_fen`, once per closed shift.
 *   *Kafa, Merkator, Dodatna plaćanja* — Σ of those columns of the closings:
 *                   paid out of the till, and not goods.
 *   *Struja, Voda, Kirija* — `month_costs`, typed by the owner. *Kirija* with no
 *                   row this month is **carried** from the latest earlier one.
 *
 * *Ostaje* is `pazar − neplaćeno − Σ troškovi` (`shared/analytics.ts` says why,
 * and why goods come from deliveries rather than from the closings).
 */
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { schema } from '../database/client'
import { newId, nowIso } from '../utils/ids'
import {
  addMonths, costKeyOfStockKind, daysInMonth, type ManualCostKind, MONTH_COST_LABELS,
  monthLabelBs, monthOf, totalCostFen, totalUnpaidFen, UNPAID_KEYS, type UnpaidKey,
} from '#shared/analytics'
import { slotOf } from '#shared/shiftSlots'
import type {
  AnalyticsDay, AnalyticsManualCost, AnalyticsRecord, AnalyticsSlotRecords, MonthAnalytics,
  OwnerShiftRow,
} from '#shared/types'
import type { PutMonthCostBody } from '#shared/schemas'
import type { Actor, Db, Queryable } from './types'
import { bump, log } from './contracts'
import { shiftCategories } from './cash'
import { listOwnerShifts } from './owner'
import { monthBounds, nabavkaByKind, periodBounds } from './reports'

/** How many months the trend chart draws, this one included. */
const TREND_MONTHS = 12

/** How many days *Najbolji dani* lists. */
const BEST_DAYS = 5

export function monthAnalytics(
  q: Queryable, venueId: string, month: string, now = nowIso(),
): MonthAnalytics {
  const { fromDay, toDay } = monthBounds(month)

  // Every shift ever, once. The month, the trend and the all-time records are
  // three cuts of one list, so they can never be three different readings.
  const all = listOwnerShifts(q, venueId, '0000-01-01', '9999-12-31', now)
  const inMonth = all.filter(s => s.business_date >= fromDay && s.business_date <= toDay)

  // -- pazar, by day ---------------------------------------------------------
  const byDay = new Map<string, AnalyticsDay>()
  for (let d = 1; d <= daysInMonth(month); d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`
    byDay.set(date, { business_date: date, pazar_fen: 0, shifts: 0 })
  }
  for (const shift of inMonth) {
    const day = byDay.get(shift.business_date)
    if (!day) continue
    day.pazar_fen += shift.promet_fen
    day.shifts += 1
  }
  const days = [...byDay.values()]
  const pazar = days.reduce((sum, d) => sum + d.pazar_fen, 0)

  const bestDays = days
    .filter(d => d.pazar_fen > 0)
    .sort((a, b) => b.pazar_fen - a.pazar_fen || a.business_date.localeCompare(b.business_date))
    .slice(0, BEST_DAYS)

  // -- the closings: za predati and dnevnice ---------------------------------
  const closings = inMonth.length === 0
    ? []
    : q.select({
        zaPredati: schema.shiftClosings.zaPredatiFen,
        dnevnica: schema.shiftClosings.dnevnicaFen,
        kafa: schema.shiftClosings.kafaFen,
        merkator: schema.shiftClosings.merkatorFen,
        extra: schema.shiftClosings.extraFen,
      })
        .from(schema.shiftClosings)
        .where(and(
          eq(schema.shiftClosings.venueId, venueId),
          inArray(schema.shiftClosings.shiftId, inMonth.map(s => s.id)),
        ))
        .all()

  // -- rung up and never paid -------------------------------------------------
  const unpaid: Record<UnpaidKey, number> = { otpis: 0, rashod: 0, policija: 0, osoblje: 0 }
  for (const shift of inMonth) {
    for (const category of shiftCategories(q, venueId, shift.id)) {
      if ((UNPAID_KEYS as readonly string[]).includes(category.reason)) {
        unpaid[category.reason as UnpaidKey] += category.fen
      }
    }
  }
  const unpaidTotal = totalUnpaidFen(unpaid)

  // -- goods, by what was bought ---------------------------------------------
  const bounds = periodBounds(q, venueId, fromDay, toDay)
  const goods = { roba: 0, okusi: 0, zar: 0 }
  for (const [kind, fen] of nabavkaByKind(q, venueId, bounds.from, bounds.to)) {
    goods[costKeyOfStockKind(kind)] += fen
  }

  // -- what the owner typed --------------------------------------------------
  const manual = {
    struja: manualCost(q, venueId, month, 'struja', false),
    voda: manualCost(q, venueId, month, 'voda', false),
    kirija: manualCost(q, venueId, month, 'kirija', true),
  }

  const sumOf = (pick: (c: typeof closings[number]) => number) =>
    closings.reduce((sum, c) => sum + pick(c), 0)

  const costs = {
    ...goods,
    kafa: sumOf(c => c.kafa),
    merkator: sumOf(c => c.merkator),
    dodatna: sumOf(c => c.extra),
    dnevnice: sumOf(c => c.dnevnica),
    struja: manual.struja.amount_fen,
    voda: manual.voda.amount_fen,
    kirija: manual.kirija.amount_fen,
  }
  const totalCost = totalCostFen(costs)

  return {
    month,
    pazar_fen: pazar,
    za_predati_fen: sumOf(c => c.zaPredati),
    shifts: inMonth.length,
    closed_shifts: closings.length,
    unpaid,
    unpaid_fen: unpaidTotal,
    costs,
    manual,
    total_cost_fen: totalCost,
    neto_fen: pazar - unpaidTotal - totalCost,
    days,
    best_days: bestDays,
    trend: trend(all, month),
    records: records(q, venueId, all, fromDay, toDay),
  }
}

/** Twelve months ending with `month`, oldest first, zeros included. */
function trend(all: OwnerShiftRow[], month: string): MonthAnalytics['trend'] {
  const totals = new Map<string, number>()
  for (const shift of all) {
    const m = monthOf(shift.business_date)
    totals.set(m, (totals.get(m) ?? 0) + shift.promet_fen)
  }
  return Array.from({ length: TREND_MONTHS }, (_, i) => {
    const m = addMonths(month, i - (TREND_MONTHS - 1))
    return { month: m, pazar_fen: totals.get(m) ?? 0 }
  })
}

/**
 * The best night of each slot — in the month, and ever.
 *
 * A shift belongs to the template whose window it **opened** in, the same rule
 * *Smjene* draws its cards by (`shared/shiftSlots.ts`). A night with no pazar is
 * not a record of anything, and a shift that opened outside every window is
 * nobody's record.
 */
function records(
  q: Queryable, venueId: string, all: OwnerShiftRow[], fromDay: string, toDay: string,
): AnalyticsSlotRecords[] {
  const templates = q.select().from(schema.shiftTemplates)
    .where(and(eq(schema.shiftTemplates.venueId, venueId), eq(schema.shiftTemplates.active, 1)))
    .orderBy(schema.shiftTemplates.sort, schema.shiftTemplates.startTime)
    .all()
    .map(t => ({ id: t.id, name: t.name, start_time: t.startTime, end_time: t.endTime }))

  const out = templates.map(t => ({
    template_id: t.id, name: t.name,
    month: null as AnalyticsRecord | null,
    all_time: null as AnalyticsRecord | null,
  }))

  const better = (current: AnalyticsRecord | null, shift: OwnerShiftRow) =>
    current === null || shift.promet_fen > current.pazar_fen

  for (const shift of all) {
    if (shift.promet_fen <= 0) continue
    const slot = slotOf(shift.opened_at, templates)
    if (!slot) continue
    const row = out.find(r => r.template_id === slot.id)!
    const record = {
      shift_id: shift.id, business_date: shift.business_date, pazar_fen: shift.promet_fen,
    }
    if (better(row.all_time, shift)) row.all_time = record
    if (shift.business_date >= fromDay && shift.business_date <= toDay && better(row.month, shift)) {
      row.month = record
    }
  }
  return out
}

/**
 * One typed cost for one month.
 *
 * `carry` is *Kirija*'s rule: a month with no row of its own takes the latest
 * earlier month's figure, so rent typed once in January is there in every month
 * after it, and changing it in March does not rewrite January. *Struja* and
 * *Voda* are a bill a month and never carry — last month's electricity is not
 * this month's.
 */
function manualCost(
  q: Queryable, venueId: string, month: string, kind: ManualCostKind, carry: boolean,
): AnalyticsManualCost {
  const own = q.select().from(schema.monthCosts)
    .where(and(
      eq(schema.monthCosts.venueId, venueId),
      eq(schema.monthCosts.month, month),
      eq(schema.monthCosts.kind, kind),
    ))
    .get()
  if (own) return { amount_fen: own.amountFen, carried: false, from_month: own.month }
  if (!carry) return { amount_fen: 0, carried: false, from_month: null }

  const earlier = q.select().from(schema.monthCosts)
    .where(and(
      eq(schema.monthCosts.venueId, venueId),
      eq(schema.monthCosts.kind, kind),
      lt(schema.monthCosts.month, month),
    ))
    .orderBy(desc(schema.monthCosts.month))
    .get()
  return earlier
    ? { amount_fen: earlier.amountFen, carried: true, from_month: earlier.month }
    : { amount_fen: 0, carried: false, from_month: null }
}

/**
 * `PUT /api/owner/analitika/troskovi` — set one typed cost for one month.
 *
 * One transaction: the row (inserted or overwritten), a *Dnevnik* line with the
 * before and after, and the change-feed bump that makes an open *Analitika* on
 * the laptop redraw. `settings` is the entity, because these are the owner's own
 * figures about the venue and every admin screen already follows it.
 */
export function setMonthCost(
  db: Db, venueId: string, actor: Actor, body: PutMonthCostBody, now = nowIso(),
): MonthAnalytics {
  db.transaction((tx) => {
    const existing = tx.select().from(schema.monthCosts)
      .where(and(
        eq(schema.monthCosts.venueId, venueId),
        eq(schema.monthCosts.month, body.month),
        eq(schema.monthCosts.kind, body.kind),
      ))
      .get()

    if (existing) {
      if (existing.amountFen === body.amount_fen) return
      tx.update(schema.monthCosts)
        .set({ amountFen: body.amount_fen, updatedBy: actor.userId, updatedAt: now })
        .where(eq(schema.monthCosts.id, existing.id))
        .run()
    } else {
      tx.insert(schema.monthCosts).values({
        id: newId(),
        venueId,
        month: body.month,
        kind: body.kind,
        amountFen: body.amount_fen,
        updatedBy: actor.userId,
        updatedAt: now,
      }).run()
    }

    log(tx, venueId, {
      kind: 'settings_changed',
      body: {
        // Ends in `_fen`, so *Dnevnik* writes it as money: "0,00 KM → 120,00 KM".
        key: `month_cost.${body.month}.${body.kind}_fen`,
        label: `${MONTH_COST_LABELS[body.kind]} · ${monthLabelBs(body.month)}`,
        before: existing?.amountFen ?? 0,
        after: body.amount_fen,
      },
      actorId: actor.userId,
      ref: { type: 'venue', id: venueId },
      at: now,
    })
    bump(tx, venueId, 'settings', venueId)
  })

  return monthAnalytics(db, venueId, body.month, now)
}
