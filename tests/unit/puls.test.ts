/**
 * *Puls* — the logic a rendering cannot catch.
 *
 * There is no DOM here (`environment: 'node'`), the same as `admin-ui.test.ts`:
 * mounting a component to assert that a button says "Odobri" tests Vue, not
 * Šank. What is worth a test is the handful of pure functions behind the page,
 * because each of them is a way to be quietly and expensively wrong:
 *
 * - **which shift it is, which one just ended and which one is next.** The screen
 *   always draws two cards, and it works out which two from the roster's
 *   templates and the café's wall clock. The café runs 07–15 and 15–23, so
 *   between 23:00 and 07:00 no template owns the clock at all — and that gap is
 *   exactly when the owner opens this screen to ask what last night took.
 * - **what a shift sold.** The counter is folded in the browser out of the
 *   ledger's own lines, and an applied storno must not read as a sale.
 * - **the shift's promet.** It is the fold of `live.who`, not the business day's
 *   total, and on a day the first shift worked those are different numbers.
 * - **the room's geometry**, which is the catalogue's col/row and never this
 *   code's.
 * - **the decide bodies.** No screen posts one tonight — *Čeka odluku* is gone —
 *   but three routes each mean something different by *Odobri*, and that
 *   vocabulary is kept under test so whichever screen is given those doors later
 *   does not have to guess at it a second time.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  LineRow, LiveWho, ShiftTemplateView, TableState, VenueTable,
} from '../../shared/types'
import {
  NOTE_MIN,
  decisionBody,
  decisionNeedsNote,
  floorZones,
  greetingBs,
  shiftClock,
  shiftPillBs,
  shiftPrometFen,
  shiftWhenBs,
  shiftWindowFor,
  soldRows,
  soldTotals,
  weekdayBs,
  zoneLabel,
} from '../../app/utils/puls'

// ===========================================================================

describe('decisionBody', () => {
  it('speaks each decide route’s own vocabulary', () => {
    expect(decisionBody('line_adjustment', 'approve')).toEqual({ outcome: 'applied' })
    expect(decisionBody('line_adjustment', 'reject')).toEqual({ outcome: 'rejected' })
    expect(decisionBody('cash_movement', 'approve')).toEqual({ outcome: 'approved' })
    expect(decisionBody('cash_movement', 'reject')).toEqual({ outcome: 'rejected' })
  })

  it('approves an unpaid tab as otpis and refuses it as naplatiti', () => {
    // *Odobri* approves the waiter's request to write the tab off; *Odbij*
    // means somebody has to go and collect. Getting this pair the wrong way
    // round would write off exactly the tabs the owner wanted chased.
    expect(decisionBody('tab', 'approve')).toEqual({ outcome: 'otpis' })
    expect(decisionBody('tab', 'reject')).toEqual({ outcome: 'naplatiti' })
  })

  it('sends an empty body for an accept and a confirm', () => {
    expect(decisionBody('waiter_settlement', 'approve')).toEqual({})
    expect(decisionBody('stock_count', 'approve')).toEqual({})
    expect(decisionBody('waste_event', 'approve')).toEqual({})
  })

  it('carries a written note, trimmed, and never an empty one', () => {
    expect(decisionBody('line_adjustment', 'reject', '  gost je platio  '))
      .toEqual({ outcome: 'rejected', note: 'gost je platio' })
    expect(decisionBody('line_adjustment', 'reject', '   ')).toEqual({ outcome: 'rejected' })
  })

  it('makes force-close the one action that needs a sentence', () => {
    expect(decisionNeedsNote('waiter_settlement', 'note')).toBe(true)
    expect(decisionNeedsNote('waiter_settlement', 'approve')).toBe(false)
    expect(decisionNeedsNote('line_adjustment', 'reject')).toBe(false)
    expect(decisionBody('waiter_settlement', 'note', 'otišao kući'))
      .toEqual({ note: 'otišao kući' })
    // `forceCloseBody` is `z.string().trim().min(3)`.
    expect(NOTE_MIN).toBe(3)
  })
})

// ===========================================================================

function template(patch: Partial<ShiftTemplateView> & { id: string }): ShiftTemplateView {
  return {
    name: 'Prva smjena', start_time: '07:00', end_time: '15:00', sort: 1, active: true, ...patch,
  }
}

/** The café's own two, as `db:roster` writes them. Neither crosses midnight. */
const SERVIO: ShiftTemplateView[] = [
  template({ id: 'p', name: 'Prva smjena', start_time: '07:00', end_time: '15:00', sort: 1 }),
  template({ id: 'd', name: 'Druga smjena', start_time: '15:00', end_time: '23:00', sort: 2 }),
]

/** A closing hour of 01:00 is one settings change away, so it stays under test. */
const LATE: ShiftTemplateView[] = [
  template({ id: 'a', name: 'Dnevna', start_time: '08:00', end_time: '16:00', sort: 1 }),
  template({ id: 'b', name: 'Večernja', start_time: '16:00', end_time: '01:00', sort: 2 }),
]

describe('shiftClock', () => {
  it('names the shift the café is in, and numbers it the way the owner asks', () => {
    const mid = shiftClock(SERVIO, '10:00')
    expect(mid.current?.name).toBe('Prva smjena')
    expect(mid.current?.hours).toBe('07–15')
    expect(mid.current?.ordinal_bs).toBe('prva smjena')
    expect(mid.current?.index).toBe(1)

    const evening = shiftClock(SERVIO, '18:05')
    expect(evening.current?.name).toBe('Druga smjena')
    expect(evening.current?.ordinal_bs).toBe('druga smjena')
    expect(evening.current?.hours).toBe('15–23')
  })

  it('hands 15:00 to the second shift and keeps 14:59 on the first', () => {
    // The two templates meet on that minute and exactly one of them may own it:
    // the start is inclusive, the end is not.
    expect(shiftClock(SERVIO, '14:59').current?.name).toBe('Prva smjena')
    expect(shiftClock(SERVIO, '15:00').current?.name).toBe('Druga smjena')
    expect(shiftClock(SERVIO, '22:59').current?.name).toBe('Druga smjena')
  })

  it('points at the shift that starts next, and says which day that is', () => {
    const mid = shiftClock(SERVIO, '10:00')
    expect(mid.next?.window.name).toBe('Druga smjena')
    expect(mid.next?.day).toBe('danas')
    expect(mid.next?.minutes).toBe(5 * 60)

    // A shift that is running does not shadow the other one by "starting" now:
    // its own next turn is a full day away.
    const boundary = shiftClock(SERVIO, '15:00')
    expect(boundary.next?.window.name).toBe('Prva smjena')
    expect(boundary.next?.day).toBe('sutra')
    expect(boundary.next?.minutes).toBe(16 * 60)
  })

  it('has no current shift at 23:00, and the evening has just ended', () => {
    const closed = shiftClock(SERVIO, '23:00')
    expect(closed.current).toBeNull()
    expect(closed.last?.window.name).toBe('Druga smjena')
    expect(closed.last?.minutes).toBe(0)
    expect(closed.last?.day).toBe('danas')
    expect(closed.next?.window.name).toBe('Prva smjena')
    expect(closed.next?.day).toBe('sutra')
  })

  it('reads half eleven at night as last night’s evening and tomorrow’s morning', () => {
    const night = shiftClock(SERVIO, '23:30')
    expect(night.current).toBeNull()
    expect(night.last?.window.name).toBe('Druga smjena')
    expect(night.last?.minutes).toBe(30)
    expect(night.last?.day).toBe('danas')
    expect(night.next?.window.name).toBe('Prva smjena')
    expect(night.next?.minutes).toBe(7 * 60 + 30)
    expect(night.next?.day).toBe('sutra')
  })

  it('reads five in the morning as yesterday’s evening and this morning', () => {
    // The business day has not rolled over yet, but the *calendar* day has — and
    // "sljedeća u 07:00" is today for the person reading the phone.
    const small = shiftClock(SERVIO, '05:00')
    expect(small.current).toBeNull()
    expect(small.last?.window.name).toBe('Druga smjena')
    // The day is an identifier and not a word: `shiftWhenBs` writes "jučer".
    expect(small.last?.day).toBe('juce')
    expect(small.last?.minutes).toBe(6 * 60)
    expect(small.next?.window.name).toBe('Prva smjena')
    expect(small.next?.day).toBe('danas')
    expect(small.next?.minutes).toBe(2 * 60)
  })

  it('keeps the hour before opening on the shift that is about to start', () => {
    const early = shiftClock(SERVIO, '06:59')
    expect(early.current).toBeNull()
    expect(early.next?.window.name).toBe('Prva smjena')
    expect(early.next?.minutes).toBe(1)
    expect(early.next?.day).toBe('danas')
  })

  it('still reads a window that runs past midnight as one shift', () => {
    // `end <= start` means the next day — the same reading `plannedHours()` in
    // `shared/dates.ts` gives it. A café that closes at 01:00 is one settings
    // change away.
    expect(shiftClock(LATE, '16:00').current?.name).toBe('Večernja')
    expect(shiftClock(LATE, '23:59').current?.name).toBe('Večernja')
    expect(shiftClock(LATE, '00:40').current?.name).toBe('Večernja')

    const after = shiftClock(LATE, '02:00')
    expect(after.current).toBeNull()
    expect(after.last?.window.name).toBe('Večernja')
    expect(after.last?.day).toBe('danas')
    expect(after.last?.minutes).toBe(60)
    expect(after.next?.window.name).toBe('Dnevna')
    expect(after.next?.day).toBe('danas')
  })

  it('counts the ordinal over the shifts that are worked, not the retired ones', () => {
    const retired = [
      template({ id: 'j', name: 'Jutarnja', start_time: '06:00', end_time: '07:00', sort: 0, active: false }),
      ...SERVIO,
    ]
    expect(shiftClock(retired, '18:00').current?.ordinal_bs).toBe('druga smjena')
  })

  it('reads the roster rather than two names written here', () => {
    const three = [
      template({ id: 'a', name: 'Jutarnja', start_time: '06:00', end_time: '12:00', sort: 1 }),
      template({ id: 'b', name: 'Popodnevna', start_time: '12:00', end_time: '18:00', sort: 2 }),
      template({ id: 'c', name: 'Noćna', start_time: '18:00', end_time: '02:00', sort: 3 }),
    ]
    expect(shiftClock(three, '13:00').current?.name).toBe('Popodnevna')
    expect(shiftClock(three, '20:00').current?.ordinal_bs).toBe('treća smjena')
  })

  it('answers nothing rather than guessing when there is nothing to read', () => {
    expect(shiftClock([], '18:00')).toEqual({ current: null, last: null, next: null })
    expect(shiftClock(SERVIO, '')).toEqual({ current: null, last: null, next: null })
    expect(shiftClock(SERVIO, 'nije vrijeme')).toEqual({ current: null, last: null, next: null })
    expect(shiftClock([template({ id: 'x', active: false })], '09:00').current).toBeNull()
  })

  it('keeps the minutes of a template that has any', () => {
    expect(shiftClock(
      [template({ id: 'x', start_time: '08:30', end_time: '16:30' })], '09:00',
    ).current?.hours).toBe('08:30–16:30')
  })
})

// ===========================================================================

describe('shiftWindowFor', () => {
  it('names a shift by the template that owned the minute it opened', () => {
    expect(shiftWindowFor(SERVIO, '07:02')?.name).toBe('Prva smjena')
    expect(shiftWindowFor(SERVIO, '15:04')?.name).toBe('Druga smjena')
  })

  it('keeps a night that ran over on the shift that was working it', () => {
    // 23:20 is outside both windows. The nearest edge is the evening's own end,
    // so the shift still being counted stays the evening's rather than becoming
    // tomorrow morning's.
    expect(shiftWindowFor(SERVIO, '23:20')?.name).toBe('Druga smjena')
    expect(shiftWindowFor(SERVIO, '02:30')?.name).toBe('Druga smjena')
    expect(shiftWindowFor(SERVIO, '06:30')?.name).toBe('Prva smjena')
  })

  it('answers nothing rather than guessing', () => {
    expect(shiftWindowFor([], '18:00')).toBeNull()
    expect(shiftWindowFor(SERVIO, 'nije vrijeme')).toBeNull()
  })
})

// ===========================================================================

describe('the words on a shift card', () => {
  it('says what the shift is doing in one or two words', () => {
    expect(shiftPillBs('open')).toBe('u toku')
    expect(shiftPillBs('closing')).toBe('zatvaranje')
    expect(shiftPillBs('closed')).toBe('zatvorena')
    expect(shiftPillBs('reviewed')).toBe('pregledana')
    expect(shiftPillBs(null)).toBe('nije otvarana')
  })

  it('counts down inside the hour and names the clock past it', () => {
    const night = shiftClock(SERVIO, '23:30')
    expect(shiftWhenBs(night.next!, 'next')).toBe('počinje sutra u 07:00')
    expect(shiftWhenBs(night.last!, 'last')).toBe('završena prije 30 min')

    const early = shiftClock(SERVIO, '06:40')
    expect(shiftWhenBs(early.next!, 'next')).toBe('počinje za 20 min')

    const small = shiftClock(SERVIO, '05:00')
    expect(shiftWhenBs(small.next!, 'next')).toBe('počinje danas u 07:00')
    expect(shiftWhenBs(small.last!, 'last')).toBe('završena jučer u 23:00')
  })
})

// ===========================================================================

describe('greetingBs', () => {
  it('greets the person by the name everybody calls him', () => {
    expect(greetingBs('07:30', 'Harun Mujić')).toBe('Dobro jutro, Harun')
    expect(greetingBs('13:00', 'Vedran')).toBe('Dobar dan, Vedran')
    expect(greetingBs('19:45', 'Emir Bešlija')).toBe('Dobro veče, Emir')
  })

  it('follows the café’s own clock across the whole day', () => {
    expect(greetingBs('04:59', 'Adin')).toBe('Dobro veče, Adin')
    expect(greetingBs('05:00', 'Adin')).toBe('Dobro jutro, Adin')
    expect(greetingBs('10:59', 'Adin')).toBe('Dobro jutro, Adin')
    expect(greetingBs('11:00', 'Adin')).toBe('Dobar dan, Adin')
    expect(greetingBs('17:59', 'Adin')).toBe('Dobar dan, Adin')
    expect(greetingBs('18:00', 'Adin')).toBe('Dobro veče, Adin')
    expect(greetingBs('23:59', 'Adin')).toBe('Dobro veče, Adin')
  })

  it('greets without a name, and without a time of day it cannot read', () => {
    expect(greetingBs('09:00')).toBe('Dobro jutro')
    expect(greetingBs('09:00', '  ')).toBe('Dobro jutro')
    expect(greetingBs('nije vrijeme', 'Harun')).toBe('Zdravo, Harun')
  })
})

// ===========================================================================

function line(patch: Partial<LineRow> & { name_snapshot: string }): LineRow {
  return {
    line_id: 'l1',
    at: '2026-09-12T18:00:00Z',
    arrived_at: '2026-09-12T18:00:00Z',
    sync_lag_s: 0,
    shift_seq: 1,
    table_name: 'Sto 3',
    note: null,
    flavour_names: [],
    qty: 1,
    charged_fen: 0,
    unit_price_fen: 0,
    status: 'naplaceno',
    late_sync: false,
    locked_by: 'u1',
    locked_by_name: 'Benza',
    ...patch,
  }
}

describe('what a shift sold', () => {
  it('folds the ledger’s lines into one row per article, most sold first', () => {
    const rows = soldRows([
      line({ name_snapshot: 'Kafa', qty: 2, charged_fen: 400 }),
      line({ name_snapshot: 'Nargila Love 66', qty: 1, charged_fen: 3500 }),
      line({ name_snapshot: 'Kafa', qty: 3, charged_fen: 600 }),
      line({ name_snapshot: 'Coca-Cola', qty: 3, charged_fen: 900, status: 'otvoreno' }),
    ])

    expect(rows.map(r => r.name)).toEqual(['Kafa', 'Coca-Cola', 'Nargila Love 66'])
    expect(rows[0]).toEqual({
      name: 'Kafa', qty: 5, fen: 1000, gratis_qty: 0, storno_qty: 0,
    })
    // An open tab's round has been sold; it just has not been paid for yet.
    expect(rows[1]!.qty).toBe(3)
    expect(rows[1]!.fen).toBe(900)
  })

  it('keeps an applied storno off the count and on its own mark', () => {
    const rows = soldRows([
      line({ name_snapshot: 'Kafa', qty: 1, charged_fen: 200 }),
      line({ name_snapshot: 'Kafa', qty: 2, charged_fen: 400, status: 'storno' }),
      line({ name_snapshot: 'Jägermeister', qty: 1, charged_fen: 500, status: 'storno' }),
    ])

    expect(rows[0]).toEqual({
      name: 'Kafa', qty: 1, fen: 200, gratis_qty: 0, storno_qty: 2,
    })
    // Every round of it was cancelled: the article stays on the screen, saying so,
    // rather than vanishing off a list that is meant to say what happened.
    const jager = rows.find(r => r.name === 'Jägermeister')!
    expect(jager.qty).toBe(0)
    expect(jager.storno_qty).toBe(1)
  })

  it('counts a storno nobody has decided yet as sold, because it still is', () => {
    const rows = soldRows([
      line({ name_snapshot: 'Kafa', qty: 1, charged_fen: 200, status: 'storno_na_cekanju' }),
    ])
    expect(rows[0]!.qty).toBe(1)
    expect(rows[0]!.fen).toBe(200)
    expect(rows[0]!.storno_qty).toBe(0)
  })

  it('counts a gratis round as sold and marks what it was worth in quantity', () => {
    const rows = soldRows([
      line({ name_snapshot: 'Coca-Cola', qty: 1, charged_fen: 250 }),
      line({ name_snapshot: 'Coca-Cola', qty: 1, charged_fen: 0, status: 'gratis' }),
    ])
    expect(rows[0]).toEqual({
      name: 'Coca-Cola', qty: 2, fen: 250, gratis_qty: 1, storno_qty: 0,
    })
  })

  it('folds by the name the line was locked under, not by a product id', () => {
    // A line snapshots the name and the price the guest was charged. Renaming the
    // product tomorrow cannot move what tonight says.
    const rows = soldRows([
      line({ name_snapshot: 'Kafa', qty: 1, charged_fen: 200 }),
      line({ name_snapshot: 'Espresso', qty: 1, charged_fen: 250 }),
    ])
    expect(rows).toHaveLength(2)
  })

  it('totals the counter, and counts only the articles that sold', () => {
    const rows = soldRows([
      line({ name_snapshot: 'Kafa', qty: 5, charged_fen: 1000 }),
      line({ name_snapshot: 'Coca-Cola', qty: 1, charged_fen: 0, status: 'gratis' }),
      line({ name_snapshot: 'Jägermeister', qty: 2, charged_fen: 1000, status: 'storno' }),
    ])

    expect(soldTotals(rows)).toEqual({
      products: 2, qty: 6, fen: 1000, gratis_qty: 1, storno_qty: 2,
    })
  })

  it('has nothing to say about a shift that has sold nothing', () => {
    expect(soldRows([])).toEqual([])
    expect(soldTotals([])).toEqual({
      products: 0, qty: 0, fen: 0, gratis_qty: 0, storno_qty: 0,
    })
  })
})

// ===========================================================================

function person(patch: Partial<LiveWho> & { user_id: string }): LiveWho {
  return {
    name: 'Harun',
    initials: 'H.M.',
    joined_at: null,
    promet_fen: 0,
    open_tabs: 0,
    settled: false,
    ...patch,
  }
}

describe('the shift’s own promet', () => {
  it('is the fold of who is on it — the identity the server refuses to break', () => {
    // `summarizeShift` throws SUMMARY_MISMATCH unless
    // `Σ by_user.promet_fen === promet_fen`, and `live.who` *is* that fold for
    // the shift Puls is looking at. So this is the shift's promet, not the
    // business day's — which on a day the first shift worked is a bigger number.
    expect(shiftPrometFen([
      person({ user_id: 'a', promet_fen: 125050 }),
      person({ user_id: 'b', promet_fen: 48000 }),
      person({ user_id: 'c', promet_fen: 0 }),
    ])).toBe(173050)
  })

  it('is zero for nobody, which is only ever drawn behind an open shift', () => {
    expect(shiftPrometFen([])).toBe(0)
  })
})

// ===========================================================================

function tableState(patch: Partial<TableState> & { table_id: string }): TableState {
  return {
    tab_id: null,
    tab_client_id: null,
    total_fen: 0,
    remaining_fen: 0,
    assigned_to: null,
    assigned_to_initials: null,
    opened_by_name: null,
    opened_at: null,
    last_order_at: null,
    pending_review: false,
    late_sync: false,
    offered_to: null,
    ...patch,
  }
}

function venueTable(patch: Partial<VenueTable> & { id: string }): VenueTable {
  return {
    name: 'Sto 1', zone: 'unutra', col: 1, row: 1, grp: null, sort: 1, ...patch,
  }
}

describe('floorZones', () => {
  const now = Date.parse('2026-09-11T22:00:00Z')

  /** Two runs along the walls, a VIP box under the second, and one in the garden. */
  const catalogue: VenueTable[] = [
    venueTable({ id: 'u1', name: 'Sto 1', col: 1, row: 1, sort: 1 }),
    venueTable({ id: 'u2', name: 'Sto 2', col: 1, row: 2, sort: 2 }),
    venueTable({ id: 'u3', name: 'Sto 3', col: 2, row: 1, sort: 3 }),
    venueTable({ id: 'v1', name: 'Sto 4', col: 2, row: 1, grp: 'vip', sort: 4 }),
    venueTable({ id: 'v2', name: 'Sto 5', col: 2, row: 2, grp: 'vip', sort: 5 }),
    venueTable({ id: 'b1', name: 'Sto 20', zone: 'basta', col: 1, row: 1, sort: 20 }),
  ]

  const states = catalogue.map(t => tableState({ table_id: t.id }))

  it('draws the room the way the catalogue’s coordinates say, Unutra first', () => {
    const zones = floorZones(states, catalogue, now)
    expect(zones.map(z => z.zone)).toEqual(['unutra', 'basta'])
    expect(zones[1]!.label).toBe('Bašta')

    const inside = zones[0]!
    expect(inside.columns.map(c => c.col)).toEqual([1, 2])
    expect(inside.columns[0]!.cells.map(c => c.name)).toEqual(['Sto 1', 'Sto 2'])
    // A grouped table is never in the column's own stack, or its coordinates
    // would collide with the run of tables along the wall.
    expect(inside.columns[1]!.cells.map(c => c.name)).toEqual(['Sto 3'])
    expect(inside.columns[1]!.groups).toHaveLength(1)
    expect(inside.columns[1]!.groups[0]!.name).toBe('vip')
    expect(inside.columns[1]!.groups[0]!.cells.map(c => c.name)).toEqual(['Sto 4', 'Sto 5'])
  })

  it('says "7" on the tile and keeps "Sto 7" for the sheet’s title', () => {
    const cell = floorZones(states, catalogue, now)[0]!.columns[0]!.cells[0]!
    expect(cell.label).toBe('1')
    expect(cell.name).toBe('Sto 1')
  })

  it('joins the live row to the catalogue and keeps the age in words', () => {
    // The tile no longer prints the age — the plan has one colour for every
    // occupied table — but the sheet and the accessible name still say it.
    const zones = floorZones([
      ...states.filter(s => s.table_id !== 'u2'),
      tableState({
        table_id: 'u2',
        tab_id: 'tab-1',
        remaining_fen: 2450,
        assigned_to_initials: 'A.H.',
        opened_at: new Date(now - 100 * 60_000).toISOString(),
      }),
    ], catalogue, now)

    const cell = zones[0]!.columns[0]!.cells[1]!
    expect(cell.name).toBe('Sto 2')
    expect(cell.tab_id).toBe('tab-1')
    expect(cell.age).toBe('1 h 40')
    expect(cell.waiter).toBe('A.H.')
    expect(cell.remaining_fen).toBe(2450)
  })

  it('counts what is busy in each half of the room, boxed tables included', () => {
    const zones = floorZones([
      ...states.filter(s => s.table_id !== 'u1' && s.table_id !== 'v1'),
      tableState({ table_id: 'u1', tab_id: 't1', opened_at: new Date(now).toISOString() }),
      tableState({ table_id: 'v1', tab_id: 't2', opened_at: new Date(now).toISOString() }),
    ], catalogue, now)

    expect(zones[0]!.total).toBe(5)
    expect(zones[0]!.busy).toBe(2)
    expect(zones[1]!.total).toBe(1)
    expect(zones[1]!.busy).toBe(0)
  })

  it('draws a table the live read is silent about as free — a room has no holes', () => {
    const zones = floorZones([], catalogue, now)
    expect(zones[0]!.total).toBe(5)
    expect(zones[0]!.busy).toBe(0)
    expect(zones[0]!.columns[0]!.cells[0]!.tab_id).toBeNull()
    expect(zones[0]!.columns[0]!.cells[0]!.age).toBe('')
  })

  it('names the two zones the way the room does', () => {
    expect(zoneLabel('unutra')).toBe('Unutra')
    expect(zoneLabel('basta')).toBe('Bašta')
  })
})

// ===========================================================================

describe('the Bosnian words', () => {
  it('names a business day’s weekday without pushing it through a timezone', () => {
    expect(weekdayBs('2026-09-11')).toBe('pet')
    expect(weekdayBs('2026-09-12')).toBe('sub')
    expect(weekdayBs('2026-09-13')).toBe('ned')
    expect(weekdayBs('not-a-date')).toBe('')
  })
})

// ===========================================================================

/**
 * `admin-ui.test.ts` walks `app/components/ui` and `app/pages/admin` for the two
 * house rules; *Puls*' own components live in a third folder, so they get the
 * same two checks here rather than escaping them by being somewhere else.
 */
describe('the Puls components keep the house rules', () => {
  const files = [
    ...readdirSync('app/components/puls').map(name => join('app/components/puls', name)),
    'app/utils/puls.ts',
  ]

  it('writes no hex value — the palette is one file', () => {
    const offenders: string[] = []
    for (const path of files) {
      readFileSync(path, 'utf8').split('\n').forEach((row, i) => {
        if (/#[0-9a-fA-F]{3,8}\b/.test(row)) offenders.push(`${path}:${i + 1} ${row.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('has no emoji anywhere', () => {
    const emoji = /\p{Extended_Pictographic}/u
    expect(files.filter(path => emoji.test(readFileSync(path, 'utf8')))).toEqual([])
  })
})
