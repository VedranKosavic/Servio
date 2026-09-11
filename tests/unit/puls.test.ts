/**
 * *Puls* — the logic a rendering cannot catch.
 *
 * There is no DOM here (`environment: 'node'`), the same as `admin-ui.test.ts`:
 * mounting a component to assert that a button says "Odobri" tests Vue, not
 * Šank. What is worth a test is the handful of pure functions behind the page,
 * because each of them is a way to be quietly and expensively wrong:
 *
 * - **the decide bodies.** Three routes, three different vocabularies, and one
 *   of them (`otpis` / `naplatiti`) inverts if you read *Odobri* as approving
 *   the money rather than approving the waiter's request. A wrong body here is
 *   a 400 at best and the opposite decision at worst.
 * - **which shift it is.** The screen names the shift out of the roster's
 *   templates, and the windows do not cover the whole day — a night still being
 *   counted at 02:30 has to stay *Večernja* and not become tomorrow's *Dnevna*.
 * - **the shift's promet.** It is the fold of `live.who`, not the business
 *   day's total, and on a day the *Dnevna* worked those are different numbers.
 * - **the age bands.** A table crossing an hour has to turn amber at an hour,
 *   not at fifty-nine minutes and not at sixty-one.
 * - **the room's geometry**, which is the catalogue's col/row and never this
 *   code's.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  LiveWho, ShiftTemplateView, TableState, VenueTable,
} from '../../shared/types'
import {
  NOTE_MIN,
  decisionBody,
  decisionNeedsNote,
  floorZones,
  shiftLineBs,
  shiftNaming,
  shiftPrometFen,
  tableTone,
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
    name: 'Dnevna', start_time: '08:00', end_time: '16:00', sort: 1, active: true, ...patch,
  }
}

/** The café's own two, as `db:roster` writes them. */
const SERVIO: ShiftTemplateView[] = [
  template({ id: 'd', name: 'Dnevna', start_time: '08:00', end_time: '16:00', sort: 1 }),
  template({ id: 'v', name: 'Večernja', start_time: '16:00', end_time: '01:00', sort: 2 }),
]

describe('shiftNaming', () => {
  it('names the shift the owner is in, and numbers it the way he asks', () => {
    expect(shiftNaming(SERVIO, '09:30')).toEqual({
      name: 'Dnevna', index: 1, ordinal_bs: 'prva smjena', hours: '08–16',
    })
    expect(shiftNaming(SERVIO, '18:05')).toEqual({
      name: 'Večernja', index: 2, ordinal_bs: 'druga smjena', hours: '16–01',
    })
  })

  it('reads a window that runs past midnight as one shift', () => {
    // Večernja is 16:00–01:00, so `end <= start` means the next day — the same
    // reading `plannedHours()` gives it.
    expect(shiftNaming(SERVIO, '16:00')!.name).toBe('Večernja')
    expect(shiftNaming(SERVIO, '23:59')!.name).toBe('Večernja')
    expect(shiftNaming(SERVIO, '00:40')!.name).toBe('Večernja')
    expect(shiftNaming(SERVIO, '15:59')!.name).toBe('Dnevna')
  })

  it('keeps a late night on the evening shift, where no window reaches', () => {
    // 01:00–08:00 belongs to no template at all, and that gap is exactly when a
    // long night is still being counted. The nearest edge is Večernja's own
    // end, so 02:30 stays the evening's rather than becoming tomorrow morning's.
    expect(shiftNaming(SERVIO, '01:30')!.name).toBe('Večernja')
    expect(shiftNaming(SERVIO, '02:30')!.name).toBe('Večernja')
  })

  it('hands the small hours over to the morning as the morning gets nearer', () => {
    expect(shiftNaming(SERVIO, '06:00')!.name).toBe('Dnevna')
    expect(shiftNaming(SERVIO, '07:45')!.name).toBe('Dnevna')
  })

  it('counts the ordinal over the shifts that are worked, not the retired ones', () => {
    const retired = [
      template({ id: 'd', name: 'Jutarnja', start_time: '06:00', end_time: '08:00', sort: 0, active: false }),
      ...SERVIO,
    ]
    expect(shiftNaming(retired, '18:00')).toEqual({
      name: 'Večernja', index: 2, ordinal_bs: 'druga smjena', hours: '16–01',
    })
  })

  it('reads the roster rather than two names written here', () => {
    const three = [
      template({ id: 'a', name: 'Jutarnja', start_time: '06:00', end_time: '12:00', sort: 1 }),
      template({ id: 'b', name: 'Popodnevna', start_time: '12:00', end_time: '18:00', sort: 2 }),
      template({ id: 'c', name: 'Noćna', start_time: '18:00', end_time: '02:00', sort: 3 }),
    ]
    expect(shiftNaming(three, '13:00')).toEqual({
      name: 'Popodnevna', index: 2, ordinal_bs: 'druga smjena', hours: '12–18',
    })
    expect(shiftNaming(three, '20:00')!.ordinal_bs).toBe('treća smjena')
  })

  it('answers nothing rather than guessing when there is nothing to read', () => {
    expect(shiftNaming([], '18:00')).toBeNull()
    expect(shiftNaming(SERVIO, '')).toBeNull()
    expect(shiftNaming(SERVIO, 'nije vrijeme')).toBeNull()
    expect(shiftNaming([template({ id: 'x', active: false })], '09:00')).toBeNull()
  })

  it('keeps the minutes of a template that has any', () => {
    expect(shiftNaming(
      [template({ id: 'x', start_time: '08:30', end_time: '16:30' })], '09:00',
    )!.hours).toBe('08:30–16:30')
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
    // business day's — which on a day the Dnevna worked is a bigger number.
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

describe('tableTone', () => {
  const now = Date.parse('2026-09-11T22:00:00Z')
  const ago = (minutes: number) =>
    new Date(now - minutes * 60_000).toISOString()

  it('has no colour for a table nobody is sitting at', () => {
    expect(tableTone(null, now)).toBe('free')
  })

  it('turns at exactly one hour and exactly three', () => {
    expect(tableTone(ago(59), now)).toBe('fresh')
    expect(tableTone(ago(60), now)).toBe('warm')
    expect(tableTone(ago(179), now)).toBe('warm')
    expect(tableTone(ago(180), now)).toBe('old')
    expect(tableTone(ago(400), now)).toBe('old')
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

  it('joins the live row to the catalogue and writes the age in words', () => {
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
    expect(cell.tone).toBe('warm')
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
    expect(zones[0]!.columns[0]!.cells[0]!.tone).toBe('free')
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

  it('says what the shift is doing, and says so when there is none', () => {
    expect(shiftLineBs('open', null)).toBe('smjena otvorena')
    expect(shiftLineBs('closing', 'Emir')).toBe('zatvaranje · Emir')
    expect(shiftLineBs('closed', null)).toBe('smjena zatvorena')
    expect(shiftLineBs(null, null)).toBe('nema otvorene smjene')
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
