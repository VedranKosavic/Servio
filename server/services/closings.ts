/**
 * *Zaključi smjenu* — the šanker closes the whole night with a subtraction.
 *
 * The owner's decision (15.09.2026): the waiter no longer settles, nobody counts
 * the drawer, and the only end of a shift a worker has is this one, on the bar.
 *
 *     Sav prihod − Dnevnica − Otpis − Rashod − Policija − Plaćanje robe
 *       − Plaćanje okusa za nargilu − Plaćanje žara − Merkator = Za predati
 *
 * **The server owns the first five.** *Sav prihod* is the shift's promet, read
 * out of `summarizeShift` — the same call that writes `shift_summaries`, so the
 * closing, the summary and *Smjena* cannot print three different nights.
 * *Dnevnica* is `settings.dnevnica_fen`, once per shift.
 *
 * *Otpis*, *Rashod* and *Policija* are the three categories a table is marked
 * with while the night runs (the owner's call, 16.09.2026: "if we mark policija
 * or rashod in that sheet it should come off by itself, the same as dnevnica").
 * They are all one shape in the ledger — a tab closed with money still on it and
 * nobody owing it — so `shiftCategories` is where they are counted, and the
 * closing subtracts what it finds. Ringing them up is what moved the stock and
 * put them in the promet; this is where they come back out, once. Nobody types
 * them, so nobody can type them twice.
 *
 * The phone sends only the four amounts nobody but the šanker can know.
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
import { conflict, forbidden } from '../utils/errors'
import { newId, nowIso } from '../utils/ids'
import { zaPredati } from '#shared/closing'
import type { ClosingPreview, ShiftClosing, UnpaidReason } from '#shared/types'
import type { Actor, Db, Queryable } from './types'
import { bump, getSettings, log } from './contracts'
import { shiftCategories } from './cash'
import {
  assertNoOpenTabs, autoLeave, openTabsOn, requireShift, userNames,
} from './shifts'
import { summarizeShift, writeSummaryVersion } from './summaries'

type ClosingRow = typeof schema.shiftClosings.$inferSelect

/** The four typed amounts, as `closeByBarBody` has already parsed them. */
export interface CloseByBarInput {
  client_id: string
  roba_fen: number
  okusi_fen: number
  zar_fen: number
  merkator_fen: number
  note?: string
}

/** Only a šanker-mode session closes the shift. The role is not the question. */
export function requireSanker(actor: Actor): void {
  if (actor.mode !== 'sanker') {
    throw forbidden('NOT_SANKER', 'only a session in sanker mode closes the shift')
  }
}

/**
 * The server's five numbers for a shift, right now.
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
 * `osoblje`, the fourth authorised category, is deliberately **not** here — the
 * owner named three, and a staff drink is a separate decision he has not made.
 */
function serverNumbers(
  q: Queryable, venueId: string, shiftId: string, now: string,
): {
  prihod_fen: number, dnevnica_fen: number
  otpis_fen: number, rashod_fen: number, policija_fen: number
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
  }
}

function toView(q: Queryable, venueId: string, row: ClosingRow): ShiftClosing {
  const shift = requireShift(q, venueId, row.shiftId)
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
    roba_fen: row.robaFen,
    okusi_fen: row.okusiFen,
    zar_fen: row.zarFen,
    merkator_fen: row.merkatorFen,
    za_predati_fen: row.zaPredatiFen,
    note: row.note,
  }
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
    const amounts = {
      ...numbers,
      roba_fen: body.roba_fen,
      okusi_fen: body.okusi_fen,
      zar_fen: body.zar_fen,
      merkator_fen: body.merkator_fen,
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
      robaFen: amounts.roba_fen,
      okusiFen: amounts.okusi_fen,
      zarFen: amounts.zar_fen,
      merkatorFen: amounts.merkator_fen,
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
