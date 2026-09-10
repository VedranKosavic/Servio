/**
 * *Raspored* — the labels and the small pieces of arithmetic the four roster
 * screens share (PHASE4 §3, WP2).
 *
 * Everything above `useRoster()` is a **pure function of its arguments**: no
 * `ref`, no `fetch`, no clock. That is what lets `tests/unit/raspored-ui.test.ts`
 * import this file in a plain Node process and assert that "16:00"–"01:00" reads
 * *16–01* and that a Monday's week reads *14.09.–20.09.* — a wrong label here is
 * a wrong shift on somebody's phone, and it should not take a browser to catch.
 *
 * The dates are plain `YYYY-MM-DD` strings all the way through. A `work_date`
 * is a *date the owner picked*, not an instant, so nothing in this file has a
 * timezone in it and nothing calls `getHours()` (CLAUDE.md); `shared/dates.ts`
 * owns the two calendar helpers (`weekStart`, `addDays`) and the nominal
 * `plannedHours`.
 */
import { addDays, plannedHours, shortDateBs, weekStart, weekdayBs } from '#shared/dates'
import type {
  Assignment, AssignmentStatus, HoursRow, RosterWeekView, ShiftTemplateView, SwapStatus,
} from '#shared/types'

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

function hourBs(hhmm: string): string {
  return hhmm.endsWith(':00') ? hhmm.slice(0, 2) : hhmm
}

/** `"2026-09-14"` → `"14.09.–20.09."` — the week header and the publish line. */
export function weekRangeBs(monday: string): string {
  return `${shortDateBs(monday)}–${shortDateBs(addDays(monday, 6))}`
}

/** `"2026-09-14"` → `"pon 14.09."` — one day row on S17 and one grid column. */
export function dayLabelBs(workDate: string): string {
  return `${weekdayBs(workDate)} ${shortDateBs(workDate)}`
}

/**
 * The status word. Colour never carries a meaning by itself on any Šank screen,
 * so every chip that is not plain `planned` also says what it is.
 */
export const STATUS_BS: Record<AssignmentStatus, string> = {
  planned: 'planirano',
  swapped: 'zamijenjeno',
  sick: 'bolestan',
  absent: 'nije došao',
  removed: 'uklonjeno',
}

/** *Zamjene* filters by these, and the tab strip spells them out. */
export const SWAP_STATUS_BS: Record<SwapStatus, string> = {
  pending: 'čeka',
  accepted: 'preuzeta',
  declined: 'odbijena',
  cancelled: 'povučena',
}

/**
 * `9` → `"9 h"`, `8.5` → `"8,5 h"`.
 *
 * The decimal separator is a comma, like every other number in this app; a
 * whole number never grows a `,0`.
 */
export function hoursBs(hours: number): string {
  const rounded = Math.round(hours * 10) / 10
  return `${String(rounded).replace('.', ',')} h`
}

/** `40` → `"+40 min"`. Zero is nothing at all, not `"+0 min"`. */
export function lateBs(minutes: number): string {
  return minutes > 0 ? `+${minutes} min` : ''
}

/**
 * *"16–01 (staro 15–00)"* — a template whose hours were edited **after** a week
 * was published.
 *
 * The rows keep the times they were written with, exactly like a price at lock:
 * editing the *Večernja* template tomorrow must never rewrite what somebody
 * worked last Friday. So the row still says what the template says today, and
 * the drift is spelled out beside it rather than quietly resolved one way or the
 * other. Returns the plain span when nothing drifted.
 */
export function templateSpanBs(
  template: ShiftTemplateView, assignments: Assignment[],
): string {
  const now = timeSpanBs(template.start_time, template.end_time)
  const old = assignments.find(a =>
    a.template_id === template.id
    && (a.start_time !== template.start_time || a.end_time !== template.end_time))
  if (!old) return now
  return `${now} (staro ${timeSpanBs(old.start_time, old.end_time)})`
}

// ---------------------------------------------------------------------------
// Shaping a week into cells
// ---------------------------------------------------------------------------

/** One template on one day: what a grid cell and a phone day-card row draw. */
export interface RosterCell {
  work_date: string
  template: ShiftTemplateView
  /** Everyone visible in the cell — `removed` excluded, see `removed` below. */
  people: Assignment[]
  /** Hidden behind "1 uklonjen" until the owner taps it. */
  removed: Assignment[]
}

/**
 * The week, re-cut as templates × days.
 *
 * The server answers with days each holding a flat list, because that is the
 * shape a phone reads top to bottom. The owner's grid reads the other way — one
 * row per template, one column per day — and this is the single place that turn
 * happens, so the laptop grid and the phone cards can never disagree about which
 * chip belongs in which cell.
 */
export function weekCells(week: RosterWeekView): RosterCell[][] {
  return week.templates.map(template =>
    week.days.map((day) => {
      const here = day.assignments.filter(a => a.template_id === template.id)
      return {
        work_date: day.work_date,
        template,
        // `swapped` is history — the giver's row after somebody took the shift.
        // It stays out of the cell so the cell shows who is actually working.
        people: here.filter(a => a.status !== 'removed' && a.status !== 'swapped'),
        removed: here.filter(a => a.status === 'removed'),
      }
    }),
  )
}

/** Everyone already rostered that day, whatever the template — the picker's tag. */
export function alreadyThatDay(week: RosterWeekView, workDate: string): Map<string, string> {
  const day = week.days.find(d => d.work_date === workDate)
  const out = new Map<string, string>()
  for (const a of day?.assignments ?? []) {
    if (a.status === 'removed' || a.status === 'swapped') continue
    out.set(a.user_id, a.template_name)
  }
  return out
}

/** My own rows in a week, in day order — the accent-coloured ones on S17. */
export function myShifts(week: RosterWeekView, userId: string): Assignment[] {
  return week.days.flatMap(day => day.assignments.filter(a => a.user_id === userId))
}

// ---------------------------------------------------------------------------
// Sati
// ---------------------------------------------------------------------------

/**
 * The two rows *Sati* prints that are not a shift: the person who was there and
 * is not on the plan, and the plan with nobody behind it.
 *
 * They are counts on `HoursRow` already; this only names them, in one place, so
 * the table and the per-person drill-down use the same words.
 */
export const HOURS_NOTE_BS = {
  unplanned: 'radio bez rasporeda',
  noShift: 'planirano, nema smjene',
} as const

/** Does this month's table have anything in it at all? */
export function hoursEmpty(rows: HoursRow[]): boolean {
  return rows.every(r => r.planned_shifts === 0 && r.worked_h === 0 && r.unplanned_rows === 0)
}

/** `"2026-09"` → `"2026-08"`. The month picker's arrows, with no `Date` in sight. */
export function shiftMonth(month: string, by: number): string {
  const [year, mon] = month.split('-').map(Number)
  const total = year! * 12 + (mon! - 1) + by
  const y = Math.floor(total / 12)
  const m = total % 12 + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

const MONTHS_BS = [
  'januar', 'februar', 'mart', 'april', 'maj', 'juni',
  'juli', 'august', 'septembar', 'oktobar', 'novembar', 'decembar',
]

/** `"2026-09"` → `"septembar 2026."` */
export function monthBs(month: string): string {
  const [year, mon] = month.split('-')
  return `${MONTHS_BS[Number(mon) - 1]} ${year}.`
}

// ---------------------------------------------------------------------------
// The screens' shared state
// ---------------------------------------------------------------------------

/**
 * The week the owner is looking at, kept in the route query.
 *
 * Same reason as `useAdminPeriod`: a tab left open and reloaded comes back on
 * the same week, and a link the owner sends himself opens on it. `?w=` is always
 * a Monday — `weekStart()` normalises whatever is in the URL, so a hand-typed
 * Wednesday still lands on its week rather than drawing seven days from
 * mid-week.
 */
export function useRosterWeek(today: string) {
  const route = useRoute()
  const router = useRouter()

  const monday = computed(() => {
    const raw = route.query.w
    return weekStart(typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today)
  })

  function go(by: number) {
    void router.replace({ query: { ...route.query, w: addDays(monday.value, by * 7) } })
  }

  return { monday, go, label: computed(() => weekRangeBs(monday.value)) }
}

/** Nominal hours of one assignment — re-exported so a screen imports one file. */
export { plannedHours }
