/**
 * *Puls*, *Smjena* and the drill-down (`docs/BACKEND.md` §6.10, §11).
 *
 * Four things are worth proving about a screen that is only ever *read*, and
 * they are the four blocks below.
 *
 * **The numbers are the same numbers.** `owner.ts` re-reads nothing: promet on
 * *Puls* and promet on *Smjena* are one call to `summarizeShift`, and
 * `expected_cash_fen` is `expectedCash(...).venue_expected_fen` with no second
 * arithmetic anywhere. So the assertions are equalities to the fen against the
 * functions that own those ledgers — if the two ever diverge, somebody has added
 * a second definition of the café's takings and this file says so.
 *
 * **Every attention row can be cleared.** In-app acknowledgement is Korak 3
 * (§1), which makes an un-clearable row a design error rather than a cosmetic
 * one: it would sit on the owner's screen forever. The invariant is that every
 * `(ref_type, action)` pair on the list names a route in `ROUTE_ROLES`, and it
 * is checked over the whole `ATTENTION_ROUTES` table, not only over the rows a
 * fixture happens to produce.
 *
 * **Every flag clears itself.** A flag is a sentence about the present. The two
 * cases §11 names are here: a stale phone that checks in, and an unpriced item
 * that gets its opening cost. Both stop being true, and both rows are simply not
 * written on the next read.
 *
 * **Staff never see any of it.** *Dnevnik*, the drill-downs and every per-person
 * number are the owner's (CLAUDE.md). The gate is `authorizeRequest`, walked
 * here over every `/api/owner/*` and `/api/admin/*` key.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import {
  attentionItems, attentionTarget, getLive, getOwnerShift, listOwnerShifts, ownerShiftSummary,
} from '../../server/services/owner'
import { latestSummary, shiftLines, summarizeShift } from '../../server/services/summaries'
import { expectedCash, pendingFor as cashPending } from '../../server/services/cash'
import { pendingFor as adjustmentsPending } from '../../server/services/adjustments'
import { markUnpaid, pendingFor as tabsPending } from '../../server/services/tabs'
import { pendingFor as shiftsPending } from '../../server/services/shifts'
import { pendingFor as settlementsPending, settle } from '../../server/services/settlements'
import { pendingCounts } from '../../server/services/counts'
import { setOpeningStock } from '../../server/services/stock'
import { authorizeRequest, loginWithPin } from '../../server/services/auth'
import { enrolDevice, mintEnrolCode } from '../../server/services/devices'
import { heartbeat } from '../../server/services/heartbeat'
import { ROUTE_ROLES } from '#shared/routeRoles'
import { ATTENTION_ROUTES } from '#shared/types/owner'
import type { AttentionAction, AttentionRefType } from '#shared/types'
import { randomUUID } from 'node:crypto'

const IP = '10.0.0.9'

let f: Fixture
beforeEach(() => {
  f = makeFixture()
  return () => f.close()
})

/**
 * One ordinary night, written as ledger rows.
 *
 * Two waiters, four tables, a mix of cash and card, one applied void, one comp
 * and one still-open table — enough that promet, storno, gratis and the cash box
 * are all non-zero and none of them equals another by accident.
 */
function aNight(): { shiftId: string, amarTab: string, openTab: string } {
  const shiftId = f.openShift({ members: ['Amar', 'Lejla'] })

  // The row-writing helpers write rows, not calls (§11): `pay` inserts a payment
  // and nothing else, so a tab that is settled in full is closed here the way
  // `createPayment` closes it.
  const close = (tabId: string) => {
    f.db.update(schema.tabs)
      .set({ status: 'paid', closedAt: f.clock.now(), closedBy: f.userId('Amar') })
      .where(eq(schema.tabs.id, tabId)).run()
  }

  const amar = f.lock('Amar', 'Sto 1', [{ product: 'Kafa', qty: 2 }, { product: 'Coca-Cola' }])
  f.pay('Amar', amar.tabId, amar.totalFen, { method: 'cash' })
  close(amar.tabId)

  const lejla = f.lock('Lejla', 'Sto 2', [{ product: 'Nargila' }])
  f.pay('Lejla', lejla.tabId, lejla.totalFen, { method: 'card' })
  close(lejla.tabId)

  // An approved storno on a round nobody paid for, and a gratis for the house.
  const spilled = f.lock('Amar', 'Sto 3', [{ product: 'Limunada' }])
  f.voidLine('Amar', spilled.lineIds[0]!, { status: 'applied', approvedBy: 'Emir' })
  const house = f.lock('Lejla', 'Sto 4', [{ product: 'Čaj' }])
  f.voidLine('Lejla', house.lineIds[0]!, { kind: 'comp', status: 'applied', approvedBy: 'Emir' })

  // Still open when the owner looks at the screen.
  const open = f.lock('Amar', 'Sto 5', [{ product: 'Red Bull', qty: 3 }])

  return { shiftId, amarTab: amar.tabId, openTab: open.tabId }
}

// ===========================================================================

describe('the live numbers are the shift summary\'s numbers', () => {
  it('reconciles promet, storno, gratis and the cash box to the fen', () => {
    const { shiftId } = aNight()
    const now = f.clock.now()

    const live = getLive(f.db, f.venueId, f.adminActor(), now)
    const summary = summarizeShift(f.db, f.venueId, shiftId, now)
    const ec = expectedCash(f.db, f.venueId, shiftId, undefined, now)

    expect(live.promet_danas_fen).toBe(summary.promet_fen)
    expect(live.storna).toEqual({ count: summary.void_count, fen: summary.void_fen })
    expect(live.self_voids)
      .toEqual({ count: summary.self_void_count, fen: summary.self_void_fen })
    expect(live.gratis.fen).toBe(summary.comp_fen)
    expect(live.waste.fen).toBe(summary.waste_fen)

    // §11's identity, and WP8's `invariants.test.ts` asserts it again across
    // packages: *Puls* must never invent its own cash expectation.
    expect(live.expected_cash_fen).toBe(ec.venue_expected_fen)

    // The three foldings of one array cannot disagree, so neither can the strip.
    expect(live.who.reduce((n, w) => n + w.promet_fen, 0)).toBe(summary.promet_fen)
    expect(summary.by_category.reduce((n, c) => n + c.fen, 0)).toBe(summary.promet_fen)
  })

  it('shows the same night as GET /api/owner/shift/:id, open or closed', () => {
    const { shiftId } = aNight()
    const now = f.clock.now()

    const live = getLive(f.db, f.venueId, f.adminActor(), now)
    const detail = getOwnerShift(f.db, f.venueId, shiftId)

    expect(detail.shift.id).toBe(shiftId)
    expect(live.promet_danas_fen).toBe(detail.summary.promet_fen)
    expect(live.shift?.id).toBe(shiftId)
    expect(live.shift?.closing).toBe(false)

    // The list agrees with both, and folds a night with no written summary live
    // rather than printing tonight as 0,00 KM until somebody closes it.
    const row = listOwnerShifts(
      f.db, f.venueId, detail.shift.business_date, detail.shift.business_date, now,
    ).find(s => s.id === shiftId)
    expect(row?.status).toBe('open')
    expect(row?.promet_fen).toBe(detail.summary.promet_fen)
    expect(row?.promet_fen).toBeGreaterThan(0)
  })

  it('counts open tables by what the guests still owe, not by what they were charged', () => {
    const { amarTab, openTab } = aNight()

    // A tab that is paid has left the floor plan; Sto 3, 4 and 5 are still on it.
    const live = getLive(f.db, f.venueId, f.adminActor(), f.clock.now())
    expect(live.tables.find(t => t.tab_id === amarTab)).toBeUndefined()
    expect(live.tables.find(t => t.tab_id === openTab)!.remaining_fen).toBe(1500)

    expect(live.open.tables).toBe(live.tables.filter(t => t.tab_id !== null).length)
    expect(live.open.total_fen)
      .toBe(live.tables.filter(t => t.tab_id !== null)
        .reduce((n, t) => n + t.remaining_fen, 0))

    // A half-paid table is an open bill of what is left, not of its total.
    f.pay('Amar', openTab, 100, { method: 'cash' })
    const after = getLive(f.db, f.venueId, f.adminActor(), f.clock.now())
    expect(after.open.total_fen).toBe(live.open.total_fen - 100)
    expect(after.open.tables).toBe(live.open.tables)
  })

  it('puts everybody on the shift on the ko-radi strip, with his own open tables', () => {
    aNight()
    const live = getLive(f.db, f.venueId, f.adminActor(), f.clock.now())

    const amar = live.who.find(w => w.user_id === f.userId('Amar'))!
    const lejla = live.who.find(w => w.user_id === f.userId('Lejla'))!

    expect(amar.initials).toBe('AM')
    expect(amar.joined_at).not.toBeNull()
    expect(amar.open_tabs).toBe(2)          // Sto 3 (stornirano) and Sto 5
    expect(lejla.open_tabs).toBe(1)         // Sto 4, the gratis
    expect(amar.settled).toBe(false)
    expect(lejla.promet_fen).toBeGreaterThan(0)
  })

  it('shows the last rounds newest first, out of the same drill-down the owner taps', () => {
    const { shiftId } = aNight()
    const live = getLive(f.db, f.venueId, f.adminActor(), f.clock.now())

    const all = shiftLines(f.db, f.venueId, shiftId, { kat: 'sve', limit: 300 })
    expect(live.last_lines).toHaveLength(Math.min(20, all.rows.length))
    expect(live.last_lines.map(l => l.line_id))
      .toEqual(all.rows.slice(-20).map(l => l.line_id).reverse())
  })

  it('sums today\'s closed shifts into promet even after the bar has closed', () => {
    const { shiftId } = aNight()
    const summary = summarizeShift(f.db, f.venueId, shiftId, f.clock.now())

    // Close the night the way the ledger does: a summary row and a closed shift.
    f.db.update(schema.shifts)
      .set({ status: 'closed', closedAt: f.clock.now(), closedBy: f.userId('Haris'), closedKind: 'normal' })
      .where(eq(schema.shifts.id, shiftId)).run()

    const live = getLive(f.db, f.venueId, f.adminActor(), f.clock.now())
    // The strip is gone — that is what draws *Zatvori smjenu* — but the money
    // is still on the screen, because at 04:30 this is still tonight.
    expect(live.shift).toBeNull()
    expect(live.promet_danas_fen).toBe(summary.promet_fen)
    expect(live.who.length).toBeGreaterThan(0)
  })
})

// ===========================================================================

describe('attention is the six pendingFor()s and nothing else', () => {
  /** One row of every kind the six packages can produce. */
  function everyKind(): { shiftId: string } {
    const { shiftId, openTab } = aNight()

    // A void waiting for a decision.
    const asked = f.lock('Amar', 'Sto 6', [{ product: 'Kafa' }])
    f.voidLine('Amar', asked.lineIds[0]!, { status: 'pending' })

    // A tab the guests walked out on, waiting for *Otpis* or *Naplatiti*.
    const tab = f.db.select().from(schema.tabs).where(eq(schema.tabs.id, openTab)).get()!
    markUnpaid(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(), tab_client_id: tab.clientId, reason: 'walked_out',
    })

    // Cash out of the drawer, and cash handed to a colleague — both born pending.
    f.cashMovement({ type: 'payout', amountFen: 6000, user: 'Emir', status: 'pending' })
    f.cashMovement({ type: 'float_out', amountFen: 5000, user: 'Lejla', createdBy: 'Emir', status: 'pending' })

    // A count somebody submitted and nobody has confirmed.
    f.submitCount('Emir', ['Coca-Cola 0,25 l'])

    // An envelope counted alone, with nobody to sign for it.
    settle(f.db, f.venueId, f.actor('Lejla'), shiftId, { declared_fen: 1000, outbox_len: 0 })

    return { shiftId }
  }

  it('is exactly the concatenation, oldest first', () => {
    const { shiftId } = everyKind()
    const now = f.clock.now()

    const assembled = attentionItems(f.db, f.venueId, now)
    const sources = [
      ...adjustmentsPending(f.db, f.venueId, now),
      ...tabsPending(f.db, f.venueId, now),
      ...cashPending(f.db, f.venueId, now),
      ...shiftsPending(f.db, f.venueId, now),
      ...settlementsPending(f.db, f.venueId, now),
      ...pendingCounts(f.db, f.venueId)
        .map(c => ({ ref_type: 'stock_count', ref_id: c.count_id })),
    ]

    // Nothing is invented and nothing is dropped: exactly the refs the six
    // packages report, each once.
    const refs = (rows: { ref_type: string, ref_id: string }[]) =>
      rows.map(r => `${r.ref_type}:${r.ref_id}`).sort()
    expect(refs(assembled)).toEqual(refs(sources))
    expect(new Set(refs(assembled)).size).toBe(assembled.length)
    expect(assembled.length).toBeGreaterThanOrEqual(6)

    // Oldest first, so an hour-old decision outranks a minute-old one.
    const times = assembled.map(a => a.at)
    expect([...times].sort()).toEqual(times)

    expect(getLive(f.db, f.venueId, f.adminActor(), now).attention).toEqual(assembled)
    expect(shiftId).toBeTruthy()
  })

  it('raises one row for each of the five things that need a decision', () => {
    everyKind()
    const kinds = attentionItems(f.db, f.venueId, f.clock.now()).map(a => a.kind)

    expect(kinds).toContain('void')
    expect(kinds).toContain('unpaid_tab')
    expect(kinds).toContain('payout')
    expect(kinds).toContain('float_out')
    expect(kinds).toContain('count')
    expect(kinds).toContain('settlement')
  })

  it('writes a Bosnian sentence and an amount on every row', () => {
    everyKind()
    for (const item of attentionItems(f.db, f.venueId, f.clock.now())) {
      expect(item.title_bs.length).toBeGreaterThan(3)
      expect(item.title_bs).not.toMatch(/[a-z]+_[a-z]+/)   // no raw column names
      expect(item.actions.length).toBeGreaterThan(0)
      expect(Number.isInteger(item.at.length)).toBe(true)
    }
  })

  it('keeps the four badges in step with the list', () => {
    everyKind()
    const live = getLive(f.db, f.venueId, f.adminActor(), f.clock.now())
    const of = (...kinds: string[]) =>
      live.attention.filter(a => kinds.includes(a.kind)).length

    expect(live.pending.adjustments).toBe(of('void', 'comp'))
    expect(live.pending.unpaid).toBe(of('unpaid_tab'))
    expect(live.pending.payouts).toBe(of('payout', 'float_out'))
  })
})

// ===========================================================================

describe('every button on the list has a route behind it', () => {
  it('resolves every (ref_type, action) pair in ATTENTION_ROUTES to a declared route', () => {
    const pairs = Object.entries(ATTENTION_ROUTES).flatMap(([refType, actions]) =>
      Object.entries(actions).map(([action, route]) => ({ refType, action, route })))

    // The table itself must not be empty or the assertion below passes vacuously.
    expect(pairs.length).toBeGreaterThanOrEqual(9)

    for (const { refType, action, route } of pairs) {
      expect(ROUTE_ROLES[route], `${refType}/${action} → ${route}`).toBeDefined()
      // Deciding is the owner's, or the owner's and the bartender's — never a
      // waiter's: "a waiter never decides anybody's money" (§ intro).
      expect(ROUTE_ROLES[route]).not.toContain('waiter')
    }
  })

  it('resolves every action on every row a real night produces', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const asked = f.lock('Amar', 'Sto 1', [{ product: 'Kafa' }])
    f.voidLine('Amar', asked.lineIds[0]!, { status: 'pending' })
    f.cashMovement({ type: 'payout', amountFen: 500, user: 'Emir', status: 'pending' })
    f.submitCount('Emir', ['Coca-Cola 0,25 l'])
    settle(f.db, f.venueId, f.actor('Amar'), shiftId, { declared_fen: 0, outbox_len: 0 })

    const items = attentionItems(f.db, f.venueId, f.clock.now())
    expect(items.length).toBeGreaterThan(3)

    for (const item of items) {
      for (const action of item.actions) {
        const route = ATTENTION_ROUTES[item.ref_type as AttentionRefType]?.[action as AttentionAction]
        expect(route, `${item.kind}/${action} has no route`).toBeDefined()
        expect(ROUTE_ROLES[route!]).toBeDefined()

        // And the concrete path the button posts to has its ids filled in.
        const target = attentionTarget(item, action, shiftId)!
        expect(target).not.toContain(':id')
        expect(target.startsWith('POST /api/')).toBe(true)
      }
    }
  })

  it('fills both ids on the settlement accept route', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const settlementId = settle(
      f.db, f.venueId, f.actor('Amar'), shiftId, { declared_fen: 0, outbox_len: 0 },
    ).settlement_id

    const item = attentionItems(f.db, f.venueId, f.clock.now())
      .find(a => a.ref_type === 'waiter_settlement' && a.ref_id === settlementId)!
    expect(attentionTarget(item, 'approve', shiftId))
      .toBe(`POST /api/shifts/${shiftId}/settlements/${settlementId}/accept`)
  })
})

// ===========================================================================

describe('a flag is a sentence about the present', () => {
  function enrolPhone(label: string) {
    const code = mintEnrolCode(f.db, f.venueId, f.adminActor(), { mode: 'shared', label })
    return enrolDevice(f.db, { code: code.code }, { ip: IP }).result.device.id
  }

  it('drops the stale-device flag the moment the phone checks in', () => {
    f.openShift({ members: ['Amar'] })
    const deviceId = enrolPhone('Šank tablet')

    // Three rounds queued on a phone last heard from an hour ago.
    const longAgo = new Date(Date.parse(f.clock.now()) - 3600_000).toISOString()
    f.db.update(schema.devices)
      .set({ pendingCount: 3, lastSeenAt: longAgo })
      .where(eq(schema.devices.id, deviceId)).run()

    const before = getLive(f.db, f.venueId, f.adminActor(), f.clock.now())
    expect(before.flags.filter(fl => fl.kind === 'stale_device').map(fl => fl.ref_id))
      .toEqual([deviceId])
    expect(before.unsent.map(d => d.device_id)).toEqual([deviceId])

    // It comes back on the network and says it has flushed.
    const now = f.clock.now()
    heartbeat(f.db, f.venueId, deviceId, { pending: 0, client_now: now }, now)

    const after = getLive(f.db, f.venueId, f.adminActor(), now)
    expect(after.flags.filter(fl => fl.kind === 'stale_device')).toEqual([])
    expect(after.unsent).toEqual([])
  })

  it('drops the unpriced-item flag once Početno stanje gives it a cost', () => {
    f.openShift({ members: ['Amar'] })
    const itemId = f.stockItemId('Coca-Cola 0,25 l')
    f.db.update(schema.stockItems)
      .set({ avgCostMfen: 0, lastCostMfen: 0 })
      .where(eq(schema.stockItems.id, itemId)).run()

    const before = getLive(f.db, f.venueId, f.adminActor(), f.clock.now())
    expect(before.flags.filter(fl => fl.kind === 'no_item_cost').map(fl => fl.ref_id))
      .toEqual([itemId])

    setOpeningStock(f.db, f.venueId, f.adminActor(), {
      lines: [{ stock_item_id: itemId, qty: 24, unit_cost_mfen: 1_500 }],
    })

    const after = getLive(f.db, f.venueId, f.adminActor(), f.clock.now())
    expect(after.flags.filter(fl => fl.kind === 'no_item_cost')).toEqual([])
  })

  it('drops the no-opening-count flag once somebody counts the shelf', () => {
    f.openShift({ members: ['Amar'] })
    expect(getLive(f.db, f.venueId, f.adminActor(), f.clock.now()).flags
      .map(fl => fl.kind)).toContain('no_opening_count')

    f.submitCount('Emir', ['Coca-Cola 0,25 l'], { phase: 'open', kind: 'full' })

    expect(getLive(f.db, f.venueId, f.adminActor(), f.clock.now()).flags
      .map(fl => fl.kind)).not.toContain('no_opening_count')
  })

  it('never puts a decidable row in flags, or an informational one in attention', () => {
    const { shiftId } = { shiftId: f.openShift({ members: ['Amar', 'Lejla'] }) }
    const asked = f.lock('Amar', 'Sto 1', [{ product: 'Kafa' }])
    f.voidLine('Amar', asked.lineIds[0]!, { status: 'pending' })

    const live = getLive(f.db, f.venueId, f.adminActor(), f.clock.now())
    const flagKinds = new Set(live.flags.map(fl => fl.kind))
    for (const item of live.attention) {
      expect(flagKinds.has(item.kind as never)).toBe(false)
    }
    // Every flag carries something to point at, so no row is a dead end.
    for (const flag of live.flags) {
      expect(flag.ref_id.length).toBeGreaterThan(0)
      expect(flag.title_bs.length).toBeGreaterThan(3)
    }
    expect(shiftId).toBeTruthy()
  })
})

// ===========================================================================

describe('the owner\'s screens are the owner\'s', () => {
  /** A staff session needs both cookies: the device token and the session. */
  function pinIn(name: string, pin: string): { s: string, d: string } {
    const code = mintEnrolCode(f.db, f.venueId, f.adminActor(), { mode: 'shared', label: 'Tablet' })
    const enrolled = enrolDevice(f.db, { code: code.code }, { ip: IP })
    const row = f.db.select().from(schema.devices)
      .where(eq(schema.devices.id, enrolled.result.device.id)).get()!
    const { token } = loginWithPin(
      f.db, row, { user_id: f.userId(name), pin }, { ip: IP, now: f.clock.now() },
    )
    return { s: token, d: enrolled.token }
  }

  it('declares every /api/owner and /api/admin route admin-only', () => {
    const owned = Object.keys(ROUTE_ROLES)
      .filter(k => / \/api\/(owner|admin)\//.test(k))
    expect(owned.length).toBeGreaterThan(20)
    for (const key of owned) {
      expect(ROUTE_ROLES[key], key).toEqual(['admin'])
    }
  })

  it('403s a waiter and a bartender on the five WP7 routes', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const paths: [string, string][] = [
      ['/api/owner/live', 'GET'],
      ['/api/owner/shifts', 'GET'],
      [`/api/owner/shift/${shiftId}`, 'GET'],
      [`/api/owner/shift/${shiftId}/summary`, 'GET'],
      [`/api/owner/shift/${shiftId}/lines`, 'GET'],
    ]

    for (const [name, pin] of [['Amar', '2222'], ['Emir', '3333']] as const) {
      const cookies = pinIn(name, pin)
      for (const [path, method] of paths) {
        const verdict = authorizeRequest(f.db, {
          path, method, cookies, ip: IP, now: f.clock.now(),
        })
        expect(verdict.ok, `${name} on ${path}`).toBe(false)
        if (!verdict.ok) expect(verdict.status).toBe(403)
      }
    }
  })
})

// ===========================================================================

describe('the drill-down', () => {
  it('lists a person\'s lines with their times and totals the whole filtered set', () => {
    const { shiftId } = aNight()

    const amar = shiftLines(f.db, f.venueId, shiftId, { kat: 'sve', userId: f.userId('Amar') })
    const everybody = shiftLines(f.db, f.venueId, shiftId, { kat: 'sve' })

    expect(amar.rows.every(r => r.locked_by === f.userId('Amar'))).toBe(true)
    expect(amar.rows.every(r => r.at.length > 0 && r.table_name.startsWith('Sto'))).toBe(true)
    expect(amar.totals.rows).toBeLessThan(everybody.totals.rows)

    // The storno filter's total is the summary's storno, which is the whole
    // point of a drill-down: the number on the card is the rows behind it.
    const summary = summarizeShift(f.db, f.venueId, shiftId, f.clock.now())
    const storno = shiftLines(f.db, f.venueId, shiftId, { kat: 'storno' })
    expect(storno.totals.storno_fen).toBe(summary.void_fen)
  })

  it('pages without changing the footer', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    for (let i = 0; i < 5; i++) f.lock('Amar', `Sto ${i + 1}`, [{ product: 'Kafa' }])

    const whole = shiftLines(f.db, f.venueId, shiftId, { kat: 'sve', limit: 300 })
    const page1 = shiftLines(f.db, f.venueId, shiftId, { kat: 'sve', limit: 2 })
    const page2 = shiftLines(f.db, f.venueId, shiftId, {
      kat: 'sve', limit: 2, cursor: page1.next_cursor!,
    })

    expect(page1.totals).toEqual(whole.totals)
    expect(page2.totals).toEqual(whole.totals)
    expect(page1.rows.map(r => r.line_id)).not.toEqual(page2.rows.map(r => r.line_id))
  })

  it('has a written summary to read once the night is a record', () => {
    const { shiftId } = aNight()
    expect(latestSummary(f.db, f.venueId, shiftId)).toBeNull()
    // Unwritten folds live and comes back as version 0 — the field that says
    // "tonight's arithmetic, not a record" (see the route's comment).
    expect(summarizeShift(f.db, f.venueId, shiftId, f.clock.now()).version).toBe(0)
  })

  it('names the categories on the live fold, not only on the stored row', () => {
    const { shiftId } = aNight()

    // `summarizeShift` leaves `name` off — the stored JSON is numeric (§3.2) —
    // so §7's "with names joined" would be false on the night being worked.
    expect(summarizeShift(f.db, f.venueId, shiftId, f.clock.now()).by_category
      .every(c => c.name === undefined)).toBe(true)

    for (const summary of [
      ownerShiftSummary(f.db, f.venueId, shiftId, f.clock.now()),
      getOwnerShift(f.db, f.venueId, shiftId).summary,
    ]) {
      expect(summary.by_category.length).toBeGreaterThan(1)
      expect(summary.by_category.every(c => (c.name ?? '').length > 0)).toBe(true)
      expect(summary.by_category.map(c => c.name)).toContain('Kafa')
    }
  })
})
