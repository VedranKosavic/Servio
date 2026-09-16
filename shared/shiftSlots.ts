/**
 * Which slot of the day a shift was — *Prva smjena*, *Druga smjena* — from the
 * wall-clock minute it opened at and the venue's templates.
 *
 * It lived in `app/components/smjena/smjeneDays.ts` while only a screen needed
 * it. *Analitika* (16.09.2026) needs the same answer on the server, for the
 * record night of each slot, and two copies of "does 15:10 fall inside
 * 16:00–01:00" is how the owner's *Smjene* and his *Analitika* would one day
 * disagree about which shift was the second one. So it is here, and the screen
 * imports it.
 */
import { localTime } from './dates'

/** `"16:05"` → 965. Anything that is not `H:MM` / `HH:MM` is `NaN`. */
export function toMinutes(hhmm: string): number {
  const parts = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!parts) return Number.NaN
  return Number(parts[1]) * 60 + Number(parts[2])
}

/**
 * Does a template's window hold this minute of the day?
 *
 * `end <= start` is the template's own convention for a window that ends the
 * next day ("Večernja 16:00–01:00"), so it is two ranges, not one.
 */
export function windowCovers(startTime: string, endTime: string, minute: number): boolean {
  const start = toMinutes(startTime)
  const end = toMinutes(endTime)
  if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(minute)) return false
  return end <= start
    ? minute >= start || minute < end
    : minute >= start && minute < end
}

/** The minute of the café's day a UTC instant falls on, 0–1439, or `NaN`. */
export function openingMinute(openedAt: string | null | undefined): number {
  return openedAt && !Number.isNaN(Date.parse(openedAt))
    ? toMinutes(localTime(openedAt))
    : Number.NaN
}

/** The first template whose window the instant falls in, or `null`. */
export function slotOf<T extends { start_time: string, end_time: string }>(
  openedAt: string | null | undefined, templates: T[],
): T | null {
  const minute = openingMinute(openedAt)
  return templates.find(t => windowCovers(t.start_time, t.end_time, minute)) ?? null
}
