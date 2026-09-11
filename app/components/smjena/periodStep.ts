/**
 * Stepping the period on *Smjene* — one night, one week or one month at a time.
 *
 * The phone's period control is an arrow, a name and an arrow, because six
 * chips wrapping onto two rows spent a third of the screen before the first
 * shift appeared. An arrow only works if "the period before this one" is a
 * question with an answer for *every* period, and the six presets are not a
 * line the owner can walk along: there is no *prekjučer* chip and no *sedmica
 * prije prošle*.
 *
 * So stepping works on the **range**, and the result is written back into the
 * URL the way `useAdminPeriod` already writes it: a range that happens to be
 * one of the presets goes back as `?period=jucer`, and everything else as
 * `?from&to`, which is exactly what *Prilagođeno* has always been. Nothing new
 * appears in the query, so a link the owner sends himself still opens on the
 * period he was looking at.
 *
 * **A period is stepped by what it is, not by how many days it is.** *Ova
 * sedmica* on a Wednesday is three days long, and moving it back three days
 * would land on Sunday-to-Tuesday — half of one week and half of another. A
 * week steps to the whole week before it and a month to the whole month before
 * it; only a range the owner typed himself steps by its own length.
 *
 * Nothing here reads a clock: `today` is the café's business date, handed in by
 * `useAdminPeriod`, so a step taken at 02:30 still steps from last night.
 */
import { addDays, weekStart } from '#shared/dates'
import { PERIOD_OPTIONS, resolvePeriod, type PeriodKey } from '~/composables/useAdminPeriod'

export interface DayRange {
  from: string
  to: string
}

/** Where a step lands: on one of the presets, or on a plain range of days. */
export type PeriodMove =
  | { kind: 'preset', key: PeriodKey }
  | { kind: 'custom', from: string, to: string }

const DAY_MS = 86_400_000

/** `"2026-09-08"`, `1` → `"2026-10-01"`. Month arithmetic, not day arithmetic. */
function monthStart(day: string, n: number): string {
  const [year, month] = day.split('-').map(Number)
  const d = new Date(Date.UTC(year!, month! - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** The whole calendar month a day falls in. */
function wholeMonth(day: string, n: number): DayRange {
  const from = monthStart(day, n)
  return { from, to: addDays(monthStart(from, 1), -1) }
}

/** Is this range exactly one calendar month, first to last? */
function isWholeMonth(range: DayRange): boolean {
  const month = wholeMonth(range.from, 0)
  return range.from === month.from && range.to === month.to
}

/** Days in the range, both ends counted: 08.09.–08.09. is one day, not none. */
function spanDays(range: DayRange): number {
  const from = Date.parse(`${range.from}T00:00:00Z`)
  const to = Date.parse(`${range.to}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) return 1
  return Math.round((to - from) / DAY_MS) + 1
}

/**
 * Is there a period after this one?
 *
 * There is no tomorrow in a list of nights that have happened, so the forward
 * arrow is dead while the period already reaches tonight. That is also what
 * stops the owner from stepping into a run of empty screens.
 */
export function canStepForward(range: DayRange, today: string): boolean {
  return range.to < today
}

/** The same range moved one period in `direction`, before any clamping. */
function movedRange(key: PeriodKey, range: DayRange, direction: -1 | 1): DayRange {
  if (key === 'ovaj-mjesec' || isWholeMonth(range)) {
    return wholeMonth(range.from, direction)
  }
  if (key === 'ova-sedmica' || key === 'prosla-sedmica') {
    const monday = addDays(weekStart(range.from), direction * 7)
    return { from: monday, to: addDays(monday, 6) }
  }
  const span = spanDays(range)
  return {
    from: addDays(range.from, direction * span),
    to: addDays(range.to, direction * span),
  }
}

/**
 * A range that *is* one of the presets goes back into the URL as that preset.
 *
 * Without this, stepping forward off *Jučer* would write `?from=&to=` for a
 * range that has a name, the control would read "Prilagođeno" over today's
 * date, and the owner would have no way back to a clean `/admin/smjene`.
 */
function nameIt(range: DayRange, today: string): PeriodMove {
  for (const option of PERIOD_OPTIONS) {
    if (option.key === 'prilagodjeno') continue
    const preset = resolvePeriod(option.key, today)
    if (preset.from === range.from && preset.to === range.to) {
      return { kind: 'preset', key: option.key }
    }
  }
  return { kind: 'custom', ...range }
}

/**
 * One step back or forward, as something `useAdminPeriod` can be told.
 *
 * Forward is clamped at tonight rather than refused, so a week stepped forward
 * out of *Prošla sedmica* lands on *Ova sedmica* — the part of this week that
 * has happened — instead of on a range that runs into next Sunday.
 */
export function stepPeriod(
  key: PeriodKey, range: DayRange, direction: -1 | 1, today: string,
): PeriodMove {
  const moved = movedRange(key, range, direction)
  const to = moved.to > today ? today : moved.to
  const from = moved.from > to ? to : moved.from
  return nameIt({ from, to }, today)
}
