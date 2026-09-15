/**
 * *Raspored* — the labels and the one turn its screens make on the server's
 * answer.
 *
 * **One weekly pattern, no dates** (owner, 2026-09-15: "Ne trebaju nam datumi
 * za raspored, samo nam treba da dodamo po danima maksimalno 2 osobe po smjeni i
 * taj raspored ostaje zauvijek"). A cell is a weekday (ISO, pon = 1 … ned = 7)
 * × a shift template, with at most `max_per_shift` people in it.
 *
 * Everything here is a **pure function of its arguments**: no `ref`, no
 * `fetch`, no clock. That is what lets `tests/unit/raspored-ui.test.ts` import
 * this file in a plain Node process and assert that "16:00"–"01:00" reads
 * *16–01* and that a cell with two people has no `+`.
 */
import { WEEKDAYS } from '#shared/dates'
import type { PatternEntry, RosterPatternView, ShiftTemplateView } from '#shared/types'

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * `"16:00","01:00"` → `"16–01"`, `"08:30","16:00"` → `"08:30–16"`.
 *
 * A whole hour loses its `:00`, because a grid of *16:00–01:00* in every cell is
 * four characters of noise per person per day and the owner reads the row, not
 * the clock. The dash is an en dash, from PLAN §12's glossary — not a hyphen.
 */
export function timeSpanBs(startTime: string, endTime: string): string {
  return `${hourBs(startTime)}–${hourBs(endTime)}`
}

function hourBs(value: string): string {
  return value.endsWith(':00') ? value.slice(0, 2) : value
}

/** The one sentence the owner's screen says about how the plan works. */
export const ROSTER_HINT_BS = 'Raspored važi svake sedmice dok ga ne promijeniš. Najviše dvije osobe po smjeni.'

// ---------------------------------------------------------------------------
// Shaping the pattern into cells
// ---------------------------------------------------------------------------

/** One template on one weekday: what a grid cell and a phone day row draw. */
export interface PatternCell {
  weekday: number
  template: ShiftTemplateView
  people: PatternEntry[]
  /** At the cap: the `+` is not drawn, because the server would refuse it. */
  full: boolean
}

/**
 * The week, cut as templates × weekdays — the owner's laptop grid.
 *
 * The single place the server's flat `entries` become cells, so the laptop grid,
 * the phone and S17 can never disagree about which name belongs in which cell.
 * A name whose template is not in `templates` (switched off) is in no cell.
 */
export function patternCells(view: RosterPatternView): PatternCell[][] {
  return view.templates.map(template => WEEKDAYS.map(weekday => cellOf(view, weekday, template)))
}

/** One weekday, template by template — the phone's panel and a card on S17. */
export function dayCells(view: RosterPatternView, weekday: number): PatternCell[] {
  return view.templates.map(template => cellOf(view, weekday, template))
}

function cellOf(view: RosterPatternView, weekday: number, template: ShiftTemplateView): PatternCell {
  const people = view.entries.filter(e => e.weekday === weekday && e.template_id === template.id)
  return { weekday, template, people, full: people.length >= view.max_per_shift }
}

/** Everyone already on that weekday, whatever the template — the picker's tag. */
export function alreadyThatWeekday(view: RosterPatternView, weekday: number): Map<string, string> {
  const names = new Map(view.templates.map(t => [t.id, t.name] as const))
  const out = new Map<string, string>()
  for (const e of view.entries) {
    if (e.weekday !== weekday || !names.has(e.template_id)) continue
    out.set(e.user_id, names.get(e.template_id)!)
  }
  return out
}

/** My own cells in the week, Monday first — the accent-coloured ones on S17. */
export function myPatternShifts(view: RosterPatternView, userId: string): PatternEntry[] {
  const shown = new Set(view.templates.map(t => t.id))
  return view.entries.filter(e => e.user_id === userId && shown.has(e.template_id))
}
