/**
 * How `/admin` writes a number, a date and a length of time.
 *
 * Files in `app/utils/` are auto-imported by Nuxt exactly like composables, so
 * no page or component under `/admin` writes an `import` line for any of this — and
 * because there is one place to get a formatted amount, there is no second
 * place where somebody reaches for `toFixed(2)`.
 *
 * The money functions are `shared/money.ts`'s, re-exported rather than
 * reimplemented: the server formats the same amounts into log titles with those
 * exact functions, so a number in the Dnevnik and the same number in a table
 * cell can never disagree.
 *
 * Two house rules, both non-negotiable:
 *
 *   1. **Money is an integer number of feninga.** `12.30` has no exact binary
 *      representation, so a column of floats that looks right sums to 0,01 KM
 *      wrong. Everything here takes `fen` and gives back a string.
 *   2. **Every rendered instant goes through `Europe/Sarajevo`.** The database
 *      stores UTC; `new Date().getHours()` would read the laptop's own zone and
 *      show a shift that opened at 18:03 as opening at 16:03 on a machine left
 *      on UK time.
 */
import {
  formatAmount as sharedFormatAmount,
  formatKm as sharedFormatKm,
} from '#shared/money'
import { localDate, localTime } from '#shared/dates'

/** `125050` → `"1.250,50 KM"`. Every amount the owner reads in prose. */
export const formatKm = sharedFormatKm

/** The same number without "KM" — what goes in a right-aligned table cell. */
export const formatAmount = sharedFormatAmount

/** The real minus sign, U+2212. A hyphen is narrower and breaks a tabular column. */
const MINUS = '−'

/**
 * `"2026-09-08T22:41:00Z"` → `"09.09.2026."`, and a business date
 * (`"2026-09-08"`) → `"08.09.2026."` unchanged by any zone.
 *
 * Both shapes arrive on `/admin`: `at` fields are UTC instants, `business_date` is
 * already the café's own day and must never be pushed through a timezone twice.
 */
export function dateBs(value: string | null | undefined): string {
  if (!value) return ''
  const businessDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (businessDay) return `${businessDay[3]}.${businessDay[2]}.${businessDay[1]}.`
  return Number.isNaN(Date.parse(value)) ? '' : localDate(value)
}

/** `"22:41"` — a UTC instant on the café's wall clock, 24 h. */
export function timeBs(value: string | null | undefined): string {
  if (!value || Number.isNaN(Date.parse(value))) return ''
  return localTime(value)
}

/** `"09.09.2026. 00:41"` — date and clock, for a row that spans two days. */
export function dateTimeBs(value: string | null | undefined): string {
  const date = dateBs(value)
  return date ? `${date} ${timeBs(value)}` : ''
}

/**
 * A length of time as the owner says it: `"48 min"`, `"6 h 08"`, `"1 h"`.
 *
 * Hours keep two digits of minutes because a shift length sits in a column
 * beside other shift lengths, and "6 h 8" would not line up under "6 h 08".
 */
export function durationBs(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`
}

/** The same, from two instants — "otvorena 18:03, zatvorena 00:42" → "6 h 39". */
export function spanBs(fromIso: string, toIso: string | null | undefined): string {
  const from = Date.parse(fromIso)
  const to = toIso ? Date.parse(toIso) : Date.now()
  if (Number.isNaN(from) || Number.isNaN(to)) return ''
  return durationBs((to - from) / 1000)
}

/**
 * A signed amount in prose: `"−4,00 KM"` with the real minus sign.
 *
 * `formatAmount` writes an ASCII hyphen, which is the right character in a CSV
 * and the wrong one in a column of tabular figures, where the hyphen is
 * narrower than a digit and the column stops lining up.
 */
export function signedKm(fen: number): string {
  return formatKm(fen).replace('-', MINUS)
}

/** The same, without the currency — for a table cell. */
export function signedAmount(fen: number): string {
  return formatAmount(fen).replace('-', MINUS)
}
