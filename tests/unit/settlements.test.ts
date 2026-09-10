/**
 * *Završi smjenu* — declare first, be told afterwards.
 *
 * Two things in this file are worth reading before the code.
 *
 * **What "blind" actually means.** `GET /api/me/shift` withholds the summary
 * until a settlement row exists, and the test below pins that as "no `*_fen` key
 * anywhere in the envelope". The one deliberate exception is `float_out_fen`
 * **and the actor's own `cash_movements` rows**, which carry an `amount_fen`
 * each: what a person was *handed* is not part of the blindness. Hiding it would
 * let a bartender push his own shortfall onto a colleague who was structurally
 * prevented from noticing it, which is a far worse hole than the one blindness
 * closes. And blindness is a nudge either way — `/me/shift/lines` returns
 * per-line prices, so anybody who can add knows his number. The evidence is the
 * recorded pair `declared_fen` / `expected_at_declare_fen`.
 *
 * **A settlement is never rewritten.** Money that moves after somebody has
 * signed off moves his *live* expected cash and leaves the stored row alone —
 * asserted here byte for byte, because a settlement that quietly followed the
 * ledger would destroy the only thing it is for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { closeTab, fenKeys, lockPostSettle, rawClose, refuses } from '../helpers/shifts'
import { SankError } from '../../server/utils/errors'

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

// `settlements.ts` first and `contracts` last — the mock-ordering rule at the
// top of `tests/helpers/shifts.ts`. Every other module used here is used for
// reads only, which are real in either graph.
const { acceptSettlement, hasLiveSettlement, settle } =
  await import('../../server/services/settlements')
const { getMyShift, writeSummaryVersion } = await import('../../server/services/summaries')
const { expectedCash } = await import('../../server/services/cash')
const contracts = await import('../../server/services/contracts')

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
  for (const fn of [contracts.log, contracts.bump, contracts.assertNoPendingOutbox]) {
    vi.mocked(fn).mockReset()
  }
  vi.mocked(contracts.log).mockImplementation(() => 'log-entry')
  vi.mocked(contracts.bump).mockImplementation(() => 1)
  vi.mocked(contracts.assertNoPendingOutbox).mockImplementation(() => [])
})

/** Amar: one float of 5,00 and 20,00 taken in cash. Expected: 25,00. */
function amarsNight(): { shiftId: string, tabId: string } {
  const shiftId = f.openShift({ members: ['Amar', 'Emir'] })
  f.submitCount('Emir', ['Kafa (mljevena)'], { phase: 'open' })
  f.cashMovement({ type: 'float_out', amountFen: 500, user: 'Amar' })
  const round = f.lock('Amar', 'Sto 1', [{ product: 'Nargila' }, { product: 'Red Bull' }])
  f.pay('Amar', round.tabId, 2_000)
  closeTab(f, round.tabId, 'Amar')
  return { shiftId, tabId: round.tabId }
}

describe('the blind strip', () => {
  it('shows a waiter what he was handed and nothing else, until he declares', () => {
    amarsNight()
    const before = getMyShift(f.db, f.venueId, f.userId('Amar'))

    expect(before.settled).toBe(false)
    expect(before.summary).toBeNull()
    expect(before.float_out_fen).toBe(500)
    expect(before.cash_movements).toHaveLength(1)

    // Everything except his own cash movements: two money fields, and the
    // second one is not his money.
    //
    // **The invariant did not move.** It has always been "no `*_fen` of his
    // *takings* before he declares", and it still holds: `float_out_fen` is
    // what the drawer handed him (§6.5), and `counts.gratis.max_fen` is the
    // published ceiling on a staff drink — a *rule*, the same number printed in
    // *Pravila*, which PHASE3 §1.5 requires on this read precisely so a waiter
    // can read the rule he is measured against before he is measured. Promet,
    // expected and declared are still absent, and `summary` is still null.
    const { cash_movements: _movements, ...rest } = before
    expect([...new Set(fenKeys(rest))].sort()).toEqual(['float_out_fen', 'max_fen'])
    // …and the only money on the movements is what he was handed.
    expect([...new Set(fenKeys(before.cash_movements))]).toEqual(['amount_fen'])
  })

  it('opens up the moment he has', () => {
    const { shiftId } = amarsNight()
    settle(f.db, f.venueId, f.actor('Amar'), shiftId, { declared_fen: 2_500, outbox_len: 0 })

    const after = getMyShift(f.db, f.venueId, f.userId('Amar'))
    expect(after.settled).toBe(true)
    expect(after.summary?.promet_fen).toBe(2_000)
    expect(after.summary?.declared_fen).toBe(2_500)
    expect(after.summary?.expected_fen).toBe(2_500)
    expect(after.summary?.within_tolerance).toBe(true)
    expect(fenKeys(after).length).toBeGreaterThan(3)
  })
})

describe('settling', () => {
  it('reveals the number only after the declaration is written', () => {
    const { shiftId } = amarsNight()
    const result = settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
      declared_fen: 2_400, outbox_len: 0,
    })

    expect(result.expected_fen).toBe(2_500)
    expect(result.declared_fen).toBe(2_400)
    expect(result.diff_fen).toBe(-100)
    expect(result.tolerance_fen).toBe(500)
    expect(result.within_tolerance).toBe(true)
    expect(result.self_sealed).toBe(true)
    expect(result.late).toBe(false)
    expect(result.breakdown.float_out_fen).toBe(500)
    expect(result.breakdown.cash_fen).toBe(2_000)

    const row = f.db.select().from(schema.waiterSettlements)
      .where(eq(schema.waiterSettlements.id, result.settlement_id)).get()!
    expect(row.declaredFen).toBe(2_400)
    expect(row.expectedAtDeclareFen).toBe(2_500)
    expect(row.selfSealed).toBe(1)
  })

  it('happens once', () => {
    const { shiftId } = amarsNight()
    settle(f.db, f.venueId, f.actor('Amar'), shiftId, { declared_fen: 2_500, outbox_len: 0 })
    refuses(
      () => settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
        declared_fen: 2_500, outbox_len: 0,
      }),
      'SETTLED', 409,
    )
    expect(hasLiveSettlement(f.db, f.venueId, shiftId, f.userId('Amar'))).toBe(true)
    expect(hasLiveSettlement(f.db, f.venueId, shiftId, f.userId('Lejla'))).toBe(false)
  })

  it('refuses while the phone still holds a round', () => {
    const { shiftId } = amarsNight()
    refuses(
      () => settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
        declared_fen: 2_500, outbox_len: 1,
      }),
      'PENDING_OUTBOX', 409,
    )
    expect(f.db.select().from(schema.waiterSettlements).all()).toHaveLength(0)
  })

  it('refuses when a phone that is awake still reports an outbox', () => {
    const { shiftId } = amarsNight()
    vi.mocked(contracts.assertNoPendingOutbox).mockImplementationOnce(() => {
      throw new SankError(409, 'PENDING_OUTBOX', 'a fresh device still has rounds', {
        devices: [{ label: 'Amarov telefon', pending_count: 2 }],
      })
    })
    refuses(
      () => settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
        declared_fen: 2_500, outbox_len: 0,
      }),
      'PENDING_OUTBOX', 409,
    )
    expect(f.db.select().from(schema.waiterSettlements).all()).toHaveLength(0)
  })

  it('lets a phone that is asleep through, and reports it', () => {
    const { shiftId } = amarsNight()
    const stale = [{
      device_id: 'dev-1', label: 'Stari tablet', pending_count: 3,
      last_seen_at: '2026-09-01T10:00:00.000Z',
    }]
    vi.mocked(contracts.assertNoPendingOutbox).mockImplementationOnce(() => stale)

    const result = settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
      declared_fen: 2_500, outbox_len: 0,
    })
    expect(result.stale_devices).toEqual(stale)

    const row = f.db.select().from(schema.waiterSettlements)
      .where(eq(schema.waiterSettlements.id, result.settlement_id)).get()!
    expect(JSON.parse(row.unsentReportedJson)).toEqual({
      outbox_len: 0,
      devices: [{ device_id: 'dev-1', pending_count: 3 }],
    })
  })

  it('after the close is the same route, marked late, with a new version', () => {
    const { shiftId } = amarsNight()
    // The close itself is `shifts.test.ts`'s subject; here it only has to have
    // happened, so the row and version 1 are written directly.
    f.db.transaction(tx => writeSummaryVersion(tx, f.venueId, shiftId, 'close', f.clock.now()))
    rawClose(f, shiftId, { countedFen: 0 })
    expect(f.db.select().from(schema.shiftSummaries).all().map(s => s.version)).toEqual([1])

    const result = settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
      declared_fen: 2_500, outbox_len: 0,
    })
    expect(result.late).toBe(true)

    const versions = f.db.select().from(schema.shiftSummaries).all()
    expect(versions.map(s => s.version)).toEqual([1, 2])
    expect(versions[1]!.reason).toBe('late')

    const kinds = vi.mocked(contracts.log).mock.calls.map(c => c[2].kind)
    expect(kinds).toContain('settlement_late')
    expect(kinds).toContain('waiter_finished')
  })
})

describe('who takes the envelope', () => {
  it('an approver signing on the spot is recorded at insert', () => {
    const { shiftId } = amarsNight()
    const result = settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
      declared_fen: 2_500, outbox_len: 0,
      receiver_user_id: f.userId('Emir'), receiver_pin: '3333',
    })
    expect(result.self_sealed).toBe(false)

    const row = f.db.select().from(schema.waiterSettlements)
      .where(eq(schema.waiterSettlements.id, result.settlement_id)).get()!
    expect(row.acceptedBy).toBe(f.userId('Emir'))
    expect(row.acceptedAt).toBeTruthy()
    expect(row.selfSealed).toBe(0)
  })

  it('is never the person handing it over', () => {
    const { shiftId } = amarsNight()
    refuses(
      () => settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
        declared_fen: 2_500, outbox_len: 0, receiver_user_id: f.userId('Amar'),
      }),
      'OWN_SETTLEMENT', 403,
    )
  })

  /**
   * The envelope goes to an approver, and *approver* is now a setting rather
   * than a role: with `approver_roles` at its default every colleague may take
   * it, which is what the venue wants at 02:00. This is the other venue — the
   * one whose owner takes the approvals himself — where handing the night's cash
   * to the person next to you is refused.
   */
  it('is never a colleague the owner has not made an approver', () => {
    const { shiftId } = amarsNight()
    f.settingsWith({ approver_roles: ['admin'] })
    refuses(
      () => settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
        declared_fen: 2_500, outbox_len: 0, receiver_user_id: f.userId('Lejla'),
      }),
      'NOT_APPROVER', 403,
    )
  })

  it('can also sign for it afterwards, once', () => {
    const { shiftId } = amarsNight()
    const result = settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
      declared_fen: 2_500, outbox_len: 0,
    })

    // A non-approver never decides anybody's money — not even to sign for it.
    // The two settles below happen before the setting changes, because signing
    // is what this test is about and `Emir` has to be able to hand his own over.
    const emirs = settle(f.db, f.venueId, f.actor('Emir'), shiftId, {
      declared_fen: 0, outbox_len: 0,
    })

    f.settingsWith({ approver_roles: ['admin'] })
    refuses(
      () => acceptSettlement(f.db, f.venueId, f.actor('Lejla'), shiftId, result.settlement_id),
      'NOT_APPROVER', 403,
    )
    f.settingsWith({})

    // An approver may sign for anybody's envelope but his own.
    refuses(
      () => acceptSettlement(f.db, f.venueId, f.actor('Emir'), shiftId, emirs.settlement_id),
      'OWN_SETTLEMENT', 403,
    )

    const accepted = acceptSettlement(
      f.db, f.venueId, f.actor('Emir'), shiftId, result.settlement_id,
    )
    expect(accepted.accepted_by_name).toBe('Emir')
    // The envelope was still counted with nobody watching, and the row says so.
    expect(accepted.self_sealed).toBe(true)

    refuses(
      () => acceptSettlement(f.db, f.venueId, f.actor('Emir'), shiftId, result.settlement_id),
      'ALREADY_ACCEPTED', 409,
    )
  })
})

describe('money that moves after somebody has signed off', () => {
  it('a from_waiter refund lowers his expected by the amount exactly once', () => {
    const { shiftId, tabId } = amarsNight()
    const result = settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
      declared_fen: 2_500, outbox_len: 0,
    })
    const before = f.db.select().from(schema.waiterSettlements)
      .where(eq(schema.waiterSettlements.id, result.settlement_id)).get()!

    // WP3's `insertReversal`: the void is applied on a tab that was already paid
    // and the waiter physically hands 5,00 back. The negative payment row *is*
    // the whole story — there is deliberately no second "subtract the void" term.
    const line = f.db.select().from(schema.orderLines).all()[0]!
    f.voidLine('Amar', line.id, {
      status: 'applied', wasPaid: true, approvedBy: 'Emir', amountFen: 500,
    })
    f.pay('Amar', tabId, -500, { approvedBy: 'Emir' })

    const live = expectedCash(f.db, f.venueId, shiftId, f.userId('Amar')).waiters[0]!
    expect(live.expected_fen).toBe(2_000) // 2500 − 500, once and not twice
    expect(live.cash_fen).toBe(1_500)

    const after = f.db.select().from(schema.waiterSettlements)
      .where(eq(schema.waiterSettlements.id, result.settlement_id)).get()!
    expect(after.summaryJson).toBe(before.summaryJson)
    expect(after.breakdownJson).toBe(before.breakdownJson)
    expect(after.expectedAtDeclareFen).toBe(2_500)
  })

  it('cash taken after the signature raises his expected and is named', () => {
    const { shiftId } = amarsNight()
    const result = settle(f.db, f.venueId, f.actor('Amar'), shiftId, {
      declared_fen: 2_500, outbox_len: 0,
    })
    const before = f.db.select().from(schema.waiterSettlements)
      .where(eq(schema.waiterSettlements.id, result.settlement_id)).get()!

    const late = f.lock('Amar', 'Sto 9', [{ product: 'Red Bull' }])
    f.pay('Amar', late.tabId, 4_000, { postSettle: true })

    const live = expectedCash(f.db, f.venueId, shiftId, f.userId('Amar')).waiters[0]!
    expect(live.expected_fen).toBe(6_500)
    // Reported separately so the strip can say "nakon predaje: +40,00 KM"…
    expect(live.post_settle_cash_fen).toBe(4_000)
    // …and never added twice: it is already inside `cash_fen`.
    expect(live.cash_fen).toBe(6_000)

    const after = f.db.select().from(schema.waiterSettlements)
      .where(eq(schema.waiterSettlements.id, result.settlement_id)).get()!
    expect(after.summaryJson).toBe(before.summaryJson)
  })

  it('a round locked after the signature is counted at what the tab still owes', () => {
    const { shiftId } = amarsNight()
    settle(f.db, f.venueId, f.actor('Amar'), shiftId, { declared_fen: 2_500, outbox_len: 0 })

    const late = lockPostSettle(f, 'Amar', 'Sto 9', 'Red Bull')

    const mine = () => expectedCash(f.db, f.venueId, shiftId, f.userId('Amar')).waiters[0]!
    expect(mine().post_settle_lock_fen).toBe(500)
    expect(mine().expected_fen).toBe(3_000)
    const venueBefore = expectedCash(f.db, f.venueId, shiftId).venue_expected_fen

    // A colleague takes the money for it. The venue is holding exactly the same
    // cash as a second ago; it has only moved into Lejla's pocket.
    f.pay('Lejla', late.tabId, 500)
    f.db.update(schema.tabs)
      .set({ status: 'paid', closedAt: f.clock.now(), closedBy: f.userId('Lejla') })
      .where(eq(schema.tabs.id, late.tabId)).run()

    const ec = expectedCash(f.db, f.venueId, shiftId)
    expect(ec.venue_expected_fen).toBe(venueBefore)
    expect(ec.waiters.find(w => w.name === 'Amar')!.post_settle_lock_fen).toBe(0)
    expect(ec.waiters.find(w => w.name === 'Lejla')!.cash_fen).toBe(500)
    expect(ec.venue_expected_fen).toBe(
      ec.waiters.reduce((n, w) => n + w.expected_fen, ec.drawer_expected_fen),
    )
  })
})
