/**
 * *Raspored*'s labels and the one turn its screens make on the server's answer.
 *
 * There is no DOM here (`environment: 'node'`), deliberately: mounting a
 * component to assert a label tests Vue, not Šank. What is worth a test is what
 * a rendering cannot catch —
 *
 * - a **wrong label is a wrong shift on somebody's phone**: "16–01" has to mean
 *   16:00 to 01:00, and weekday 1 has to be *Ponedjeljak* on every screen;
 * - **`patternCells()` is the one place** the server's flat entries become the
 *   owner's weekday × shift grid, so the laptop, the phone and S17 can never
 *   disagree about which name is in which cell — and a full cell has no `+`;
 * - **no dates on Raspored**: the owner's rule is one weekly pattern, so no
 *   screen this package owns may bring back a date, a week arrow or *Objavi*;
 * - and the house rules: no emoji, no hex.
 *
 * **Assertions that moved (0010).** The dated helpers (`weekCells`,
 * `alreadyThatDay`, `myShifts`, `weekRangeBs`, `dayLabelBs`, `STATUS_BS`, the
 * *Sati* month helpers) are gone with the dated roster; their replacements are
 * asserted below with the same intent — cell placement, the picker's tag, my own
 * shifts — on weekdays instead of dates.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { weekdayLongBs, weekdayShortBs } from '../../shared/dates'
import {
  ROSTER_HINT_BS, alreadyThatWeekday, dayCells, myPatternShifts, patternCells, timeSpanBs,
} from '../../app/composables/useRoster'
import type { PatternEntry, RosterPatternView, ShiftTemplateView } from '../../shared/types'

const PRVA: ShiftTemplateView = {
  id: 't-prva', name: 'Prva smjena', start_time: '07:00', end_time: '15:00', sort: 0, active: true,
}
const DRUGA: ShiftTemplateView = {
  id: 't-druga', name: 'Druga smjena', start_time: '15:00', end_time: '23:00', sort: 1, active: true,
}

function entry(patch: Partial<PatternEntry> & { user_id: string }): PatternEntry {
  return {
    id: `p-${patch.user_id}-${patch.weekday ?? 5}-${patch.template_id ?? DRUGA.id}`,
    weekday: 5,
    template_id: DRUGA.id,
    user_name: patch.user_id,
    user_initials: patch.user_id.slice(0, 2).toUpperCase(),
    ...patch,
  }
}

function view(entries: PatternEntry[], templates = [PRVA, DRUGA]): RosterPatternView {
  return { templates, entries, max_per_shift: 2 }
}

// ===========================================================================

describe('the labels', () => {
  it('drops the :00 from a whole hour and keeps a real one', () => {
    expect(timeSpanBs('16:00', '01:00')).toBe('16–01')
    expect(timeSpanBs('08:30', '16:00')).toBe('08:30–16')
  })

  it('names the seven weekdays Monday first, ijekavian', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(weekdayShortBs))
      .toEqual(['pon', 'uto', 'sri', 'čet', 'pet', 'sub', 'ned'])
    expect([1, 2, 3, 4, 5, 6, 7].map(weekdayLongBs))
      .toEqual(['Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota', 'Nedjelja'])
  })

  it('says how the plan works in one sentence', () => {
    expect(ROSTER_HINT_BS)
      .toBe('Raspored važi svake sedmice dok ga ne promijeniš. Najviše dvije osobe po smjeni.')
  })
})

// ===========================================================================

describe('patternCells', () => {
  const amar = entry({ user_id: 'amar' })
  const lejla = entry({ user_id: 'lejla' })
  const emir = entry({ user_id: 'emir', template_id: PRVA.id, weekday: 1 })
  const cells = patternCells(view([amar, lejla, emir]))

  it('turns entries into templates × seven weekdays, in template order', () => {
    expect(cells).toHaveLength(2)
    expect(cells[0]).toHaveLength(7)
    expect(cells[0]!.map(c => c.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(cells[0]![0]!.template.id).toBe(PRVA.id)
    expect(cells[1]![0]!.template.id).toBe(DRUGA.id)
  })

  it('puts a person in the cell of his own weekday and template and nowhere else', () => {
    expect(cells[0]![0]!.people.map(p => p.user_id)).toEqual(['emir'])
    expect(cells[1]![4]!.people.map(p => p.user_id)).toEqual(['amar', 'lejla'])
    expect(cells.flat().reduce((n, c) => n + c.people.length, 0)).toBe(3)
  })

  it('marks a cell full at two, so its + is not drawn', () => {
    expect(cells[1]![4]!.full).toBe(true)
    expect(cells[0]![0]!.full).toBe(false)
    expect(cells[1]![3]!.full).toBe(false)
  })

  it('draws no cell for a switched-off template', () => {
    const only = patternCells(view([amar, emir], [DRUGA]))
    expect(only).toHaveLength(1)
    expect(only.flat().flatMap(c => c.people).map(p => p.user_id)).toEqual(['amar'])
  })

  it('gives the phone panel the same cells for one weekday', () => {
    expect(dayCells(view([amar, lejla, emir]), 5).map(c => [c.template.name, c.people.length]))
      .toEqual([['Prva smjena', 0], ['Druga smjena', 2]])
  })
})

describe('alreadyThatWeekday', () => {
  it('names the shift each person already works that weekday — the picker tags, not hides', () => {
    const busy = alreadyThatWeekday(view([
      entry({ user_id: 'emir', template_id: PRVA.id }),
      entry({ user_id: 'amar', weekday: 6 }),
    ]), 5)
    expect(busy.get('emir')).toBe('Prva smjena')
    expect(busy.has('amar')).toBe(false)
  })
})

describe('myPatternShifts', () => {
  it('is mine and only mine, and not on a switched-off shift', () => {
    const v = view([
      entry({ user_id: 'amar', weekday: 1 }),
      entry({ user_id: 'amar', weekday: 3, template_id: 't-gone' }),
      entry({ user_id: 'dino', weekday: 2 }),
    ])
    expect(myPatternShifts(v, 'amar').map(e => e.weekday)).toEqual([1])
  })
})

// ===========================================================================

/** Every file this package owns. */
function rosterFiles(): string[] {
  const roots = [
    'app/components/raspored', 'app/pages/admin/raspored',
    'app/pages/konobar/raspored', 'app/pages/sanker/raspored',
  ]
  const found = ['app/composables/useRoster.ts']

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
   * "Ne trebaju nam datumi za raspored." The dated screens' furniture — the
   * date helpers, the week query, publishing and drafts — must not come back.
   */
  it('no dates, no week steps, nothing to publish', () => {
    const banned = [
      'shortDateBs', 'weekRangeBs', 'dayLabelBs', 'weekStart', 'work_date',
      'Objavi raspored', 'nacrt', 'Sljedeća sedmica', 'važi od',
    ]
    const offenders: string[] = []
    for (const path of rosterFiles()) {
      const text = readFileSync(path, 'utf8')
      for (const word of banned) if (text.includes(word)) offenders.push(`${path}: ${word}`)
    }
    expect(offenders).toEqual([])
  })

  it('flips the two nav rows this package owns and nothing else', () => {
    const waiterMenu = readFileSync('app/utils/waiterMenu.ts', 'utf8')
    expect(waiterMenu).toMatch(/id: 'roster'[^\n]*ready: true/)
    expect(waiterMenu).not.toMatch(/id: 'chat'/)

    const adminNav = readFileSync('app/utils/adminNav.ts', 'utf8')
    expect(adminNav).toMatch(/id: 'raspored'[^\n]*ready: true/)
    expect(adminNav).not.toMatch(/id: 'razgovor'/)
  })

  it('Razgovor is gone from every screen: no dock, no pages', () => {
    expect(readFileSync('app/layouts/admin.vue', 'utf8')).not.toContain('ChatDock')
    expect(existsSync('app/components/chat')).toBe(false)
    expect(existsSync('app/pages/admin/razgovor')).toBe(false)
    expect(existsSync('app/pages/konobar/razgovor')).toBe(false)
    expect(existsSync('app/pages/sanker/razgovor')).toBe(false)
  })
})
