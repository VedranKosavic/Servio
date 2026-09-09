/**
 * Opening the night, and closing it once.
 *
 * The close is the only place where a number the server computed meets a number
 * a human counted, so most of this file is about what it refuses: an open tab,
 * a missing opening count, a difference nobody explained. The one rule that is
 * easy to get subtly wrong and hard to notice is what `expected` is compared
 * against — the drawer plus **only the waiters who have already settled**, with
 * everybody else reported as `outstanding_fen`. Comparing the drawer against
 * money still in somebody's pocket makes every close need a note, and a café
 * that writes a note every night has stopped reading them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { closeTab, refuses } from '../helpers/shifts'

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

// The service modules are imported **before** `contracts`, and that order is
// load-bearing: `contracts.ts` re-exports WP2's own functions, so the two files
// import each other. Pulling `contracts` first makes the mock factory's
// `importOriginal()` walk into `shifts.ts` through the unmocked graph, and the
// doubles below would then be bound to nothing.
const {
  closeShift, ensureOpenShift, forceClose, hasSubmittedCount, leaveShift, openShift,
  reviewShift, setCustodian, shiftBrief, startClosing,
} = await import('../../server/services/shifts')
const contracts = await import('../../server/services/contracts')

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
  // `mockReset`, not `mockClear`: a `mockImplementationOnce` that its test never
  // reached would otherwise fire in the next one.
  vi.mocked(contracts.log).mockReset()
  vi.mocked(contracts.log).mockImplementation(() => 'log-entry')
})

/**
 * A night ready to be closed: an opening count, 100,00 in the drawer, Amar with
 * 20,00 in cash and Lejla with 10,00, every tab settled with the guest.
 *
 *   drawer 100,00 · Amar 20,00 · Lejla 10,00  →  venue 130,00
 */
function nightReadyToClose(): string {
  const shiftId = f.openShift({ members: ['Amar', 'Lejla', 'Emir'] })
  f.submitCount('Emir', ['Kafa (mljevena)'], { phase: 'open' })
  f.cashMovement({ type: 'float_in', amountFen: 10_000, user: 'Haris' })

  const a = f.lock('Amar', 'Sto 1', [{ product: 'Nargila' }, { product: 'Red Bull' }])
  f.pay('Amar', a.tabId, 2_000)
  closeTab(f, a.tabId, 'Amar')

  const l = f.lock('Lejla', 'Sto 2', [{ product: 'Kafa' }, { product: 'Coca-Cola' }])
  f.pay('Lejla', l.tabId, 1_000)
  closeTab(f, l.tabId, 'Lejla')

  return shiftId
}

describe('opening the night', () => {
  it('a round queued at 02:30 belongs to the night before', () => {
    // 00:30 UTC is 02:30 in Sarajevo in September, which is still the 8th's
    // night: the business day starts at 06:00.
    const clientAt = '2026-09-09T00:30:00.000Z'
    const shift = f.db.transaction(tx =>
      ensureOpenShift(tx, f.venueId, f.actor('Amar'), '2026-09-09T00:31:00.000Z', clientAt))

    expect(shift.created).toBe(true)
    expect(shift.shift.businessDate).toBe('2026-09-08')
    expect(shift.shift.autoOpened).toBe(1)
  })

  it('is opened once, and the database is what says so', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    expect(shiftId).toBeTruthy()
    f.expectRefused(
      `INSERT INTO shifts (id, venue_id, business_date, opened_at, opened_by, auto_opened,
         status, created_at)
       VALUES ('x', '${f.venueId}', '2026-09-08', '2026-09-08T20:00:00Z',
               '${f.userId('Amar')}', 0, 'open', '2026-09-08T20:00:00Z')`,
      /UNIQUE constraint failed/,
    )
  })

  it('refuses a second explicit open', () => {
    f.openShift({ members: ['Amar'] })
    refuses(() => openShift(f.db, f.venueId, f.actor('Amar'), {}), 'SHIFT_ALREADY_OPEN', 409)
  })

  it('records who opened it and puts him on it', () => {
    const shift = openShift(f.db, f.venueId, f.actor('Emir'), {})
    expect(shift.auto_opened).toBe(false)
    expect(shift.opened_by_name).toBe('Emir')
    const member = f.db.select().from(schema.shiftMembers)
      .where(eq(schema.shiftMembers.shiftId, shift.id)).get()
    expect(member?.userId).toBe(f.userId('Emir'))
  })

  it('names a stock custodian once and never moves him', () => {
    const shiftId = f.openShift({ members: ['Emir'] })
    f.db.transaction((tx) => {
      setCustodian(tx, f.venueId, shiftId, f.userId('Emir'))
      setCustodian(tx, f.venueId, shiftId, f.userId('Amar'))
    })
    const shift = f.db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId)).get()!
    expect(shift.stockCustodianId).toBe(f.userId('Emir'))
  })
})

describe('the brief every waiter screen reads', () => {
  it('counts his own open tabs and knows whether he has settled', () => {
    f.openShift({ members: ['Amar', 'Lejla'] })
    f.lock('Amar', 'Sto 1', [{ product: 'Kafa' }])
    f.lock('Amar', 'Sto 2', [{ product: 'Kafa' }])
    f.lock('Lejla', 'Sto 3', [{ product: 'Kafa' }])

    const amar = shiftBrief(f.db, f.venueId, f.actor('Amar'))!
    expect(amar.my_open_tabs).toBe(2)
    expect(amar.my_settled).toBe(false)
    expect(amar.closing).toBe(false)

    f.settle('Amar')
    expect(shiftBrief(f.db, f.venueId, f.actor('Amar'))!.my_settled).toBe(true)
    expect(shiftBrief(f.db, f.venueId, f.actor('Lejla'))!.my_settled).toBe(false)
  })

  it('says who started the closing', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Emir'] })
    startClosing(f.db, f.venueId, f.actor('Emir'), shiftId)
    const brief = shiftBrief(f.db, f.venueId, f.actor('Amar'))!
    expect(brief.closing).toBe(true)
    expect(brief.closer_name).toBe('Emir')
  })

  it('is null when the café is shut', () => {
    expect(shiftBrief(f.db, f.venueId, f.actor('Amar'))).toBeNull()
  })
})

describe('closing the night', () => {
  const pin = '1234'

  it('refuses while a table is still open', () => {
    const shiftId = nightReadyToClose()
    f.lock('Amar', 'Sto 7', [{ product: 'Kafa' }])
    refuses(
      () => closeShift(f.db, f.venueId, f.adminActor(), shiftId, {
        cash_counted_fen: 13_000, pin,
      }),
      'OPEN_TABS', 409,
    )
  })

  it('refuses without the opening count, and lets an admin override it', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    expect(hasSubmittedCount(f.db, f.venueId, shiftId, 'open')).toBe(false)

    refuses(
      () => closeShift(f.db, f.venueId, f.actor('Emir'), shiftId, {
        cash_counted_fen: 0, pin: '123456',
      }),
      'NO_OPEN_COUNT', 409,
    )

    const result = closeShift(f.db, f.venueId, f.adminActor(), shiftId, {
      cash_counted_fen: 0, pin: '123456', override_no_open_count: true,
    })
    expect(result.shift.status).toBe('closed')
    const kinds = vi.mocked(contracts.log).mock.calls.map(c => c[2].kind)
    expect(kinds).toContain('override')
  })

  it('refuses a waiter: nobody counts the drawer but an approver', () => {
    const shiftId = nightReadyToClose()
    refuses(
      () => closeShift(f.db, f.venueId, f.actor('Amar'), shiftId, {
        cash_counted_fen: 13_000, pin,
      }),
      'NOT_APPROVER', 403,
    )
  })

  it('compares the drawer against the envelopes that are actually in', () => {
    const shiftId = nightReadyToClose()
    // Amar has handed his over; Lejla has not, so her 10,00 is outstanding and
    // deliberately outside the comparison.
    f.settle('Amar', { declaredFen: 2_000, expectedFen: 2_000 })

    const result = closeShift(f.db, f.venueId, f.adminActor(), shiftId, {
      cash_counted_fen: 12_000, pin,
    })

    expect(result.expected_fen).toBe(12_000)
    expect(result.outstanding_fen).toBe(1_000)
    expect(result.counted_fen).toBe(12_000)
    expect(result.diff_fen).toBe(0)
    expect(result.within_tolerance).toBe(true)
    expect(result.missing_settlements.map(m => m.name)).toEqual(['Lejla'])
    expect(result.summary_version).toBe(1)
  })

  it('needs a sentence when the count is outside tolerance', () => {
    const shiftId = nightReadyToClose()
    f.settle('Amar', { declaredFen: 2_000, expectedFen: 2_000 })

    // 6,00 short on a 120,00 expectation: past the 5,00 floor and past 1 %.
    refuses(
      () => closeShift(f.db, f.venueId, f.adminActor(), shiftId, {
        cash_counted_fen: 11_400, pin,
      }),
      'NOTE_REQUIRED', 422,
    )

    const result = closeShift(f.db, f.venueId, f.adminActor(), shiftId, {
      cash_counted_fen: 11_400, pin, closing_note: 'Fali 6 KM, provjeriti sutra.',
    })
    expect(result.diff_fen).toBe(-600)
    expect(result.within_tolerance).toBe(false)
    expect(result.shift.closing_note).toBe('Fali 6 KM, provjeriti sutra.')
  })

  it('sends everybody home and writes version 1 of the numbers', () => {
    const shiftId = nightReadyToClose()
    closeShift(f.db, f.venueId, f.adminActor(), shiftId, { cash_counted_fen: 10_000, pin,
      closing_note: 'Lejla nije predala.' })

    const members = f.db.select().from(schema.shiftMembers)
      .where(eq(schema.shiftMembers.shiftId, shiftId)).all()
    expect(members).not.toHaveLength(0)
    expect(members.every(m => m.leftAt !== null && m.leftAtSource === 'auto')).toBe(true)

    const summaries = f.db.select().from(schema.shiftSummaries)
      .where(eq(schema.shiftSummaries.shiftId, shiftId)).all()
    expect(summaries.map(s => s.version)).toEqual([1])
    expect(summaries[0]!.reason).toBe('close')
    expect(summaries[0]!.countedCashFen).toBe(10_000)
  })

  it('cannot be half done', () => {
    const shiftId = nightReadyToClose()
    // The `shift_closed` entry is written after the row is updated; a throw
    // there must take the whole close with it.
    vi.mocked(contracts.log).mockImplementationOnce(() => {
      throw new Error('log exploded')
    })

    // Nobody has settled, so `expected` is the drawer alone: 100,00.
    expect(() => closeShift(f.db, f.venueId, f.adminActor(), shiftId, {
      cash_counted_fen: 10_000, pin,
    })).toThrow('log exploded')

    const shift = f.db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId)).get()!
    expect(shift.status).toBe('open')
    expect(shift.cashCountedFen).toBeNull()
    expect(f.db.select().from(schema.shiftSummaries)
      .where(eq(schema.shiftSummaries.shiftId, shiftId)).all()).toHaveLength(0)
    expect(f.db.select().from(schema.shiftMembers)
      .where(and(
        eq(schema.shiftMembers.shiftId, shiftId),
        eq(schema.shiftMembers.leftAtSource, 'auto'),
      )).all()).toHaveLength(0)
  })

  it('closes once', () => {
    const shiftId = nightReadyToClose()
    closeShift(f.db, f.venueId, f.adminActor(), shiftId, { cash_counted_fen: 10_000, pin })
    refuses(
      () => closeShift(f.db, f.venueId, f.adminActor(), shiftId, {
        cash_counted_fen: 10_000, pin,
      }),
      'SHIFT_CLOSED', 409,
    )
  })
})

describe('force close', () => {
  it('skips the tabs and the count, records no cash, and names who never settled', () => {
    const shiftId = f.openShift({ members: ['Amar', 'Lejla'] })
    f.cashMovement({ type: 'float_in', amountFen: 5_000, user: 'Haris' })
    const open = f.lock('Amar', 'Sto 3', [{ product: 'Kafa' }])
    f.pay('Amar', open.tabId, 150)

    const result = forceClose(f.db, f.venueId, f.adminActor(), shiftId, {
      note: 'Telefon crko, zatvaram rukom.',
    })

    expect(result.shift.closed_kind).toBe('forced')
    expect(result.counted_fen).toBeNull()
    expect(result.diff_fen).toBeNull()
    expect(result.shift.cash_counted_fen).toBeNull()
    expect(result.missing_settlements.map(m => m.name)).toEqual(['Amar'])
    expect(result.outstanding_fen).toBe(150)

    const kinds = vi.mocked(contracts.log).mock.calls.map(c => c[2].kind)
    expect(kinds).toContain('shift_forced')
  })

  it('belongs to the owner and not to the bartender', () => {
    const shiftId = f.openShift({ members: ['Emir'] })
    refuses(
      () => forceClose(f.db, f.venueId, f.actor('Emir'), shiftId, { note: 'ma daj' }),
      'FORBIDDEN', 403,
    )
  })
})

describe('review', () => {
  it('needs a sentence when the terminal disagrees with the ledger', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    f.submitCount('Amar', ['Kafa (mljevena)'], { phase: 'open' })
    const tab = f.lock('Amar', 'Sto 1', [{ product: 'Red Bull' }])
    f.pay('Amar', tab.tabId, 500, { method: 'card' })
    closeTab(f, tab.tabId, 'Amar')
    closeShift(f.db, f.venueId, f.adminActor(), shiftId, { cash_counted_fen: 0, pin: '123456' })

    refuses(
      () => reviewShift(f.db, f.venueId, f.adminActor(), shiftId, { card_total_fen: 700 }),
      'NOTE_REQUIRED', 422,
    )

    const reviewed = reviewShift(f.db, f.venueId, f.adminActor(), shiftId, {
      card_total_fen: 700, closing_note: 'Terminal je uzeo i jučerašnju transakciju.',
    })
    expect(reviewed.status).toBe('reviewed')
    expect(reviewed.card_total_fen).toBe(700)

    // A card total that matches needs nothing.
    const other = f.openShift({ members: ['Amar'] })
    f.submitCount('Amar', ['Šećer'], { phase: 'open' })
    closeShift(f.db, f.venueId, f.adminActor(), other, { cash_counted_fen: 0, pin: '123456' })
    expect(reviewShift(f.db, f.venueId, f.adminActor(), other, { card_total_fen: 0 }).status)
      .toBe('reviewed')
  })

  it('refuses a shift that is still running', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    refuses(
      () => reviewShift(f.db, f.venueId, f.adminActor(), shiftId, {}),
      'SHIFT_NOT_CLOSED', 409,
    )
  })
})

describe('leaving', () => {
  it('happens once, and a logout is not one', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    const left = leaveShift(f.db, f.venueId, f.actor('Amar'), shiftId)
    expect(left.left_at).toBeTruthy()

    const member = f.db.select().from(schema.shiftMembers)
      .where(eq(schema.shiftMembers.shiftId, shiftId)).get()!
    expect(member.leftAtSource).toBe('manual')

    refuses(() => leaveShift(f.db, f.venueId, f.actor('Amar'), shiftId), 'ALREADY_LEFT', 409)
  })
})
