/**
 * Time, in a café whose day starts at 06:00.
 *
 * Every timestamp in the database is an ISO-8601 UTC string written by the
 * server. Local time is a *display* and a *business-day* concern computed from
 * those strings, never stored — so a clock change in October cannot corrupt a
 * row that was correct in September.
 *
 * `Intl.DateTimeFormat(...).formatToParts` is how this file reads a UTC instant
 * as wall-clock time in Europe/Sarajevo. It is the only correct way to do it in
 * plain JavaScript: `Date.getHours()` answers in whatever zone the *machine*
 * happens to be in — which on the VPS is UTC (the systemd unit sets `TZ=UTC`)
 * and on Vedran's laptop is Sarajevo. No business code in this app calls
 * `getHours()`; it calls something here.
 *
 * `hourCycle: 'h23'` asks for 00–23 rather than 24-hour-with-24-at-midnight,
 * which some ICU builds return and which would parse as hour 24 of the wrong day.
 */

/** Where the café is, unless the venue's settings say otherwise. */
export const DEFAULT_TZ = 'Europe/Sarajevo'
/** The business day starts here: 02:30 on the 9th still belongs to the 8th. */
export const DEFAULT_DAY_START_HOUR = 6

interface Wall {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

/** What a wall clock in `tz` reads at this instant. */
function wallAt(utcMs: number, tz: string): Wall {
  const parts = formatter(tz).formatToParts(new Date(utcMs))
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find(p => p.type === type)
    return part ? Number(part.value) : 0
  }
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/**
 * How far ahead of UTC the zone is at this instant, in milliseconds. Positive
 * for Sarajevo (+1 h in winter, +2 h in summer).
 */
function zoneOffsetMs(utcMs: number, tz: string): number {
  const w = wallAt(utcMs, tz)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - utcMs
}

/**
 * The reverse: a wall-clock reading in `tz` back to the UTC instant.
 *
 * Two passes, because the offset depends on the answer. The first guess uses
 * the offset at the *wrong* instant; the second uses the offset at the instant
 * the first guess produced, which is right on every day of the year including
 * the two DST nights. (Inside the skipped hour of a spring-forward there is no
 * such instant at all; the result then lands on the hour after, which is what
 * "06:00 on the day the clocks went forward" has to mean.)
 */
function wallToUtcMs(w: Wall, tz: string): number {
  const naive = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  const firstGuess = naive - zoneOffsetMs(naive, tz)
  return naive - zoneOffsetMs(firstGuess, tz)
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/**
 * Which night this instant belongs to, as `YYYY-MM-DD`.
 *
 * A round locked at 02:30 on the 9th was served on the evening of the 8th, and
 * the owner's *pazar* for the 8th has to contain it. Anything before
 * `startHour` local therefore counts back one day.
 */
export function businessDate(
  utcIso: string,
  tz: string = DEFAULT_TZ,
  startHour: number = DEFAULT_DAY_START_HOUR,
): string {
  const ms = Date.parse(utcIso)
  const w = wallAt(ms, tz)
  // Build the local calendar date, then step back a day when we are still in
  // the small hours. Date.UTC does the month/year arithmetic for us.
  const local = Date.UTC(w.year, w.month - 1, w.day)
  const shifted = w.hour < startHour ? local - 86_400_000 : local
  const d = new Date(shifted)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** `"2026-09-08T22:41:00Z"` → `"00:41"` in Sarajevo. 24 h clock, always. */
export function localTime(utcIso: string, tz: string = DEFAULT_TZ): string {
  const w = wallAt(Date.parse(utcIso), tz)
  return `${pad(w.hour)}:${pad(w.minute)}`
}

/** `"2026-09-08T22:41:00Z"` → `"09.09.2026."` — the Bosnian written date. */
export function localDate(utcIso: string, tz: string = DEFAULT_TZ): string {
  const w = wallAt(Date.parse(utcIso), tz)
  return `${pad(w.day)}.${pad(w.month)}.${w.year}.`
}

/**
 * The UTC instant a business day begins: `06:00` local on that date.
 *
 * Every period query in the reports is `[cutoffIso(from), cutoffIso(dayAfter(to)))`,
 * so a month's *nabavka* contains the delivery that arrived at 23:00 on the last
 * day and not the one at 04:00 the morning after.
 */
export function cutoffIso(
  businessDay: string,
  tz: string = DEFAULT_TZ,
  startHour: number = DEFAULT_DAY_START_HOUR,
): string {
  const [year, month, day] = businessDay.split('-').map(Number)
  const ms = wallToUtcMs(
    { year: year!, month: month!, day: day!, hour: startHour, minute: 0, second: 0 },
    tz,
  )
  return new Date(ms).toISOString()
}

/** The business date after this one — the open end of a period. */
export function nextBusinessDate(businessDay: string): string {
  const [year, month, day] = businessDay.split('-').map(Number)
  const d = new Date(Date.UTC(year!, month! - 1, day!) + 86_400_000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/**
 * One clamp, three callers — `client_created_at` on a queued round, payment,
 * unpaid mark or waste event; `deliveries.delivered_at`; and a back-dated stock
 * `occurred_at`.
 *
 * A client timestamp is a **claim**, not a fact. The phone may have been offline
 * for six hours (true and useful), or its clock may be set to 2019 (a typo that
 * would otherwise move a confirmed count's theoretical stock). So:
 *
 *   - the device's own `clock_skew_s` — measured by the heartbeat as
 *     *device clock − server clock* — is subtracted first, turning what the
 *     phone thinks it is into what it actually was;
 *   - a value in the future is always wrong, so the upper bound is `now`;
 *   - a value older than `maxLagH` hours is clamped **up** to that bound, and
 *     the caller stamps the row `late_sync = 1`.
 *
 * `delivered_at` and `occurred_at` pass `skewS = 0`: they were typed by a human
 * reading an invoice, not stamped by a clock.
 *
 * Only the clamped value is ever compared to anything. The raw claim is stored
 * beside it (`client_created_at` next to `client_created_at_adj`) so a phone
 * with a wrong clock leaves evidence instead of a silently-corrected row.
 */
export function clampEventAt(
  claimed: string | undefined | null,
  now: string,
  maxLagH: number,
  skewS = 0,
): string {
  const nowMs = Date.parse(now)
  if (!claimed) return now

  const claimedMs = Date.parse(claimed)
  if (!Number.isFinite(claimedMs)) return now

  const corrected = claimedMs - skewS * 1000
  const floor = nowMs - maxLagH * 3_600_000
  const clamped = Math.min(Math.max(corrected, floor), nowMs)
  return new Date(clamped).toISOString()
}

/** Whole seconds between a clamped client timestamp and now; never negative. */
export function syncLagS(clientCreatedAtAdj: string, now: string): number {
  const lag = (Date.parse(now) - Date.parse(clientCreatedAtAdj)) / 1000
  return Math.max(0, Math.round(lag))
}

/**
 * The Monday of the week a business date belongs to, as `YYYY-MM-DD`.
 *
 * The roster is the only thing in Šank that thinks in weeks, and it thinks in
 * ISO ones: Monday first, Sunday last. Deliberately plain calendar arithmetic on
 * a `YYYY-MM-DD` string with no zone in sight — a `work_date` is a *date* the
 * owner picked, not an instant, so there is nothing here for a DST night to
 * corrupt. Use `businessDate(iso)` first when what you have is a timestamp.
 */
export function weekStart(businessDay: string): string {
  const [year, month, day] = businessDay.split('-').map(Number)
  const ms = Date.UTC(year!, month! - 1, day!)
  // getUTCDay(): 0 = Sunday. Monday is 1, so Sunday counts back six days.
  const dow = new Date(ms).getUTCDay()
  const back = (dow + 6) % 7
  const d = new Date(ms - back * 86_400_000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** `n` days after a `YYYY-MM-DD` date. Negative `n` goes back. */
export function addDays(businessDay: string, n: number): string {
  const [year, month, day] = businessDay.split('-').map(Number)
  const d = new Date(Date.UTC(year!, month! - 1, day!) + n * 86_400_000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** "pon", "uto" … — the three-letter Bosnian weekday of a `YYYY-MM-DD` date. */
const DAY_NAMES_BS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'] as const

export function weekdayBs(businessDay: string): string {
  const [year, month, day] = businessDay.split('-').map(Number)
  return DAY_NAMES_BS[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()]!
}

/** `"2026-09-18"` → `"18.09."` — the short written date the roster grid uses. */
export function shortDateBs(businessDay: string): string {
  const [, month, day] = businessDay.split('-')
  return `${day}.${month}.`
}

/**
 * Nominal hours between two `HH:MM` wall-clock strings, `end <= start` meaning
 * the shift ends the next day.
 *
 * No timezone and no DST: PHASE4 §2.7 is explicit that rostering is nominal.
 * 16:00–01:00 is nine hours on every date of the year, including the two the
 * clocks change, because that is what the owner wrote on the plan.
 */
export function plannedHours(startTime: string, endTime: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }
  const start = toMin(startTime)
  const end = toMin(endTime)
  const span = end <= start ? end + 24 * 60 - start : end - start
  return Math.round((span / 60) * 100) / 100
}
