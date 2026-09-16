/**
 * *Zaključi smjenu* — the šanker's close.
 *
 * The owner's rule is a subtraction:
 *
 *     Sav prihod − Dnevnica − Otpis − Rashod − Policija − Plaćanje robe
 *       − Plaćanje okusa za nargilu − Plaćanje žara − Merkator = Za predati
 *
 * and what this file pins is where each term comes from: prihod **is** the
 * summary's promet, otpis **is** the summary's waste value *plus* the tabs
 * marked *Otpis*, rashod and policija **are** the tabs marked with them,
 * dnevnica is the venue setting taken once per shift, and nothing the phone
 * could send changes any of those five.
 *
 * No `vi.mock` here, on purpose: `log` and `bump` run for real against the
 * in-memory database, so "the close wrote an entry and moved the feed" is an
 * assertion about rows, not about a spy.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { closeTab, refuses } from '../helpers/shifts'
import { closeByBar, closingPreview } from '../../server/services/closings'
import { markUnpaid } from '../../server/services/tabs'
import { forceClose } from '../../server/services/shifts'
import { getMyShift, latestSummary, summarizeShift } from '../../server/services/summaries'
import { ensureOpenShift } from '../../server/services/contracts'
import { getOwnerShift, listOwnerShifts } from '../../server/services/owner'
import { zaPredati } from '#shared/closing'
import { closeByBarBody } from '#shared/schemas'
import { DEFAULT_SETTINGS } from '#shared/settings'

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

const ZERO = { roba_fen: 0, okusi_fen: 0, zar_fen: 0, merkator_fen: 0 }

const sanker = () => f.actor('Emir', { mode: 'sanker' })

/**
 * A night with every term in it: two paid tabs, one applied storno (which
 * leaves promet), one legacy stock otpis at purchase cost (`cost_fen` 100) and
 * one menu otpis at menu price (250).
 */
function night(): string {
  const shiftId = f.openShift({ members: ['Amar', 'Emir', 'Lejla'] })

  const t1 = f.lock('Amar', 'Sto 1', [{ product: 'Kafa', qty: 2 }, { product: 'Red Bull' }])
  f.pay('Amar', t1.tabId, t1.totalFen)
  closeTab(f, t1.tabId, 'Amar')

  const t2 = f.lock('Lejla', 'Sto 2', [{ product: 'Kafa' }, { product: 'Čaj' }])
  f.voidLine('Lejla', t2.lineIds[1]!, { status: 'applied', approvedBy: 'Emir' })
  f.pay('Lejla', t2.tabId, 150)
  closeTab(f, t2.tabId, 'Lejla')

  f.wasteEvent('Emir', 'Coca-Cola 0,25 l', 1)
  f.db.insert(schema.productWaste).values({
    id: randomUUID(), venueId: f.venueId, clientId: randomUUID(),
    productId: f.productId('Kafa'), qty: 1, reason: 'razbijeno',
    unitPriceFen: 250, valueFen: 250, shiftId, userId: f.userId('Emir'),
    createdAt: f.clock.now(),
  }).run()

  return shiftId
}

/**
 * Close a tab the way the floor sheet does: *Policija*, *Rashod* or *Otpis*,
 * through the real route, so what the closing reads is what a waiter writes.
 */
function markCategory(tabId: string, by: string, reason: 'policija' | 'rashod' | 'otpis') {
  const tab = f.db.select().from(schema.tabs).where(eq(schema.tabs.id, tabId)).get()!
  markUnpaid(f.db, f.venueId, f.actor(by), {
    client_id: randomUUID(), tab_client_id: tab.clientId, reason,
  })
}

function closingRows(shiftId: string) {
  return f.db.select().from(schema.shiftClosings)
    .where(and(eq(schema.shiftClosings.venueId, f.venueId), eq(schema.shiftClosings.shiftId, shiftId)))
    .all()
}

describe('the numbers', () => {
  it('takes prihod from promet, otpis from the summary, dnevnica from the setting', () => {
    const shiftId = night()
    f.settingsWith({ dnevnica_fen: 5_000 })
    const summary = summarizeShift(f.db, f.venueId, shiftId, f.clock.now())

    const preview = closingPreview(f.db, f.venueId, sanker(), shiftId)
    expect(preview.prihod_fen).toBe(summary.promet_fen)
    expect(preview.prihod_fen).toBeGreaterThan(0)
    expect(preview.otpis_fen).toBe(summary.waste_fen)
    expect(preview.otpis_fen).toBe(350)
    expect(preview.dnevnica_fen).toBe(5_000)
    // Nothing was marked on a table tonight, so these two are the empty sum.
    expect(preview.rashod_fen).toBe(0)
    expect(preview.policija_fen).toBe(0)
    expect(preview.open_tabs).toEqual([])
    expect(preview.closing).toBeNull()

    const typed = { roba_fen: 2_000, okusi_fen: 300, zar_fen: 400, merkator_fen: 500 }
    const closing = closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: randomUUID(), ...typed })

    // The stored server numbers are the ones the šanker was shown.
    expect(closing.prihod_fen).toBe(preview.prihod_fen)
    expect(closing.otpis_fen).toBe(preview.otpis_fen)
    expect(closing.dnevnica_fen).toBe(preview.dnevnica_fen)
    expect(closing.za_predati_fen).toBe(
      preview.prihod_fen - 5_000 - 350 - 2_000 - 300 - 400 - 500,
    )
    expect(closing.closed_by_name).toBe('Emir')

    // …and the written summary agrees with the closing to the fen.
    const written = latestSummary(f.db, f.venueId, shiftId)!
    expect(written.reason).toBe('close')
    expect(written.promet_fen).toBe(closing.prihod_fen)
    expect(written.waste_fen).toBe(closing.otpis_fen)

    // A reload of the preview is the stored row, not a recomputation.
    const again = closingPreview(f.db, f.venueId, sanker(), shiftId)
    expect(again.closing?.id).toBe(closing.id)
    expect(again.prihod_fen).toBe(closing.prihod_fen)
  })

  it('subtracts the default dnevnica once per shift, however many worked it', () => {
    const shiftId = night()
    const closing = closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: randomUUID(), ...ZERO })
    expect(closing.dnevnica_fen).toBe(DEFAULT_SETTINGS.dnevnica_fen)
    expect(DEFAULT_SETTINGS.dnevnica_fen).toBe(9_000)
    expect(closing.za_predati_fen).toBe(closing.prihod_fen - 9_000 - closing.otpis_fen)
  })

  it('may come out negative, and stores it as it is', () => {
    const shiftId = f.openShift({ members: ['Emir'] })
    const closing = closeByBar(f.db, f.venueId, sanker(), shiftId, {
      client_id: randomUUID(), ...ZERO, roba_fen: 1_234,
    })
    expect(closing.prihod_fen).toBe(0)
    expect(closing.za_predati_fen).toBe(-9_000 - 1_234)
  })

  it('has one arithmetic, shared with the screen', () => {
    expect(zaPredati({
      prihod_fen: 50_000, dnevnica_fen: 9_000, otpis_fen: 700,
      rashod_fen: 100, policija_fen: 50, roba_fen: 200, okusi_fen: 300,
      zar_fen: 400, merkator_fen: 500,
    })).toBe(38_750)
  })

  /**
   * The owner's call of 16.09.2026: a table marked *Policija*, *Rashod* or
   * *Otpis* comes off the night by itself, the way *Dnevnica* does. It was rung
   * up like any round — that is what moved the stock and put it in the promet —
   * so the closing is where it comes back out, once, and nobody types it.
   */
  it('subtracts what was marked on the tables, with nothing typed', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Emir'] })

    const paid = f.lock('Amar', 'Sto 1', [{ product: 'Red Bull' }]) // 500
    f.pay('Amar', paid.tabId, paid.totalFen)
    closeTab(f, paid.tabId, 'Amar')

    const police = f.lock('Amar', 'Sto 2', [{ product: 'Kafa', qty: 2 }]) // 300
    markCategory(police.tabId, 'Amar', 'policija')
    const admin = f.lock('Amar', 'Sto 3', [{ product: 'Coca-Cola' }]) // 300
    markCategory(admin.tabId, 'Amar', 'rashod')
    const spilled = f.lock('Amar', 'Sto 4', [{ product: 'Čaj' }]) // 200
    markCategory(spilled.tabId, 'Amar', 'otpis')

    const preview = closingPreview(f.db, f.venueId, sanker(), shiftId)
    expect(preview.prihod_fen).toBe(1_300) // all four rounds are in the promet
    expect(preview.policija_fen).toBe(300)
    expect(preview.rashod_fen).toBe(300)
    expect(preview.otpis_fen).toBe(200) // no product_waste row tonight
    expect(preview.open_tabs).toEqual([])

    const closing = closeByBar(f.db, f.venueId, sanker(), shiftId, {
      client_id: randomUUID(), ...ZERO,
    })
    expect(closing.policija_fen).toBe(300)
    expect(closing.rashod_fen).toBe(300)
    expect(closing.otpis_fen).toBe(200)
    // What is left to hand over is the one round somebody actually paid for,
    // minus the day's wage.
    expect(closing.za_predati_fen).toBe(1_300 - 9_000 - 200 - 300 - 300)
  })

  it('adds a tab marked Otpis to the otpis of the store room', () => {
    const shiftId = night() // 350 of product_waste + waste_events
    const spilled = f.lock('Amar', 'Sto 5', [{ product: 'Kafa' }]) // 150
    markCategory(spilled.tabId, 'Amar', 'otpis')

    const closing = closeByBar(f.db, f.venueId, sanker(), shiftId, {
      client_id: randomUUID(), ...ZERO,
    })
    expect(closing.otpis_fen).toBe(350 + 150)
  })
})

describe('who may close', () => {
  it('refuses a konobar session, a session with no mode and an admin session', () => {
    const shiftId = night()
    const body = { client_id: randomUUID(), ...ZERO }
    refuses(() => closeByBar(f.db, f.venueId, f.actor('Amar', { mode: 'konobar' }), shiftId, body), 'NOT_SANKER', 403)
    refuses(() => closeByBar(f.db, f.venueId, f.actor('Amar'), shiftId, body), 'NOT_SANKER', 403)
    refuses(() => closeByBar(f.db, f.venueId, f.adminActor(), shiftId, body), 'NOT_SANKER', 403)
    refuses(() => closingPreview(f.db, f.venueId, f.actor('Amar', { mode: 'konobar' }), shiftId), 'NOT_SANKER', 403)
    expect(closingRows(shiftId)).toHaveLength(0)
    expect(f.db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId)).get()!.status).toBe('open')
  })

  it('lets the same worker close once his session is on the šank', () => {
    const shiftId = night()
    const closing = closeByBar(f.db, f.venueId, f.actor('Amar', { mode: 'sanker' }), shiftId, {
      client_id: randomUUID(), ...ZERO,
    })
    expect(closing.closed_by).toBe(f.userId('Amar'))
  })

  it('leaves the admin force-close working', () => {
    const shiftId = night()
    const result = forceClose(f.db, f.venueId, f.adminActor(), shiftId, { note: 'telefon crko' })
    expect(result.shift.status).toBe('closed')
    expect(result.shift.closed_kind).toBe('forced')
    // A forced night has no šanker closing, and the šanker cannot add one after.
    refuses(() => closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: randomUUID(), ...ZERO }), 'SHIFT_CLOSED', 409)
  })
})

describe('what it refuses and what it replays', () => {
  it('refuses while a tab is open, naming the table', () => {
    const shiftId = night()
    f.lock('Amar', 'Sto 7', [{ product: 'Kafa' }])

    expect(closingPreview(f.db, f.venueId, sanker(), shiftId).open_tabs.map(t => t.table_name))
      .toEqual(['Sto 7'])
    try {
      closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: randomUUID(), ...ZERO })
      throw new Error('expected OPEN_TABS')
    } catch (err) {
      const e = err as { code: string, status: number, data: { tabs: { table_name: string }[] } }
      expect(e.code).toBe('OPEN_TABS')
      expect(e.status).toBe(409)
      expect(e.data.tabs.map(t => t.table_name)).toEqual(['Sto 7'])
    }
    expect(closingRows(shiftId)).toHaveLength(0)
  })

  it('refuses a second closing of the same shift with 409', () => {
    const shiftId = night()
    closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: randomUUID(), ...ZERO })
    refuses(
      () => closeByBar(f.db, f.venueId, f.actor('Amar', { mode: 'sanker' }), shiftId, { client_id: randomUUID(), ...ZERO }),
      'CLOSING_EXISTS', 409,
    )
    expect(closingRows(shiftId)).toHaveLength(1)
  })

  it('answers a replay of the same client_id with the stored row and writes nothing', () => {
    const shiftId = night()
    const clientId = randomUUID()
    const first = closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: clientId, ...ZERO, roba_fen: 700 })
    const changesBefore = f.db.select().from(schema.changes).all().length
    const logsBefore = f.db.select().from(schema.logEntries).all().length

    // Different amounts on the retry change nothing: the first answer stands.
    const replay = closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: clientId, ...ZERO, roba_fen: 1 })
    expect(replay).toEqual(first)
    expect(closingRows(shiftId)).toHaveLength(1)
    expect(f.db.select().from(schema.changes).all()).toHaveLength(changesBefore)
    expect(f.db.select().from(schema.logEntries).all()).toHaveLength(logsBefore)
  })

  it('validates the body: defaults to 0, no negatives, nothing the server computes', () => {
    const parsed = closeByBarBody.parse({ client_id: randomUUID(), roba_fen: 500 })
    expect(parsed).toMatchObject({ roba_fen: 500, okusi_fen: 0, zar_fen: 0, merkator_fen: 0 })
    expect(closeByBarBody.safeParse({ client_id: randomUUID(), roba_fen: -1 }).success).toBe(false)
    expect(closeByBarBody.safeParse({ client_id: randomUUID(), roba_fen: 1.5 }).success).toBe(false)
    expect(closeByBarBody.safeParse({ client_id: randomUUID(), prihod_fen: 1 }).success).toBe(false)
    // The five the server computes are refused by name, so a phone cannot
    // subtract a rashod twice by sending one.
    for (const key of ['prihod_fen', 'dnevnica_fen', 'otpis_fen', 'rashod_fen', 'policija_fen']) {
      expect(closeByBarBody.safeParse({ client_id: randomUUID(), [key]: 1 }).success).toBe(false)
    }
    expect(closeByBarBody.safeParse({ ...ZERO }).success).toBe(false)
  })
})

describe('the shift after', () => {
  it('closes the whole shift: status, members, summary, log, feed', () => {
    const shiftId = night()
    const seqBefore = f.db.select().from(schema.changes).all().length
    closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: randomUUID(), ...ZERO })

    const shift = f.db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId)).get()!
    expect(shift.status).toBe('closed')
    expect(shift.closedKind).toBe('normal')
    expect(shift.closedBy).toBe(f.userId('Emir'))
    expect(shift.cashCountedFen).toBeNull()

    const members = f.db.select().from(schema.shiftMembers)
      .where(eq(schema.shiftMembers.shiftId, shiftId)).all()
    expect(members.every(m => m.leftAt !== null && m.leftAtSource === 'auto')).toBe(true)

    const entry = f.db.select().from(schema.logEntries)
      .where(eq(schema.logEntries.kind, 'shift_closed_by_bar')).get()
    expect(entry?.titleBs).toMatch(/^Smjena zaključena · prihod .* · za predati /)

    const bumps = f.db.select().from(schema.changes).all()
    expect(bumps.length).toBeGreaterThan(seqBefore)
    expect(bumps.at(-1)).toMatchObject({ entity: 'shift', entityId: shiftId })
  })

  it('opens a new shift with the next locked round', () => {
    const shiftId = night()
    closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: randomUUID(), ...ZERO })

    const next = f.db.transaction(tx => ensureOpenShift(tx, f.venueId, f.actor('Amar'), f.clock.now()))
    expect(next.created).toBe(true)
    expect(next.shift.id).not.toBe(shiftId)
    // The new night starts from zero: no closing, no promet carried over.
    expect(summarizeShift(f.db, f.venueId, next.shift.id, f.clock.now()).promet_fen).toBe(0)
  })

  it('shows a waiter his own totals once the shift is closed', () => {
    const shiftId = night()
    expect(getMyShift(f.db, f.venueId, f.userId('Amar')).last_closed).toBeNull()

    closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: randomUUID(), ...ZERO })

    const mine = getMyShift(f.db, f.venueId, f.userId('Amar'))
    expect(mine.shift).toBeNull()
    expect(mine.last_closed?.shift_id).toBe(shiftId)
    const byUser = summarizeShift(f.db, f.venueId, shiftId, f.clock.now()).by_user
    expect(mine.last_closed?.summary.promet_fen).toBe(byUser.find(u => u.name === 'Amar')!.promet_fen)
    expect(mine.last_closed?.summary.promet_fen).toBeGreaterThan(0)
  })

  it('gives the owner the closing on Smjena and Za predati on Smjene', () => {
    const shiftId = night()
    expect(getOwnerShift(f.db, f.venueId, shiftId).closing).toBeNull()
    const closing = closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: randomUUID(), ...ZERO })

    expect(getOwnerShift(f.db, f.venueId, shiftId).closing).toEqual(closing)
    const row = listOwnerShifts(f.db, f.venueId, '2000-01-01', '2999-12-31').find(r => r.id === shiftId)
    expect(row?.za_predati_fen).toBe(closing.za_predati_fen)
  })
})

describe('append-only', () => {
  it('refuses an update and a delete of a closing', () => {
    const shiftId = night()
    const closing = closeByBar(f.db, f.venueId, sanker(), shiftId, { client_id: randomUUID(), ...ZERO })
    f.expectRefused(`UPDATE shift_closings SET za_predati_fen = 0 WHERE id = '${closing.id}'`, 'append-only')
    f.expectRefused(`DELETE FROM shift_closings WHERE id = '${closing.id}'`, 'append-only')
  })
})
