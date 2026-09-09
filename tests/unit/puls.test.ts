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
 * - **the age bands.** A table crossing an hour has to turn amber at an hour,
 *   not at fifty-nine minutes and not at sixty-one.
 * - **the feed's arithmetic.** `charged_fen` is append-only and never rewritten,
 *   so a storno has to be *made* negative on the way to the screen.
 * - **the Bosnian counting words**, which go in threes and trip on the teens.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LineRow, TableState, VenueTable } from '../../shared/types'
import {
  NOTE_MIN,
  decisionBody,
  decisionNeedsNote,
  feedAmountFen,
  feedMark,
  feedTitle,
  feedTone,
  groupTablesByZone,
  shiftLineBs,
  stolovaBs,
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

describe('groupTablesByZone', () => {
  const now = Date.parse('2026-09-11T22:00:00Z')

  const catalogue: VenueTable[] = [
    venueTable({ id: 'b1', name: 'Sto 20', zone: 'basta', sort: 20 }),
    venueTable({ id: 'u2', name: 'Sto 2', zone: 'unutra', sort: 2 }),
    venueTable({ id: 'u1', name: 'Sto 1', zone: 'unutra', sort: 1 }),
  ]

  it('puts Unutra before Bašta and sorts inside each by the catalogue order', () => {
    const groups = groupTablesByZone(
      [tableState({ table_id: 'u1' }), tableState({ table_id: 'u2' }), tableState({ table_id: 'b1' })],
      catalogue,
      now,
    )
    expect(groups.map(g => g.zone)).toEqual(['unutra', 'basta'])
    expect(groups[0]!.tiles.map(t => t.name)).toEqual(['Sto 1', 'Sto 2'])
    expect(groups[1]!.label).toBe('Bašta')
  })

  it('joins the live row to the catalogue name and writes the age in words', () => {
    const groups = groupTablesByZone([
      tableState({
        table_id: 'u2',
        tab_id: 'tab-1',
        remaining_fen: 2450,
        assigned_to_initials: 'A.H.',
        opened_at: new Date(now - 100 * 60_000).toISOString(),
      }),
    ], catalogue, now)

    const tile = groups[0]!.tiles[0]!
    expect(tile.name).toBe('Sto 2')
    expect(tile.tone).toBe('warm')
    expect(tile.age).toBe('1 h 40')
    expect(tile.waiter).toBe('A.H.')
    expect(tile.remaining_fen).toBe(2450)
  })

  it('drops a live row the catalogue does not name rather than drawing it blank', () => {
    const groups = groupTablesByZone([tableState({ table_id: 'ghost' })], catalogue, now)
    expect(groups).toEqual([])
  })

  it('names the two zones the way the room does', () => {
    expect(zoneLabel('unutra')).toBe('Unutra')
    expect(zoneLabel('basta')).toBe('Bašta')
  })
})

// ===========================================================================

function line(patch: Partial<LineRow>): LineRow {
  return {
    line_id: 'l1',
    at: '2026-09-11T20:41:00Z',
    arrived_at: '2026-09-11T20:41:00Z',
    sync_lag_s: 0,
    shift_seq: 3,
    table_name: 'Sto 9',
    name_snapshot: 'Kafa',
    note: null,
    flavour_names: [],
    qty: 1,
    charged_fen: 1200,
    unit_price_fen: 1200,
    status: 'naplaceno',
    late_sync: false,
    locked_by: 'u1',
    locked_by_name: 'Dino',
    ...patch,
  }
}

describe('the feed', () => {
  it('reads a storno as money coming back off the night', () => {
    expect(feedTone('storno')).toBe('void')
    expect(feedTone('storno_na_cekanju')).toBe('void')
    expect(feedAmountFen(line({ status: 'storno' }))).toBe(-1200)
  })

  it('leaves a gratis positive but marks it amber', () => {
    expect(feedTone('gratis')).toBe('comp')
    expect(feedAmountFen(line({ status: 'gratis' }))).toBe(1200)
  })

  it('always says the status in a word as well as in a colour', () => {
    expect(feedMark(line({ status: 'storno' }))).toBe('storno')
    expect(feedMark(line({ status: 'storno_na_cekanju' }))).toBe('storno na čekanju')
    expect(feedMark(line({ status: 'gratis' }))).toBe('gratis')
    expect(feedMark(line({ status: 'nije_placeno' }))).toBe('nije plaćeno')
    expect(feedMark(line({ status: 'naplaceno' }))).toBe('')
  })

  it('writes the table, the quantity and a nargila’s flavours', () => {
    expect(feedTitle(line({}))).toBe('Sto 9 · Kafa')
    expect(feedTitle(line({ qty: 2 }))).toBe('Sto 9 · 2× Kafa')
    expect(feedTitle(line({
      name_snapshot: 'Nargila', flavour_names: ['Jabuka', 'Menta'],
    }))).toBe('Sto 9 · Nargila (Jabuka + Menta)')
  })
})

// ===========================================================================

describe('the Bosnian words', () => {
  it('counts tables in threes and does not trip on the teens', () => {
    expect(stolovaBs(1)).toBe('sto')
    expect(stolovaBs(2)).toBe('stola')
    expect(stolovaBs(4)).toBe('stola')
    expect(stolovaBs(5)).toBe('stolova')
    expect(stolovaBs(0)).toBe('stolova')
    expect(stolovaBs(11)).toBe('stolova')
    expect(stolovaBs(12)).toBe('stolova')
    expect(stolovaBs(21)).toBe('sto')
    expect(stolovaBs(22)).toBe('stola')
  })

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
 * `admin-ui.test.ts` walks `app/components/ui` and `app/pages/a` for the two
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
