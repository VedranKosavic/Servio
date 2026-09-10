/**
 * *Raspored*'s labels and the one turn its screens make on the server's answer.
 *
 * There is no DOM here (`environment: 'node'`), deliberately: mounting a
 * component to assert that a button says "Objavi raspored" tests Vue, not Šank.
 * What is worth a test is what a rendering cannot catch —
 *
 * - a **wrong label is a wrong shift on somebody's phone**: "16–01" has to mean
 *   16:00 to 01:00 on every screen, and *14.09.–20.09.* has to be the Monday's
 *   own week and not the calendar week the laptop happens to be in;
 * - **`weekCells()` is the one place** the server's day-first answer becomes the
 *   owner's template-first grid, so the laptop grid and the phone cards can
 *   never disagree about which chip belongs in which cell. A `swapped` row
 *   leaking back into a cell would show the giver still working a shift he
 *   handed over;
 * - and the house rules: no emoji anywhere under the screens this package owns.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HOURS_NOTE_BS, STATUS_BS, SWAP_STATUS_BS,
  alreadyThatDay, dayLabelBs, hoursBs, hoursEmpty, lateBs, monthBs, myShifts,
  shiftMonth, templateSpanBs, timeSpanBs, weekCells, weekRangeBs,
} from '../../app/composables/useRoster'
import type { Assignment, HoursRow, RosterWeekView, ShiftTemplateView } from '../../shared/types'

const VECERNJA: ShiftTemplateView = {
  id: 't-vecernja', name: 'Večernja', start_time: '16:00', end_time: '01:00', sort: 1, active: true,
}
const DNEVNA: ShiftTemplateView = {
  id: 't-dnevna', name: 'Dnevna', start_time: '08:00', end_time: '16:00', sort: 0, active: true,
}

function person(patch: Partial<Assignment>): Assignment {
  return {
    id: `a-${patch.user_id ?? 'x'}-${patch.template_id ?? 't'}-${patch.work_date ?? 'd'}`,
    work_date: '2026-09-14',
    template_id: VECERNJA.id,
    template_name: VECERNJA.name,
    start_time: VECERNJA.start_time,
    end_time: VECERNJA.end_time,
    user_id: 'u-amar',
    user_name: 'Amar',
    user_initials: 'AM',
    status: 'planned',
    origin: 'owner',
    swap_pending: false,
    ...patch,
  }
}

/** A published week with two templates and whatever rows a test needs. */
function week(rows: Assignment[], templates = [DNEVNA, VECERNJA]): RosterWeekView {
  const monday = '2026-09-14'
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = `2026-09-${String(14 + i).padStart(2, '0')}`
    return { work_date: date, assignments: rows.filter(r => r.work_date === date) }
  })
  return {
    week_start: monday,
    published_at: '2026-09-12T09:00:00Z',
    published_by_name: 'Haris',
    days,
    templates,
  }
}

// ===========================================================================

describe('the labels', () => {
  it('drops the :00 from a whole hour and keeps a real one', () => {
    expect(timeSpanBs('16:00', '01:00')).toBe('16–01')
    expect(timeSpanBs('08:30', '16:00')).toBe('08:30–16')
    expect(timeSpanBs('22:00', '06:00')).toBe('22–06')
  })

  it('writes a week as its own seven days, Monday to Sunday', () => {
    expect(weekRangeBs('2026-09-14')).toBe('14.09.–20.09.')
    // The one that crosses a month, which is where an off-by-one shows up.
    expect(weekRangeBs('2026-09-28')).toBe('28.09.–04.10.')
  })

  it('writes a day the way a person says it', () => {
    expect(dayLabelBs('2026-09-14')).toBe('pon 14.09.')
    expect(dayLabelBs('2026-09-18')).toBe('pet 18.09.')
  })

  it('writes hours with a comma and never a trailing zero', () => {
    expect(hoursBs(9)).toBe('9 h')
    expect(hoursBs(8.5)).toBe('8,5 h')
    expect(hoursBs(0)).toBe('0 h')
  })

  it('says nothing at all when nobody was late', () => {
    expect(lateBs(40)).toBe('+40 min')
    expect(lateBs(0)).toBe('')
  })

  it('names every status and every swap status in Bosnian', () => {
    expect(Object.values(STATUS_BS)).toEqual(
      ['planirano', 'zamijenjeno', 'bolestan', 'nije došao', 'uklonjeno'],
    )
    expect(Object.values(SWAP_STATUS_BS)).toEqual(
      ['čeka', 'preuzeta', 'odbijena', 'povučena'],
    )
  })

  it('steps a month without a Date, across both year boundaries', () => {
    expect(shiftMonth('2026-09', -1)).toBe('2026-08')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(monthBs('2026-09')).toBe('septembar 2026.')
  })
})

// ===========================================================================

describe('templateSpanBs', () => {
  /**
   * A template edited after a week was published leaves the rows on the hours
   * they were written with — a price at lock, not a live lookup. The grid says
   * both numbers rather than quietly picking one.
   */
  it('spells out a row left on the old hours', () => {
    const stale = person({ start_time: '15:00', end_time: '00:00' })
    expect(templateSpanBs(VECERNJA, [stale])).toBe('16–01 (staro 15–00)')
  })

  it('says the plain span when nothing drifted', () => {
    expect(templateSpanBs(VECERNJA, [person({})])).toBe('16–01')
    expect(templateSpanBs(VECERNJA, [])).toBe('16–01')
  })
})

// ===========================================================================

describe('weekCells', () => {
  const amar = person({ user_id: 'u-amar', user_name: 'Amar' })
  const dino = person({ user_id: 'u-dino', user_name: 'Dino', status: 'swapped' })
  const lejla = person({ user_id: 'u-lejla', user_name: 'Lejla', status: 'removed' })
  const emir = person({
    user_id: 'u-emir', user_name: 'Emir', template_id: DNEVNA.id, template_name: DNEVNA.name,
    start_time: DNEVNA.start_time, end_time: DNEVNA.end_time,
  })

  const rows = weekCells(week([amar, dino, lejla, emir]))

  it('turns days into templates × days, in template order', () => {
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveLength(7)
    expect(rows[0]![0]!.template.id).toBe(DNEVNA.id)
    expect(rows[1]![0]!.template.id).toBe(VECERNJA.id)
  })

  it('keeps a swapped giver out of the cell — he handed the shift over', () => {
    const monday = rows[1]![0]!
    expect(monday.people.map(p => p.user_id)).toEqual(['u-amar'])
  })

  it('folds a removed row away rather than dropping it', () => {
    const monday = rows[1]![0]!
    expect(monday.removed.map(p => p.user_id)).toEqual(['u-lejla'])
  })

  it('puts a person in the cell of his own template and nowhere else', () => {
    expect(rows[0]![0]!.people.map(p => p.user_id)).toEqual(['u-emir'])
  })
})

describe('alreadyThatDay', () => {
  /** The picker tags a name rather than hiding it: the owner may mean it. */
  it('names the template each person already works that day', () => {
    const w = week([
      person({ user_id: 'u-emir', template_id: DNEVNA.id, template_name: 'Dnevna' }),
      person({ user_id: 'u-lejla', status: 'removed' }),
    ])
    const busy = alreadyThatDay(w, '2026-09-14')
    expect(busy.get('u-emir')).toBe('Dnevna')
    // A removed row is not somebody working that day.
    expect(busy.has('u-lejla')).toBe(false)
  })
})

describe('myShifts', () => {
  it('is mine and only mine, in day order', () => {
    const w = week([
      person({ work_date: '2026-09-16', user_id: 'u-amar' }),
      person({ work_date: '2026-09-14', user_id: 'u-amar' }),
      person({ work_date: '2026-09-15', user_id: 'u-dino' }),
    ])
    expect(myShifts(w, 'u-amar').map(a => a.work_date))
      .toEqual(['2026-09-14', '2026-09-16'])
  })
})

// ===========================================================================

describe('Sati', () => {
  function hours(patch: Partial<HoursRow>): HoursRow {
    return {
      user_id: 'u-amar',
      user_name: 'Amar',
      planned_shifts: 0,
      planned_h: 0,
      worked_h: 0,
      late_min: 0,
      early_leave_min: 0,
      sick_days: 0,
      absent_days: 0,
      swaps_given: 0,
      swaps_taken: 0,
      no_shift_rows: 0,
      unplanned_rows: 0,
      days: [],
      ...patch,
    }
  }

  it('calls a month empty only when nothing was planned and nothing worked', () => {
    expect(hoursEmpty([hours({})])).toBe(true)
    expect(hoursEmpty([hours({ planned_shifts: 1 })])).toBe(false)
    expect(hoursEmpty([hours({ worked_h: 6 })])).toBe(false)
    // The person who was there and is not on the plan is not "nothing".
    expect(hoursEmpty([hours({ unplanned_rows: 1 })])).toBe(false)
  })

  it('names the two rows that are not shifts, verbatim', () => {
    expect(HOURS_NOTE_BS.unplanned).toBe('radio bez rasporeda')
    expect(HOURS_NOTE_BS.noShift).toBe('planirano, nema smjene')
  })
})

// ===========================================================================

/** Every file this package owns. */
function rosterFiles(): string[] {
  const roots = [
    'app/components/raspored', 'app/pages/a/raspored',
    'app/pages/k/raspored', 'app/pages/s/raspored',
  ]
  const found = ['app/composables/useRoster.ts', 'app/pages/a/postavke/sabloni.vue']

  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (path.endsWith('.vue') || path.endsWith('.ts')) found.push(path)
    }
  }

  for (const root of roots) walk(root)
  return found
}

describe('the house rules hold on the roster screens', () => {
  /** `CLAUDE.md`: no emoji in a label, a log title or a commit message. */
  it('no emoji anywhere', () => {
    const emoji = /\p{Extended_Pictographic}/u
    expect(rosterFiles().filter(p => emoji.test(readFileSync(p, 'utf8')))).toEqual([])
  })

  /**
   * The two themes never meet. `/a` reads its palette from
   * `[data-theme='light']` and `/k` from `main.css`; a hex in either is a colour
   * nobody can change from the palette file.
   */
  it('no file writes a hex value', () => {
    const offenders: string[] = []
    for (const path of rosterFiles()) {
      readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
        if (/#[0-9a-fA-F]{3,8}\b/.test(line)) offenders.push(`${path}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })

  /**
   * *Raspored* is reachable, and reachable is a boolean in two registries — the
   * whole reason WP0 wrote both files on day one.
   */
  it('flips the two nav rows this package owns and nothing else', () => {
    const waiterMenu = readFileSync('app/utils/waiterMenu.ts', 'utf8')
    expect(waiterMenu).toMatch(/id: 'roster'[^\n]*ready: true/)
    // WP1's row was not this package's to flip; it is `true` on `main` because
    // Razgovor merged first, and both rows are live from here on.
    expect(waiterMenu).toMatch(/id: 'chat'[^\n]*ready: true/)

    const adminNav = readFileSync('app/utils/adminNav.ts', 'utf8')
    expect(adminNav).toMatch(/id: 'raspored'[^\n]*ready: true/)
    expect(adminNav).toMatch(/id: 'razgovor'[^\n]*ready: true/)
  })
})
