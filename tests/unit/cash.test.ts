/**
 * The drawer, and the one identity everything else leans on:
 *
 *     venue_expected_fen === drawer_expected_fen + Σ waiters[].expected_fen
 *
 * It is asserted after **every** mutation in this file, not once at the end. The
 * two bugs `expectedCash` was rewritten to fix — a post-settlement lock counted
 * at what was charged instead of at what is owed, and a `from_waiter` refund
 * subtracted twice — were both invisible to a sign test and to a spot check of
 * the total, because both sides of the identity moved together. Only the exact
 * numbers catch them, so this file asserts exact numbers.
 *
 * **The fixture writes rows, not calls** (`docs/BACKEND.md` §11). `f.pay` and
 * `f.voidLine` insert `payments` and `line_adjustments` through the schema
 * rather than through WP3's services, which do not exist yet. That is sound
 * precisely because `expectedCash` reads *columns* — `payments.method/paid_by/
 * post_settle`, `tabs.status/unpaid_by`, `line_adjustments.kind/was_paid/status`,
 * `cash_movements.type/status` — so a fixture that produces the right columns is
 * a complete fixture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { expectReconciled as reconciles, markUnpaid, refuses } from '../helpers/shifts'

// WP5's `log`/`bump` and WP1's `verifyPinMetered`/`assertNoPendingOutbox` are
// still `contracts.ts` stubs that throw `NOT_IMPLEMENTED`. WP2 calls them exactly
// as the contract says so they light up the day those packages land; here they
// are doubles, so nothing in this file depends on another package's code.
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

const {
  acknowledgeFloat, decideCashMovement, expectedCash, moveFloat, openingFloat,
  pickup, requestPayout, setOpeningFloat, withinTolerance,
} = await import('../../server/services/cash')

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

/** The identity, everywhere. */
function expectReconciled(shiftId: string): number {
  return reconciles(expectedCash(f.db, f.venueId, shiftId))
}

function waiter(shiftId: string, name: string) {
  return expectedCash(f.db, f.venueId, shiftId).waiters.find(w => w.name === name)
}

/**
 * One night, written straight into the ledger:
 *
 *   drawer   float in 200,00 · payout 15,00 approved · payout 60,00 pending
 *            · float out 50,00 to Amar and 30,00 to Lejla · refund 10,00
 *            · owner pickup 20,00 (which is deliberately not "expected" anywhere)
 *   Amar     cash 6,00 + 15,00, a −2,00 reversal, one unpaid tab of 1,50
 *   Lejla    cash 6,50, card 6,00, one pending void of 1,50
 */
function night(): string {
  const shiftId = f.openShift({ members: ['Amar', 'Lejla', 'Emir'] })

  const a1 = f.lock('Amar', 'Sto 1', [{ product: 'Kafa', qty: 2 }, { product: 'Coca-Cola' }])
  const a2 = f.lock('Amar', 'Sto 2', [{ product: 'Nargila' }])
  const l1 = f.lock('Lejla', 'Sto 3', [{ product: 'Red Bull' }, { product: 'Kafa' }])
  const l2 = f.lock('Lejla', 'Sto 4', [{ product: 'Coca-Cola', qty: 2 }])

  f.cashMovement({ type: 'float_in', amountFen: 20_000, user: 'Haris' })
  f.cashMovement({ type: 'float_out', amountFen: 5_000, user: 'Amar' })
  f.cashMovement({ type: 'float_out', amountFen: 3_000, user: 'Lejla' })
  f.cashMovement({ type: 'payout', amountFen: 1_500, user: 'Emir', status: 'approved' })
  f.cashMovement({ type: 'payout', amountFen: 6_000, user: 'Emir', status: 'pending' })
  f.cashMovement({ type: 'refund', amountFen: 1_000, user: 'Haris' })
  f.cashMovement({ type: 'owner_pickup', amountFen: 2_000, user: 'Haris' })

  f.pay('Amar', a1.tabId, 600)
  f.pay('Amar', a2.tabId, 1_500)
  f.pay('Amar', a1.tabId, -200, { approvedBy: 'Emir' })
  f.pay('Lejla', l1.tabId, 650)
  f.pay('Lejla', l2.tabId, 600, { method: 'card' })

  // Amar's unpaid tab, waiting for the owner's decision.
  const unpaid = f.lock('Amar', 'Sto 5', [{ product: 'Kafa' }])
  markUnpaid(f, unpaid.tabId, 'Amar')

  // Lejla asked for a storno nobody has granted; until somebody does, the money
  // is still hers to hand over.
  f.voidLine('Lejla', l1.lineIds[1]!, { status: 'pending' })

  return shiftId
}

describe('expectedCash — the reconciliation', () => {
  it('puts every fen in exactly one pocket', () => {
    const shiftId = night()
    const ec = expectedCash(f.db, f.venueId, shiftId)

    // 200,00 in − 15,00 approved payout − 80,00 handed out − 10,00 refunded.
    // The 60,00 payout is pending and the 20,00 pickup left the building.
    expect(ec.drawer_expected_fen).toBe(9_500)

    const amar = ec.waiters.find(w => w.name === 'Amar')!
    expect(amar.float_out_fen).toBe(5_000)
    expect(amar.cash_fen).toBe(1_900) // 600 + 1500 − 200
    expect(amar.unpaid_fen).toBe(150)
    expect(amar.void_held_fen).toBe(0)
    expect(amar.post_settle_lock_fen).toBe(0)
    expect(amar.expected_fen).toBe(7_050)

    const lejla = ec.waiters.find(w => w.name === 'Lejla')!
    expect(lejla.float_out_fen).toBe(3_000)
    expect(lejla.cash_fen).toBe(650) // the 600 card payment is not cash
    expect(lejla.void_held_fen).toBe(150)
    expect(lejla.expected_fen).toBe(3_800)

    expect(ec.venue_expected_fen).toBe(20_350)
    expect(expectReconciled(shiftId)).toBe(20_350)
  })

  it('gives nobody a row for a payout or a pickup', () => {
    const shiftId = night()
    const names = expectedCash(f.db, f.venueId, shiftId).waiters.map(w => w.name)
    // Emir only ever asked for a payout and Haris only moved the drawer; neither
    // is holding café cash, so neither has a pocket to account for.
    expect(names).toEqual(['Amar', 'Lejla'])
  })

  it('says when nobody has told it what the drawer started with', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const ec = expectedCash(f.db, f.venueId, shiftId)
    expect(ec.opening_float_known).toBe(false)
    expect(ec.drawer_expected_fen).toBe(0)
  })

  it('narrows to one waiter without moving the venue total', () => {
    const shiftId = night()
    const mine = expectedCash(f.db, f.venueId, shiftId, f.userId('Amar'))
    expect(mine.waiters).toHaveLength(1)
    expect(mine.waiters[0]!.expected_fen).toBe(7_050)
    // The venue number still describes the whole shift — a settle needs both.
    expect(mine.venue_expected_fen).toBe(20_350)
  })

  it('gives a person who has settled a row even when he holds nothing', () => {
    const shiftId = f.openShift({ members: ['Dino'] })
    f.settle('Dino')
    const dino = waiter(shiftId, 'Dino')
    expect(dino?.expected_fen).toBe(0)
    expect(dino?.settled).toBe(true)
  })
})

describe('a pending cash movement moves nothing', () => {
  it('until the receiver says he has it', () => {
    const shiftId = night()
    const before = expectReconciled(shiftId)

    const movement = moveFloat(f.db, f.venueId, f.adminActor(), shiftId, {
      type: 'float_out', user_id: f.userId('Dino'), amount_fen: 4_000,
    })
    expect(movement.status).toBe('pending')
    expect(expectReconciled(shiftId)).toBe(before)
    expect(waiter(shiftId, 'Dino')).toBeUndefined()

    acknowledgeFloat(f.db, f.venueId, f.actor('Dino'), movement.id)

    // The venue's money did not change — it moved from the drawer to a pocket.
    expect(expectReconciled(shiftId)).toBe(before)
    expect(waiter(shiftId, 'Dino')?.expected_fen).toBe(4_000)
    expect(expectedCash(f.db, f.venueId, shiftId).drawer_expected_fen).toBe(9_500 - 4_000)
  })

  it('and only the receiver may say it', () => {
    const shiftId = night()
    const movement = moveFloat(f.db, f.venueId, f.adminActor(), shiftId, {
      type: 'float_out', user_id: f.userId('Dino'), amount_fen: 4_000,
    })
    refuses(() => acknowledgeFloat(f.db, f.venueId, f.actor('Tarik'), movement.id),
      'NOT_RECEIVER', 403)
  })

  it('a float_in needs nobody: the drawer is not a person', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const movement = moveFloat(f.db, f.venueId, f.adminActor(), shiftId, {
      type: 'float_in', user_id: f.userId('Haris'), amount_fen: 5_000,
    })
    expect(movement.status).toBe('approved')
    expect(expectedCash(f.db, f.venueId, shiftId).drawer_expected_fen).toBe(5_000)
  })
})

describe('deciding a payout', () => {
  it('refuses the requester, whoever wrote the row', () => {
    const shiftId = f.openShift({ members: ['Emir'] })
    const payout = requestPayout(f.db, f.venueId, f.actor('Emir'), shiftId, {
      amount_fen: 4_999, reason: 'dobavljac',
    })
    expect(payout.needs_owner).toBe(false)
    refuses(() => decideCashMovement(f.db, f.venueId, f.actor('Emir'), payout.id, {
      outcome: 'approved',
    }), 'SELF_APPROVAL', 403)
    // …and the drawer never moved.
    expect(expectedCash(f.db, f.venueId, shiftId).drawer_expected_fen).toBe(0)
  })

  it('sends a big one to the owner even where the setting lets a bartender in', () => {
    f.settingsWith({ payout_approver_roles: ['admin', 'bartender'] })
    const shiftId = f.openShift({ members: ['Amar', 'Emir'] })
    const payout = requestPayout(f.db, f.venueId, f.actor('Amar'), shiftId, {
      amount_fen: 6_000, reason: 'dobavljac',
    })
    expect(payout.needs_owner).toBe(true)
    refuses(() => decideCashMovement(f.db, f.venueId, f.actor('Emir'), payout.id, {
      outcome: 'approved',
    }), 'OWNER_REQUIRED', 403)

    const decided = decideCashMovement(f.db, f.venueId, f.adminActor(), payout.id, {
      outcome: 'approved',
    })
    expect(decided.status).toBe('approved')
    expect(expectedCash(f.db, f.venueId, shiftId).drawer_expected_fen).toBe(-6_000)
  })

  it('refuses a bartender outright when the setting does not name him', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Emir'] })
    const payout = requestPayout(f.db, f.venueId, f.actor('Amar'), shiftId, {
      amount_fen: 1_000, reason: 'sitno',
    })
    refuses(() => decideCashMovement(f.db, f.venueId, f.actor('Emir'), payout.id, {
      outcome: 'approved',
    }), 'NOT_APPROVER', 403)
  })

  it('is decided once, and rejecting moves no money', () => {
    const shiftId = night()
    const before = expectReconciled(shiftId)
    const pending = f.db.select().from(schema.cashMovements)
      .where(and(
        eq(schema.cashMovements.shiftId, shiftId),
        eq(schema.cashMovements.status, 'pending'),
      ))
      .get()!

    decideCashMovement(f.db, f.venueId, f.adminActor(), pending.id, { outcome: 'rejected' })
    expect(expectReconciled(shiftId)).toBe(before)

    refuses(() => decideCashMovement(f.db, f.venueId, f.adminActor(), pending.id, {
      outcome: 'approved',
    }), 'ALREADY_DECIDED', 409)
  })

  it('has nothing to say about a type born approved', () => {
    const shiftId = night()
    const refund = f.db.select().from(schema.cashMovements)
      .where(and(
        eq(schema.cashMovements.shiftId, shiftId),
        eq(schema.cashMovements.type, 'refund'),
      ))
      .get()!
    refuses(() => decideCashMovement(f.db, f.venueId, f.adminActor(), refund.id, {
      outcome: 'approved',
    }), 'NOT_PENDING', 409)
  })
})

describe('the opening float', () => {
  it('is the previous close minus what the owner took out of it', () => {
    const first = f.openShift({ members: ['Amar'], at: f.clock.now() })
    f.db.insert(schema.cashMovements).values({
      id: crypto.randomUUID(),
      venueId: f.venueId,
      shiftId: first,
      type: 'owner_pickup',
      amountFen: 30_000,
      userId: f.userId('Haris'),
      createdBy: f.userId('Haris'),
      status: 'approved',
      createdAt: f.clock.now(),
    }).run()
    f.db.update(schema.shifts)
      .set({
        status: 'closed', closedAt: f.clock.now(), closedBy: f.userId('Haris'),
        closedKind: 'normal', cashCountedFen: 50_000,
      })
      .where(eq(schema.shifts.id, first))
      .run()

    f.clock.advance(3600 * 20)
    const second = f.openShift({ members: ['Amar'], at: f.clock.now() })
    const shift = f.db.select().from(schema.shifts)
      .where(eq(schema.shifts.id, second)).get()!

    expect(openingFloat(f.db, f.venueId, shift)).toEqual({ fen: 20_000, source: 'derived' })
    expect(expectedCash(f.db, f.venueId, second).drawer_expected_fen).toBe(20_000)
  })

  it('is whatever the admin says it is, and says what it replaced', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    setOpeningFloat(f.db, f.venueId, f.adminActor(), shiftId, { fen: 12_345 })
    const shift = f.db.select().from(schema.shifts)
      .where(eq(schema.shifts.id, shiftId)).get()!
    expect(openingFloat(f.db, f.venueId, shift)).toEqual({ fen: 12_345, source: 'override' })
    expect(expectReconciled(shiftId)).toBe(12_345)
  })

  it('drives the next night, but is not expected in this one', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    moveFloat(f.db, f.venueId, f.adminActor(), shiftId, {
      type: 'float_in', user_id: f.userId('Haris'), amount_fen: 10_000,
    })
    pickup(f.db, f.venueId, f.adminActor(), shiftId, { amount_fen: 4_000 })
    // A pickup is money that left the café: it lowers nothing that is "expected".
    expect(expectReconciled(shiftId)).toBe(10_000)
  })
})

describe('withinTolerance', () => {
  it('takes the larger of the flat and the percentage bound', () => {
    const settings = { cash_tolerance_fen: 500, cash_tolerance_pct: 1 } as never
    expect(withinTolerance(500, 10_000, settings)).toBe(true)
    expect(withinTolerance(-501, 10_000, settings)).toBe(false)
    // 1 % of 200,00 KM is 2,00 KM, which beats the 5,00 KM floor at 500,00 KM.
    expect(withinTolerance(-900, 90_000, settings)).toBe(true)
    expect(withinTolerance(901, 90_000, settings)).toBe(false)
  })
})
