/**
 * The night's numbers, three ways, and the identity that binds them:
 *
 *     Σ by_user.promet_fen === Σ by_category.fen === promet_fen
 *
 * `summarizeShift` asserts this itself before it writes a row — a 500
 * `SUMMARY_MISMATCH` rather than a summary nobody can reconcile — so the tests
 * here mostly prove the *numbers*, not the guard. It holds by construction:
 * all three totals are foldings of one array of lines.
 *
 * The rule that decides those numbers, and the one worth stating out loud
 * (`docs/BACKEND.md` §6.7): **promet is charged minus applied voids**. A void
 * unwinds a sale that should never have been rung up. A *gratis* does not — the
 * café decided to give something away, and that decision belongs next to the
 * takings rather than quietly deducted from them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { closeTab, expectReconciled, lockComped, markUnpaid, rawClose } from '../helpers/shifts'

vi.mock('../../server/services/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/services/contracts')>()
  return {
    ...actual,
    log: vi.fn(() => 'log-entry'),
    bump: vi.fn(() => 1),
    queueAlert: vi.fn(),
    verifyPinMetered: vi.fn(),
    assertNoPendingOutbox: vi.fn(() => []),
  }
})

// `settlements.ts` first, `contracts` last — the ordering rule in
// `tests/helpers/shifts.ts`. `summaries.ts` never calls a stub (it reads, and
// `writeSummaryVersion` writes only `shift_summaries`), so it is safe in either
// graph; the settle is the one mutation here that needs the doubles.
const { settle } = await import('../../server/services/settlements')
const {
  getMyShift, getOwnerShift, latestSummary, listMyShifts, putStaffNote, shiftLines,
  summarizeShift, summarizeUser, writeSummaryVersion,
} = await import('../../server/services/summaries')
const { expectedCash } = await import('../../server/services/cash')

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

function summarise(shiftId: string) {
  return summarizeShift(f.db, f.venueId, shiftId, f.clock.now())
}

describe('the three-way reconciliation', () => {
  it('agrees per person, per category and in total', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Lejla'] })

    // A bowl and a top-up of coal on it. The top-up is charged nothing and is
    // *not* a bowl — counting it would inflate prodano lula and make
    // grams-per-bowl look far too low.
    const a1 = f.lock('Amar', 'Sto 1', [{ product: 'Nargila' }, { product: 'Dodatni žar' }])
    const a2 = f.lock('Amar', 'Sto 2', [{ product: 'Kafa', qty: 2 }])
    const l1 = f.lock('Lejla', 'Sto 3', [{ product: 'Red Bull' }, { product: 'Coca-Cola' }])

    // An applied void leaves the turnover…
    f.voidLine('Amar', a2.lineIds[0]!, { status: 'applied', approvedBy: 'Emir' })
    // …a pending one does not, because nobody has decided it yet…
    f.voidLine('Lejla', l1.lineIds[1]!, { status: 'pending' })
    // …and a gratis does not either: it is a decision, not a mistake.
    f.voidLine('Lejla', l1.lineIds[0]!, { kind: 'comp', status: 'applied', approvedBy: 'Emir' })

    const summary = summarise(shiftId)

    expect(summary.promet_fen).toBe(2_300) // 1500 + 0 + (300 − 300) + 500 + 300
    expect(summary.by_user.reduce((n, u) => n + u.promet_fen, 0)).toBe(2_300)
    expect(summary.by_category.reduce((n, c) => n + c.fen, 0)).toBe(2_300)

    const amar = summary.by_user.find(u => u.name === 'Amar')!
    const lejla = summary.by_user.find(u => u.name === 'Lejla')!
    expect(amar.promet_fen).toBe(1_500)
    expect(lejla.promet_fen).toBe(800)

    expect(summary.bowls).toBe(1)
    expect(summary.comp_fen).toBe(500)
    expect(summary.void_count).toBe(1)
    expect(summary.void_fen).toBe(300)
    expect(lejla.storno.pending_count).toBe(1)
    expect(lejla.storno.pending_fen).toBe(300)
    expect(lejla.gratis).toEqual({ count: 1, fen: 500 })
    expect(amar.bowls).toBe(1)
    expect(amar.rounds).toBe(2)
    expect(amar.tabs).toBe(2)

    void a1
  })

  it('counts a line locked free at its list price and keeps it out of promet', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    // A staff drink: locked at 0 with `comp_reason`, so promet never saw it.
    lockComped(f, 'Amar', 'Sto 1', 'Kafa')

    const summary = summarise(shiftId)
    expect(summary.promet_fen).toBe(0)
    expect(summary.comp_fen).toBe(150)
    expect(summary.by_user[0]!.gratis).toEqual({ count: 1, fen: 150 })
  })

  it('includes somebody who locked a round but never got a member row', () => {
    // Every writer calls `joinShift`, so this cannot happen through a service —
    // which is exactly why the summary must not depend on it. Over members alone
    // a missing row would silently drop a waiter's promet.
    const shiftId = f.openShift({ members: [] })
    f.lock('Dino', 'Sto 1', [{ product: 'Red Bull' }])
    f.db.delete(schema.shiftMembers).run()

    const summary = summarise(shiftId)
    expect(summary.promet_fen).toBe(500)
    expect(summary.by_user.map(u => u.name)).toEqual(['Dino'])
  })
})

describe('the line drill-down', () => {
  function threeRounds(): string {
    const shiftId = f.openShift({ members: ['Amar', 'Lejla'] })
    const a = f.lock('Amar', 'Sto 1', [
      { product: 'Kafa' }, { product: 'Coca-Cola' }, { product: 'Red Bull' },
    ])
    f.clock.advance(60)
    f.lock('Amar', 'Sto 2', [{ product: 'Nargila' }])
    f.clock.advance(60)
    f.lock('Lejla', 'Sto 3', [{ product: 'Čaj' }])
    f.voidLine('Amar', a.lineIds[0]!, { status: 'applied', approvedBy: 'Emir' })
    return shiftId
  }

  it('totals the whole filtered set, never the page', () => {
    const shiftId = threeRounds()
    const whole = shiftLines(f.db, f.venueId, shiftId, { kat: 'sve', limit: 300 })
    expect(whole.rows).toHaveLength(5)
    expect(whole.next_cursor).toBeUndefined()

    const seen: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = shiftLines(f.db, f.venueId, shiftId, {
        kat: 'sve', limit: 2, ...(cursor ? { cursor } : {}),
      })
      // The footer of page 3 says exactly what the footer of page 1 said.
      expect(page.totals).toEqual(whole.totals)
      seen.push(...page.rows.map(r => r.line_id))
      cursor = page.next_cursor
      pages += 1
    } while (cursor && pages < 10)

    expect(seen).toEqual(whole.rows.map(r => r.line_id))
  })

  it('agrees with the summary about what was stornirano', () => {
    const shiftId = threeRounds()
    const summary = summarise(shiftId)
    const storna = shiftLines(f.db, f.venueId, shiftId, { kat: 'storno' })

    expect(storna.rows).toHaveLength(1)
    expect(storna.rows[0]!.status).toBe('storno')
    expect(storna.totals.storno_fen).toBe(summary.void_fen)
  })

  it('narrows to one person, which is all `/me` ever asks for', () => {
    const shiftId = threeRounds()
    const mine = shiftLines(f.db, f.venueId, shiftId, {
      kat: 'sve', userId: f.userId('Lejla'), limit: 300,
    })
    expect(mine.rows.map(r => r.name_snapshot)).toEqual(['Čaj'])
    expect(mine.totals.rows).toBe(1)
  })

  it('marks a line by what happened to its tab', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const open = f.lock('Amar', 'Sto 1', [{ product: 'Kafa' }])
    const paid = f.lock('Amar', 'Sto 2', [{ product: 'Kafa' }])
    const unpaid = f.lock('Amar', 'Sto 3', [{ product: 'Kafa' }])
    closeTab(f, paid.tabId, 'Amar')
    markUnpaid(f, unpaid.tabId, 'Amar')

    const rows = shiftLines(f.db, f.venueId, shiftId, { kat: 'sve', limit: 300 }).rows
    const status = (lineId: string) => rows.find(r => r.line_id === lineId)!.status
    expect(status(open.lineIds[0]!)).toBe('otvoreno')
    expect(status(paid.lineIds[0]!)).toBe('naplaceno')
    expect(status(unpaid.lineIds[0]!)).toBe('nije_placeno')
    expect(shiftLines(f.db, f.venueId, shiftId, { kat: 'nijeplaceno' }).rows).toHaveLength(1)
  })
})

describe('versions', () => {
  it('append, and never overwrite', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    f.lock('Amar', 'Sto 1', [{ product: 'Red Bull' }])

    const v1 = f.db.transaction(tx =>
      writeSummaryVersion(tx, f.venueId, shiftId, 'close', f.clock.now()))
    f.lock('Amar', 'Sto 2', [{ product: 'Kafa' }])
    const v2 = f.db.transaction(tx =>
      writeSummaryVersion(tx, f.venueId, shiftId, 'late', f.clock.now()))

    expect([v1, v2]).toEqual([1, 2])
    const rows = f.db.select().from(schema.shiftSummaries)
      .where(eq(schema.shiftSummaries.shiftId, shiftId)).all()
    expect(rows.map(r => [r.version, r.reason, r.prometFen]))
      .toEqual([[1, 'close', 500], [2, 'late', 650]])
  })

  it('store numbers and join the names back on at read', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    f.lock('Amar', 'Sto 1', [{ product: 'Red Bull' }])
    f.db.transaction(tx => writeSummaryVersion(tx, f.venueId, shiftId, 'close', f.clock.now()))

    const stored = f.db.select().from(schema.shiftSummaries)
      .where(eq(schema.shiftSummaries.shiftId, shiftId)).get()!
    expect(stored.byUserJson).not.toContain('Amar')

    const read = latestSummary(f.db, f.venueId, shiftId)!
    expect(read.by_user[0]!.name).toBe('Amar')
    expect(read.by_category[0]!.name).toBe('Energetska')
  })
})

/**
 * One simulated night, end to end: three waiters, a bartender with a payout
 * nobody has approved, floats out of the drawer, cash and card, an unpaid tab, a
 * storno, a gratis, and one envelope handed in.
 *
 * Every number below is worked out by hand in the comments, and the two
 * identities are asserted on the same fixture:
 *
 *   venue_expected_fen === drawer_expected_fen + Σ waiters
 *   expected_cash_fen + outstanding_fen === venue_expected_fen
 */
describe('a whole night', () => {
  function night(): string {
    const shiftId = f.openShift({ members: ['Amar', 'Lejla', 'Dino', 'Emir'] })
    f.submitCount('Emir', ['Kafa (mljevena)'], { phase: 'open' })

    // 300,00 into the drawer, 50,00 out to each of the three waiters.
    f.cashMovement({ type: 'float_in', amountFen: 30_000, user: 'Haris' })
    for (const name of ['Amar', 'Lejla', 'Dino']) {
      f.cashMovement({ type: 'float_out', amountFen: 5_000, user: name })
    }
    // Emir needs 40,00 for a supplier; nobody has said yes yet.
    f.cashMovement({ type: 'payout', amountFen: 4_000, user: 'Emir', status: 'pending' })

    const a1 = f.lock('Amar', 'Sto 1', [{ product: 'Nargila' }, { product: 'Red Bull' }])
    f.pay('Amar', a1.tabId, 2_000)
    closeTab(f, a1.tabId, 'Amar')

    const a2 = f.lock('Amar', 'Sto 2', [{ product: 'Kafa', qty: 3 }])
    f.pay('Amar', a2.tabId, 450)
    closeTab(f, a2.tabId, 'Amar')

    const l1 = f.lock('Lejla', 'Sto 3', [
      { product: 'Nargila', qty: 2 }, { product: 'Dodatni žar' },
    ])
    f.pay('Lejla', l1.tabId, 3_000, { method: 'card' })
    closeTab(f, l1.tabId, 'Lejla')

    const l2 = f.lock('Lejla', 'Sto 4', [{ product: 'Coca-Cola', qty: 2 }])
    f.pay('Lejla', l2.tabId, 600)
    closeTab(f, l2.tabId, 'Lejla')

    // Still sitting, and Lejla has asked for a storno on it that nobody has
    // decided — so the 1,50 is still hers to hand over.
    const l3 = f.lock('Lejla', 'Sto 7', [{ product: 'Kafa' }])
    f.voidLine('Lejla', l3.lineIds[0]!, { status: 'pending' })

    // A storno that was granted: it leaves the turnover.
    const l4 = f.lock('Lejla', 'Sto 8', [{ product: 'Čaj' }])
    f.voidLine('Lejla', l4.lineIds[0]!, { status: 'applied', approvedBy: 'Emir' })

    const d1 = f.lock('Dino', 'Sto 5', [{ product: 'Limunada', qty: 2 }, { product: 'Čaj' }])
    f.pay('Dino', d1.tabId, 900)
    closeTab(f, d1.tabId, 'Dino')
    // Na račun kuće: the tea was a gratis. Promet does not move; the decision is
    // counted beside it.
    f.voidLine('Dino', d1.lineIds[1]!, { kind: 'comp', status: 'applied', approvedBy: 'Emir' })

    // Somebody walked out on Dino.
    const d2 = f.lock('Dino', 'Sto 6', [{ product: 'Red Bull' }])
    markUnpaid(f, d2.tabId, 'Dino')

    return shiftId
  }

  it('reconciles the cash to the fen', () => {
    const shiftId = night()
    const ec = expectedCash(f.db, f.venueId, shiftId)

    // 300,00 in, 150,00 handed out, the 40,00 payout still pending.
    expect(ec.drawer_expected_fen).toBe(15_000)

    const by = (name: string) => ec.waiters.find(w => w.name === name)!
    // Amar: 50,00 float + 20,00 + 4,50 in cash.
    expect(by('Amar')).toMatchObject({
      float_out_fen: 5_000, cash_fen: 2_450, unpaid_fen: 0, void_held_fen: 0,
      expected_fen: 7_450,
    })
    // Lejla: 50,00 float + 6,00 cash (the 30,00 was on the card) + a 1,50 storno
    // nobody granted.
    expect(by('Lejla')).toMatchObject({
      float_out_fen: 5_000, cash_fen: 600, void_held_fen: 150, expected_fen: 5_750,
    })
    // Dino: 50,00 float + 9,00 cash + the 5,00 that walked out.
    expect(by('Dino')).toMatchObject({
      float_out_fen: 5_000, cash_fen: 900, unpaid_fen: 500, expected_fen: 6_400,
    })

    expect(ec.venue_expected_fen).toBe(34_600)
    expect(expectReconciled(ec)).toBe(34_600)
  })

  it('writes a version that reconciles by category and by user', () => {
    const shiftId = night()
    // Amar counts his envelope and hands it over; the other two have not yet.
    const handed = settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
      declared_fen: 7_450, outbox_len: 0,
    })
    expect(handed.diff_fen).toBe(0)
    expect(handed.within_tolerance).toBe(true)

    const version = f.db.transaction(tx =>
      writeSummaryVersion(tx, f.venueId, shiftId, 'close', f.clock.now()))
    expect(version).toBe(1)

    const summary = latestSummary(f.db, f.venueId, shiftId)!

    // 20,00 + 4,50 + 30,00 + 6,00 + 1,50 + (2,00 − 2,00) + 9,00 + 5,00
    expect(summary.promet_fen).toBe(7_600)
    expect(summary.by_user.reduce((n, u) => n + u.promet_fen, 0)).toBe(7_600)
    expect(summary.by_category.reduce((n, c) => n + c.fen, 0)).toBe(7_600)

    expect(summary.cash_fen).toBe(3_950) // 2000 + 450 + 600 + 900
    expect(summary.card_fen).toBe(3_000)
    expect(summary.comp_fen).toBe(200)
    expect(summary.void_count).toBe(1)
    expect(summary.void_fen).toBe(200)
    expect(summary.unpaid_fen).toBe(500)
    expect(summary.bowls).toBe(3) // one of Amar's, two of Lejla's; no žar

    // The second split of the same total: what is countable tonight, and what is
    // still in somebody's pocket.
    expect(summary.expected_cash_fen).toBe(22_450) // drawer + Amar
    expect(summary.outstanding_fen).toBe(12_150) // Lejla + Dino
    expect(summary.expected_cash_fen + summary.outstanding_fen).toBe(34_600)

    expect(summary.by_user.find(u => u.name === 'Amar')!.declared_fen).toBe(7_450)
    expect(summary.by_user.find(u => u.name === 'Lejla')!.declared_fen).toBeUndefined()
  })

  it('gives the owner one screen with the ledgers behind it', () => {
    const shiftId = night()
    settle(f.db, f.venueId, f.actor('Amar'), shiftId, { declared_fen: 7_450, outbox_len: 0 })
    f.db.transaction(tx => writeSummaryVersion(tx, f.venueId, shiftId, 'close', f.clock.now()))
    rawClose(f, shiftId, { countedFen: 22_450 })

    const view = getOwnerShift(f.db, f.venueId, shiftId)
    expect(view.shift.status).toBe('closed')
    expect(view.summary.promet_fen).toBe(7_600)
    expect(view.by_user.map(u => u.name).sort()).toEqual(['Amar', 'Dino', 'Emir', 'Lejla'])
    expect(view.cash_movements).toHaveLength(5)
    expect(view.settlements.map(s => s.user_name)).toEqual(['Amar'])
    expect(view.counts.map(c => c.phase)).toEqual(['open'])
    // The count card's manjak is the sum of its own lines, not 0: the correlated
    // subquery behind it used to compare `count_id` against the wrong table's
    // `id` and matched nothing, so the owner was asked to sign off a shortfall
    // the page told him was zero.
    const lineVariance = f.db.select({ n: sql<number>`coalesce(sum(variance_fen), 0)` })
      .from(schema.stockCountLines)
      .where(eq(schema.stockCountLines.countId, view.counts[0]!.id))
      .get()!.n
    expect(lineVariance).not.toBe(0)
    expect(view.counts[0]!.variance_fen).toBe(lineVariance)
    expect(view.late_after_close).toEqual({ count: 0, fen: 0, user_names: [] })
  })

  it('tells each waiter his own night and no colleague any of it', () => {
    const shiftId = night()
    settle(f.db, f.venueId, f.actor('Amar'), shiftId, { declared_fen: 7_450, outbox_len: 0 })

    const amar = getMyShift(f.db, f.venueId, f.userId('Amar'))
    expect(amar.summary?.promet_fen).toBe(2_450)
    expect(amar.float_out_fen).toBe(5_000)

    const dino = getMyShift(f.db, f.venueId, f.userId('Dino'))
    expect(dino.settled).toBe(false)
    expect(dino.summary).toBeNull()
    expect(dino.float_out_fen).toBe(5_000)

    // And the same numbers on the history screen, once the night is over.
    rawClose(f, shiftId, { countedFen: 22_450 })
    const history = listMyShifts(f.db, f.venueId, f.userId('Amar'), 30)
    expect(history).toHaveLength(1)
    expect(history[0]!.declared_fen).toBe(7_450)
    expect(history[0]!.diff_fen).toBe(0)

    // `summarizeUser` on somebody who was never there is zeros, not a throw.
    const nobody = summarizeUser(f.db, f.venueId, shiftId, f.userId('Tarik'), f.clock.now())
    expect(nobody.promet_fen).toBe(0)
    expect(nobody.rounds).toBe(0)
  })
})

/**
 * *Bez stola* in the numbers (PHASE3 §1.11).
 *
 * `shiftLines` joined `tables` with an INNER join, so a tab with no table
 * dropped out of every summary built on it: the waiter's own promet, the
 * owner's *Puls*, the category counts. The money was on the tab and nowhere in
 * the night's arithmetic.
 */
describe('a table-less tab', () => {
  /** A locked round whose tab was never on a table — the guests at the bar. */
  function lockLoose(name: string, product: string): void {
    const round = f.lock(name, 'Sto 1', [{ product }])
    f.db.update(schema.tabs).set({ tableId: null })
      .where(eq(schema.tabs.id, round.tabId)).run()
  }

  it('counts in summarizeUser and reads Bez stola', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    f.lock('Amar', 'Sto 2', [{ product: 'Kafa' }])
    lockLoose('Amar', 'Kafa')

    const mine = summarizeUser(f.db, f.venueId, shiftId, f.userId('Amar'), f.clock.now())
    expect(mine.rounds).toBe(2)
    expect(mine.tabs).toBe(2)
    expect(mine.promet_fen).toBe(300)

    const summary = summarise(shiftId)
    expect(summary.promet_fen).toBe(300)
    const drill = shiftLines(f.db, f.venueId, shiftId, { kat: 'sve' })
    expect(drill.rows.map(r => r.table_name).sort()).toEqual(['Bez stola', 'Sto 2'])
  })
})

// ===========================================================================
// WP4 — *Moja smjena*
// ===========================================================================

/**
 * The screen a waiter opens at 21:00, five hours before he settles.
 *
 * `getMyShift` answered `summary: null` and nothing else, which is correct
 * blindness and an empty screen: a person could not see how many rounds he had
 * carried on his own night. PHASE3 §1.5 adds `counts` — always present, and
 * carrying **no `*_fen` key but `gratis.max_fen`**, which is the published
 * ceiling on a staff drink rather than any of his money. The regex below is the
 * guard: a money field added to this read fails here, before it reaches a
 * screen that is supposed to be blind.
 */
describe('Moja smjena — counts before the envelope', () => {
  function amarsNight(): string {
    const shiftId = f.openShift({ members: ['Amar', 'Emir'] })

    const t1 = f.lock('Amar', 'Sto 1', [{ product: 'Nargila' }, { product: 'Kafa' }])
    f.pay('Amar', t1.tabId, 1_700)
    closeTab(f, t1.tabId, 'Amar')

    const t2 = f.lock('Amar', 'Sto 2', [{ product: 'Kafa', qty: 2 }])
    // One granted storno and one still waiting on somebody.
    f.voidLine('Amar', t2.lineIds[0]!, { status: 'applied', approvedBy: 'Emir' })

    const t3 = f.lock('Amar', 'Sto 3', [{ product: 'Čaj' }])
    f.voidLine('Amar', t3.lineIds[0]!, { status: 'pending' })

    // His one staff drink tonight, locked free.
    lockComped(f, 'Amar', 'Sto 4', 'Kafa')

    f.wasteEvent('Amar', 'Coca-Cola 0,25 l', 1)

    // A colleague's night, which must not show up in a single number below.
    const e1 = f.lock('Emir', 'Sto 9', [{ product: 'Red Bull', qty: 4 }])
    f.pay('Emir', e1.tabId, 1_600)
    closeTab(f, e1.tabId, 'Emir')

    return shiftId
  }

  it('counts his own work and none of a colleague’s', () => {
    amarsNight()
    const mine = getMyShift(f.db, f.venueId, f.userId('Amar'))

    expect(mine.settled).toBe(false)
    expect(mine.summary).toBeNull()
    expect(mine.counts.rounds).toBe(4)
    expect(mine.counts.tabs).toBe(4)
    expect(mine.counts.bowls).toBe(1)
    expect(mine.counts.storno).toEqual({ applied: 1, pending: 1 })
    expect(mine.counts.waste).toBe(1)
    expect(mine.counts.hours).toBeGreaterThanOrEqual(0)

    // Kafa 1 + 2 + 1 free = 4, Nargila 1, Čaj 1. Red Bull is Emir's.
    const byName = new Map(mine.counts.by_category.map(c => [c.name, c.count]))
    expect(byName.get('Kafa')).toBe(4)
    expect(byName.get('Nargila')).toBe(1)
    expect(byName.get('Čaj')).toBe(1)
    expect(byName.has('Energetska')).toBe(false)

    // The chip has to be able to open the drill-down, so the id rides along.
    expect(mine.counts.by_category.every(c => typeof c.category_id === 'string')).toBe(true)
  })

  it('shows the staff-drink allowance as a published rule: used, cap, ceiling', () => {
    amarsNight()
    const mine = getMyShift(f.db, f.venueId, f.userId('Amar'))
    expect(mine.counts.gratis).toEqual({ used: 1, cap: 2, max_fen: 300 })

    // A second one, and the counter says so — which is what the sheet renders
    // as *Osoblje: 2/2 (do 3,00 KM)*.
    lockComped(f, 'Amar', 'Sto 5', 'Kafa')
    expect(getMyShift(f.db, f.venueId, f.userId('Amar')).counts.gratis.used).toBe(2)
  })

  it('puts no money in `counts`, on any night, settled or not', () => {
    const shiftId = amarsNight()
    const before = getMyShift(f.db, f.venueId, f.userId('Amar'))
    expect(JSON.stringify(before.counts).match(/\w*_fen"/g)).toEqual(['max_fen"'])

    settle(f.db, f.venueId, f.actor('Amar'), shiftId, { declared_fen: 1_700, outbox_len: 0 })
    const after = getMyShift(f.db, f.venueId, f.userId('Amar'))
    expect(JSON.stringify(after.counts).match(/\w*_fen"/g)).toEqual(['max_fen"'])
    // …and the money is now next to it, where it belongs.
    expect(after.summary?.promet_fen).toBe(1_850)
  })

  it('answers a shape, not a null, when no shift is open at all', () => {
    const mine = getMyShift(f.db, f.venueId, f.userId('Amar'))
    expect(mine.shift).toBeNull()
    expect(mine.counts.rounds).toBe(0)
    expect(mine.counts.by_category).toEqual([])
    // The rule is published even on an empty night: it is not a measurement.
    expect(mine.counts.gratis).toEqual({ used: 0, cap: 2, max_fen: 300 })
  })
})

/**
 * *Napomena* (PHASE3 §1.6) — one person's own words about one of his own nights.
 *
 * `staff_notes` is deliberately not a ledger table: it may be edited and
 * deleted, because a note nobody can correct is a note nobody writes.
 */
describe('Napomena on my own night', () => {
  it('writes, rewrites and deletes one note per person per night', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Emir'] })

    expect(putStaffNote(f.db, f.venueId, f.userId('Amar'), shiftId, ' kasnio sam sat ').note)
      .toBe('kasnio sam sat')
    expect(listMyShifts(f.db, f.venueId, f.userId('Amar'), 30)[0]!.note).toBe('kasnio sam sat')

    // A rewrite is the same row, not a second one.
    putStaffNote(f.db, f.venueId, f.userId('Amar'), shiftId, 'ostao do 4')
    expect(f.db.select().from(schema.staffNotes).all()).toHaveLength(1)
    expect(listMyShifts(f.db, f.venueId, f.userId('Amar'), 30)[0]!.note).toBe('ostao do 4')

    // An empty body deletes it.
    expect(putStaffNote(f.db, f.venueId, f.userId('Amar'), shiftId, '   ').note).toBeNull()
    expect(f.db.select().from(schema.staffNotes).all()).toHaveLength(0)
    expect(listMyShifts(f.db, f.venueId, f.userId('Amar'), 30)[0]!.note).toBeNull()
  })

  it('is a colleague’s business only on the nights he actually worked', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    expect(() => putStaffNote(f.db, f.venueId, f.userId('Lejla'), shiftId, 'nešto'))
      .toThrow(/night you worked/)

    putStaffNote(f.db, f.venueId, f.userId('Amar'), shiftId, 'moja noć')
    // And the note is on his own history row and on nobody else's.
    expect(listMyShifts(f.db, f.venueId, f.userId('Lejla'), 30)).toEqual([])
  })
})
