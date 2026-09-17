/**
 * *Zaključi smjenu* — the šanker closes the whole night with a subtraction.
 *
 * The owner's decision (15.09.2026): the waiter no longer settles, nobody counts
 * the drawer, and the only end of a shift a worker has is this one, on the bar.
 *
 *     Sav prihod − Dnevnica − Otpis − Rashod − Policija − Osoblje
 *       − Merkator − Dodatna plaćanja = Za predati
 *   (Plaćanje robe / okusa / žara / kafe retired 17.09.2026; stored as 0.)
 *
 * **The server owns the first six.** *Sav prihod* is the shift's promet, read
 * out of `summarizeShift` — the same call that writes `shift_summaries`, so the
 * closing, the summary and *Smjena* cannot print three different nights.
 * *Dnevnica* is `settings.dnevnica_fen`, once per shift.
 *
 * *Otpis*, *Rashod*, *Policija* and *Osoblje* are the four categories marked on
 * the floor while the night runs (the owner's call, 16.09.2026: "if we mark
 * policija or rashod in that sheet it should come off by itself, the same as
 * dnevnica" — *Osoblje* joined them the same day). They are every reason a tab
 * can close authorised: `AUTHORISED_UNPAID_REASONS` is the list, and the close
 * now subtracts all four of it.
 * They are all one shape in the ledger — a tab closed with money still on it and
 * nobody owing it — so `shiftCategories` is where they are counted, and the
 * closing subtracts what it finds. Ringing them up is what moved the stock and
 * put them in the promet; this is where they come back out, once. Nobody types
 * them, so nobody can type them twice.
 *
 * The phone sends the five amounts nobody but the šanker can know, and
 * *Dodatna plaćanja* — a label and an amount each, for the payouts that have no
 * fixed name ("config 15 KM"). **Their sum is the server's**: the phone sends
 * the lines, `extra_fen` is added up here, and a phone that sent a total would
 * be sending a number nobody checked.
 *
 * **Who may.** A session whose screen tonight is `sanker` (`Actor.mode`); a
 * konobar session and an admin session are both 403 `NOT_SANKER`. The admin
 * keeps his own `forceClose` on the dashboard, untouched. `closeShift` (drawer
 * count + PIN) is untouched too, and not called from here: it needs an opening
 * count and counted cash, and this close has neither by design.
 *
 * It does **not** go through the outbox: the close needs the server's numbers
 * at the moment it happens, so it is an online POST with a `client_id`, and a
 * retry of the same POST is a replay (200, the stored row), never a second row.
 */
import { and, eq } from 'drizzle-orm'
import { schema } from '../database/client'
import { conflict, forbidden, notFound } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { zaPredati } from '#shared/closing'
import { businessDate } from '#shared/dates'
import type { ClosingExtra } from '#shared/closing'
import type { ClosingPreview, ShiftClosing, ShiftCostInvoice, ShiftExtraCost, UnpaidReason } from '#shared/types'
import type { AddShiftExtraCostBody } from '#shared/schemas'
import { shiftCostText } from '#shared/shiftCosts'
import type { Actor, Db, Queryable } from './types'
import { bump, getSettings, log } from './contracts'
import { shiftCategories } from './cash'
import {
  assertNoOpenTabs, autoLeave, openTabsOn, requireShift, userNames,
} from './shifts'
import { summarizeShift, writeSummaryVersion } from './summaries'

type ClosingRow = typeof schema.shiftClosings.$inferSelect

/** The typed amounts and the free lines, as `closeByBarBody` parsed them. */
export interface CloseByBarInput {
  client_id: string
  roba_fen: number
  okusi_fen: number
  zar_fen: number
  kafa_fen: number
  merkator_fen: number
  extras: { label: string, amount_fen: number }[]
  note?: string
}

/**
 * The extras as they are stored and read back.
 *
 * A row's worth of JSON rather than a child table: they are display lines of
 * one closing, never joined, never aggregated, and a table for them would be a
 * migration every time the café invents a new kind of payout. A label that
 * survived Zod is trimmed and non-empty; a zero amount is dropped, because a
 * line that subtracts nothing is noise on a receipt.
 */
function cleanExtras(extras: CloseByBarInput['extras']): ClosingExtra[] {
  return extras
    .map(extra => ({ label: extra.label.trim(), fen: extra.amount_fen }))
    .filter(extra => extra.label !== '' && extra.fen > 0)
}

function readExtras(json: string | null): ClosingExtra[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((row): row is ClosingExtra =>
      typeof row === 'object' && row !== null
      && typeof (row as ClosingExtra).label === 'string'
      && Number.isFinite((row as ClosingExtra).fen))
  } catch {
    // A row written by hand, or by a version that stored something else. A
    // closing that cannot print one line is better than a 500 on *Smjena*.
    return []
  }
}

/** Only a šanker-mode session closes the shift. The role is not the question. */
export function requireSanker(actor: Actor): void {
  if (actor.mode !== 'sanker') {
    throw forbidden('NOT_SANKER', 'only a session in sanker mode closes the shift')
  }
}

/**
 * The server's six numbers for a shift, right now.
 *
 * `summarizeShift` is the one definition of promet (charged − applied voids)
 * and of the *stock* otpis (`product_waste.value_fen` + legacy
 * `waste_events.cost_fen`); reading them anywhere else would be a second one.
 *
 * `shiftCategories` is the one definition of the other three: the tabs closed
 * unpaid with a reason, at what was left on each. **`otpis_fen` is the sum of
 * both halves** — a drink spilled at a table is marked on the tab (that is what
 * moves the right tobacco or the right bottle), a box dropped in the store room
 * is a `product_waste` row with no tab at all, and the night's otpis is both.
 * They cannot overlap: one is a tab, the other is not.
 *
 * `osoblje` is the fourth: a drink a worker had against his own allowance, rung
 * up like any round and paid for by nobody, so it comes off the night with the
 * other three.
 */
function serverNumbers(
  q: Queryable, venueId: string, shiftId: string, now: string,
): {
  prihod_fen: number, dnevnica_fen: number
  otpis_fen: number, rashod_fen: number, policija_fen: number, osoblje_fen: number
} {
  const summary = summarizeShift(q, venueId, shiftId, now)
  const categories = shiftCategories(q, venueId, shiftId)
  const fenOf = (reason: UnpaidReason) =>
    categories.find(c => c.reason === reason)?.fen ?? 0

  return {
    prihod_fen: summary.promet_fen,
    dnevnica_fen: getSettings(q, venueId).dnevnica_fen,
    otpis_fen: summary.waste_fen + fenOf('otpis'),
    rashod_fen: fenOf('rashod'),
    policija_fen: fenOf('policija'),
    osoblje_fen: fenOf('osoblje'),
  }
}

function toView(q: Queryable, venueId: string, row: ClosingRow): ShiftClosing {
  const shift = requireShift(q, venueId, row.shiftId)
  const naknadni = listShiftExtraCosts(q, venueId, row.shiftId)
  const naknadniFen = naknadni.reduce((sum, cost) => sum + cost.amount_fen, 0)
  return {
    id: row.id,
    shift_id: row.shiftId,
    business_date: shift.businessDate,
    client_id: row.clientId,
    closed_by: row.closedBy,
    closed_by_name: userNames(q, venueId).get(row.closedBy) ?? '—',
    created_at: row.createdAt,
    prihod_fen: row.prihodFen,
    dnevnica_fen: row.dnevnicaFen,
    otpis_fen: row.otpisFen,
    rashod_fen: row.rashodFen,
    policija_fen: row.policijaFen,
    osoblje_fen: row.osobljeFen,
    roba_fen: row.robaFen,
    okusi_fen: row.okusiFen,
    zar_fen: row.zarFen,
    kafa_fen: row.kafaFen,
    merkator_fen: row.merkatorFen,
    extras: readExtras(row.extrasJson),
    extra_fen: row.extraFen,
    // The šanker's number stays on the row; what is left of the shift is it
    // less what was paid out of it afterwards.
    za_predati_fen: row.zaPredatiFen - naknadniFen,
    za_predati_at_close_fen: row.zaPredatiFen,
    naknadni,
    naknadni_fen: naknadniFen,
    note: row.note,
  }
}

// ===========================================================================
// Naknadni troškovi (17.09.2026)
// ===========================================================================

/** A closed shift's *naknadni troškovi*, oldest first. */
export function listShiftExtraCosts(
  q: Queryable, venueId: string, shiftId: string,
): ShiftExtraCost[] {
  const names = userNames(q, venueId)
  return q.select().from(schema.shiftExtraCosts)
    .where(and(
      eq(schema.shiftExtraCosts.venueId, venueId),
      eq(schema.shiftExtraCosts.shiftId, shiftId),
    ))
    .orderBy(schema.shiftExtraCosts.createdAt, schema.shiftExtraCosts.id)
    .all()
    .map(row => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      amount_fen: row.amountFen,
      delivery_id: row.deliveryId,
      invoice: row.deliveryId ? readInvoice(q, venueId, row.deliveryId, names) : null,
      created_at: row.createdAt,
      created_by_name: names.get(row.createdBy) ?? '—',
    }))
}

/** The invoice a naknadni trošak pays, line by line, with each article's category. */
function readInvoice(
  q: Queryable, venueId: string, deliveryId: string, names: Map<string, string>,
): ShiftCostInvoice | null {
  const d = q.select().from(schema.deliveries)
    .where(and(eq(schema.deliveries.venueId, venueId), eq(schema.deliveries.id, deliveryId)))
    .get()
  if (!d) return null
  const lines = q.select({
    itemName: schema.stockItems.name,
    categoryName: schema.categories.name,
    qty: schema.deliveryLines.qty,
    baseUnit: schema.stockItems.baseUnit,
    lineCostFen: schema.deliveryLines.lineCostFen,
  })
    .from(schema.deliveryLines)
    .innerJoin(schema.stockItems, eq(schema.stockItems.id, schema.deliveryLines.stockItemId))
    .leftJoin(schema.categories, eq(schema.categories.id, schema.stockItems.categoryId))
    .where(and(eq(schema.deliveryLines.venueId, venueId), eq(schema.deliveryLines.deliveryId, deliveryId)))
    .all()
  return {
    delivered_at: d.deliveredAt,
    supplier_name: d.supplierName,
    invoice_no: d.invoiceNo,
    entered_by_name: names.get(d.enteredBy) ?? '—',
    total_fen: d.totalFen,
    reversed_at: d.reversedAt,
    lines: lines.map(line => ({
      item_name: line.itemName,
      category_name: line.categoryName ?? null,
      qty: line.qty,
      base_unit: line.baseUnit,
      line_cost_fen: line.lineCostFen,
    })),
  }
}

/**
 * `POST /api/owner/shift/:id/naknadni-troskovi` — something paid out of this
 * shift's takings after the šanker closed it.
 *
 * Only a shift that **has** a closing: before the close the šanker types his
 * payouts himself, and a cost added to an open night would have no *Za predati*
 * to come off. A retried tap (same `client_id`) is the stored cost. Answers the
 * closing again, with the cost on it and *Za predati* lowered.
 */
export function addShiftExtraCost(
  db: Db, venueId: string, actor: Actor, shiftId: string, body: AddShiftExtraCostBody,
  now = nowIso(),
): ShiftClosing {
  db.transaction((tx) => {
    const replay = tx.select().from(schema.shiftExtraCosts)
      .where(and(
        eq(schema.shiftExtraCosts.venueId, venueId),
        eq(schema.shiftExtraCosts.clientId, body.client_id),
      ))
      .get()
    if (replay) {
      if (replay.shiftId !== shiftId) throw conflict('EXTRA_COST_CLIENT_REUSED', 'that client_id belongs to another shift')
      return
    }

    const shift = requireShift(tx, venueId, shiftId)
    if (!getClosingRow(tx, venueId, shiftId)) {
      throw conflict('SHIFT_NOT_CLOSED', `shift ${shiftId} has no closing yet`)
    }

    // The amount is the invoice's, never a number from the page.
    const delivery = tx.select().from(schema.deliveries)
      .where(and(eq(schema.deliveries.venueId, venueId), eq(schema.deliveries.id, body.delivery_id)))
      .get()
    if (!delivery) throw notFound('DELIVERY_NOT_FOUND', `delivery ${body.delivery_id} not found`)
    if (delivery.reversedAt) throw conflict('DELIVERY_ALREADY_REVERSED', `delivery ${delivery.id} is reversed`)
    if (businessDate(delivery.deliveredAt) !== shift.businessDate) {
      throw conflict('INVOICE_OTHER_DAY', `delivery ${delivery.id} is not from ${shift.businessDate}`)
    }
    const paid = tx.select({ id: schema.shiftExtraCosts.id }).from(schema.shiftExtraCosts)
      .where(and(
        eq(schema.shiftExtraCosts.venueId, venueId),
        eq(schema.shiftExtraCosts.deliveryId, delivery.id),
      ))
      .get()
    if (paid) throw conflict('INVOICE_ALREADY_PAID', `delivery ${delivery.id} is already paid from a shift`)

    const kind = 'roba' as const
    const [y, m, d] = businessDate(delivery.deliveredAt).split('-')
    const label = `Faktura ${d}.${m}.${y}.${delivery.supplierName ? ` · ${delivery.supplierName}` : ''}`.slice(0, 80)
    const amountFen = delivery.totalFen
    const id = newId()
    tx.insert(schema.shiftExtraCosts).values({
      id, venueId, shiftId, clientId: body.client_id, kind, label,
      amountFen, deliveryId: delivery.id, createdBy: actor.userId, createdAt: now,
    }).run()

    log(tx, venueId, {
      kind: 'settings_changed',
      body: {
        key: `shift_extra_cost.${shiftId}.${id}.amount_fen`,
        label: `Naknadni trošak · ${shiftCostText({ kind, label })} · smjena ${shift.businessDate}`,
        before: 0,
        after: amountFen,
      },
      actorId: actor.userId,
      ref: { type: 'shift', id: shiftId },
      shiftId,
      at: now,
    })
    bump(tx, venueId, 'shift', shiftId)
  })
  return getClosing(db, venueId, shiftId)!
}

/** `DELETE /api/owner/shift/:id/naknadni-troskovi/:costId` — a mistyped cost, gone. */
export function deleteShiftExtraCost(
  db: Db, venueId: string, actor: Actor, shiftId: string, costId: string, now = nowIso(),
): ShiftClosing {
  db.transaction((tx) => {
    const row = tx.select().from(schema.shiftExtraCosts)
      .where(and(
        eq(schema.shiftExtraCosts.venueId, venueId),
        eq(schema.shiftExtraCosts.shiftId, shiftId),
        eq(schema.shiftExtraCosts.id, costId),
      ))
      .get()
    if (!row) throw notFound('EXTRA_COST_NOT_FOUND', `extra cost ${costId} not found on shift ${shiftId}`)
    const shift = requireShift(tx, venueId, shiftId)

    tx.delete(schema.shiftExtraCosts).where(eq(schema.shiftExtraCosts.id, costId)).run()

    log(tx, venueId, {
      kind: 'settings_changed',
      body: {
        key: `shift_extra_cost.${shiftId}.${costId}.amount_fen`,
        label: `Naknadni trošak uklonjen · ${shiftCostText({ kind: row.kind, label: row.label })} · smjena ${shift.businessDate}`,
        before: row.amountFen,
        after: 0,
      },
      actorId: actor.userId,
      ref: { type: 'shift', id: shiftId },
      shiftId,
      at: now,
    })
    bump(tx, venueId, 'shift', shiftId)
  })
  return getClosing(db, venueId, shiftId)!
}

function getClosingRow(q: Queryable, venueId: string, shiftId: string): ClosingRow | undefined {
  return q.select().from(schema.shiftClosings)
    .where(and(
      eq(schema.shiftClosings.venueId, venueId),
      eq(schema.shiftClosings.shiftId, shiftId),
    ))
    .get()
}

/** The stored closing of a shift, or `null`. Used by the owner's *Smjena* too. */
export function getClosing(q: Queryable, venueId: string, shiftId: string): ShiftClosing | null {
  const row = q.select().from(schema.shiftClosings)
    .where(and(
      eq(schema.shiftClosings.venueId, venueId),
      eq(schema.shiftClosings.shiftId, shiftId),
    ))
    .get()
  return row ? toView(q, venueId, row) : null
}

/**
 * `GET /api/shifts/:id/zakljucenje` — what the šanker reads before he types.
 *
 * A shift already closed answers with its stored row and the stored numbers, so
 * a reload after *Zaključi* lands on the done state and not on a fresh form.
 */
export function closingPreview(
  q: Queryable, venueId: string, actor: Actor, shiftId: string,
): ClosingPreview {
  requireSanker(actor)
  const shift = requireShift(q, venueId, shiftId)
  const closing = getClosing(q, venueId, shiftId)
  if (closing) {
    return {
      shift_id: shift.id,
      business_date: shift.businessDate,
      status: shift.status,
      prihod_fen: closing.prihod_fen,
      dnevnica_fen: closing.dnevnica_fen,
      otpis_fen: closing.otpis_fen,
      rashod_fen: closing.rashod_fen,
      policija_fen: closing.policija_fen,
      osoblje_fen: closing.osoblje_fen,
      open_tabs: [],
      closing,
    }
  }
  return {
    shift_id: shift.id,
    business_date: shift.businessDate,
    status: shift.status,
    ...serverNumbers(q, venueId, shiftId, nowIso()),
    open_tabs: openTabsOn(q, venueId, shiftId),
    closing: null,
  }
}

/**
 * `POST /api/shifts/:id/zakljucenje` — *Zaključi smjenu*.
 *
 * One transaction (everything inside commits together or not at all): the
 * mode, the replay, the second-closing refusal, the open-tab refusal, the
 * server's numbers, the row, the shift closed, members sent home, a summary
 * version, the log entry and the change-feed bump.
 */
export function closeByBar(
  db: Db, venueId: string, actor: Actor, shiftId: string, body: CloseByBarInput,
): ShiftClosing {
  const at = nowIso()

  return db.transaction((tx) => {
    requireSanker(actor)

    // A retry of the same tap: the stored answer, 200, and nothing written.
    const replay = tx.select().from(schema.shiftClosings)
      .where(and(
        eq(schema.shiftClosings.venueId, venueId),
        eq(schema.shiftClosings.clientId, body.client_id),
      ))
      .get()
    if (replay) {
      if (replay.shiftId !== shiftId) {
        throw conflict('CLOSING_EXISTS', 'that client_id already closed another shift')
      }
      return toView(tx, venueId, replay)
    }

    const shift = requireShift(tx, venueId, shiftId)
    if (getClosing(tx, venueId, shiftId)) {
      throw conflict('CLOSING_EXISTS', `shift ${shiftId} already has a closing`)
    }
    if (shift.status !== 'open' && shift.status !== 'closing') {
      throw conflict('SHIFT_CLOSED', `shift ${shiftId} is ${shift.status}`)
    }
    assertNoOpenTabs(tx, venueId, shiftId)

    const numbers = serverNumbers(tx, venueId, shiftId, at)
    const extras = cleanExtras(body.extras)
    const amounts = {
      ...numbers,
      // Retired payouts (17.09.2026): staff pay for none of these now.
      roba_fen: 0,
      okusi_fen: 0,
      zar_fen: 0,
      kafa_fen: 0,
      merkator_fen: body.merkator_fen,
      extra_fen: extras.reduce((sum, extra) => sum + extra.fen, 0),
    }
    const result = zaPredati(amounts)
    const note = body.note?.trim() ?? ''

    const id = newId()
    tx.insert(schema.shiftClosings).values({
      id,
      venueId,
      shiftId,
      clientId: body.client_id,
      closedBy: actor.userId,
      deviceId: actor.deviceId,
      prihodFen: amounts.prihod_fen,
      dnevnicaFen: amounts.dnevnica_fen,
      otpisFen: amounts.otpis_fen,
      rashodFen: amounts.rashod_fen,
      policijaFen: amounts.policija_fen,
      osobljeFen: amounts.osoblje_fen,
      robaFen: amounts.roba_fen,
      okusiFen: amounts.okusi_fen,
      zarFen: amounts.zar_fen,
      kafaFen: amounts.kafa_fen,
      merkatorFen: amounts.merkator_fen,
      extraFen: amounts.extra_fen,
      extrasJson: extras.length > 0 ? JSON.stringify(extras) : null,
      zaPredatiFen: result,
      note: note === '' ? null : note,
      createdAt: at,
    }).run()

    // `cash_counted_fen` stays NULL: nobody counted the drawer, and writing the
    // *Za predati* there would put a subtraction where *Smjena* expects a count.
    tx.update(schema.shifts)
      .set({
        status: 'closed',
        closedAt: at,
        closedBy: actor.userId,
        closedKind: 'normal',
        closingNote: note === '' ? null : note,
      })
      .where(eq(schema.shifts.id, shiftId))
      .run()

    autoLeave(tx, venueId, shiftId, at)
    writeSummaryVersion(tx, venueId, shiftId, 'close', at)

    log(tx, venueId, {
      kind: 'shift_closed_by_bar',
      body: {
        shift_id: shiftId,
        closing_id: id,
        prihod_fen: amounts.prihod_fen,
        za_predati_fen: result,
      },
      actorId: actor.userId,
      deviceId: actor.deviceId,
      ref: { type: 'shift', id: shiftId },
      shiftId,
    })
    bump(tx, venueId, 'shift', shiftId)

    return toView(tx, venueId, tx.select().from(schema.shiftClosings)
      .where(eq(schema.shiftClosings.id, id)).get()!)
  })
}
