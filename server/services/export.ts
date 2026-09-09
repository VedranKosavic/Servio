/**
 * *Izvoz* — the four CSV files, built once here (`docs/PHASE2.md` §3, WP5).
 *
 * These are **reads and nothing else**. They open no transaction, write no
 * `log_entries` row and call no `bump()`: a download is the owner looking at
 * numbers he can already see on screen, in a shape a spreadsheet opens. Every
 * figure comes back through the services that own it — `owner.ts` for the
 * shifts and their summaries, `summaries.ts` for the lines, `counts.ts` for a
 * popis — so a CSV can never disagree with the page it was exported from.
 *
 * ## The four rules that make a file open correctly in Bosnia
 *
 * 1. **UTF-8 with a BOM.** The byte-order mark (`U+FEFF`) is an invisible first
 *    character that tells Excel on a Bosnian Windows "this is UTF-8". Without
 *    it Excel guesses the system code page and turns *šank* into *Å¡ank* — the
 *    single most common way a correct export looks broken.
 * 2. **`;` between the columns.** A comma is the *decimal* separator here, so a
 *    comma-separated file would split `1250,50` into two cells.
 * 3. **CRLF line endings**, which is what RFC 4180 says and what Excel expects.
 * 4. **`1250,50`, with no thousands separator.** `shared/money.ts`'s
 *    `formatAmount` writes `1.250,50` for the screen, which is right for a
 *    person and wrong for a spreadsheet: the dot would make the cell text.
 *    So money is formatted here, out of the same integer feninga.
 *
 * And one rule that is not about spreadsheets: every file's last row is
 * `interni izvještaj — nije fiskalni`. Šank is not a fiscal device, and a file
 * that leaves the building says so on itself and not only on the page it came
 * from.
 */
import { eq } from 'drizzle-orm'
import { schema } from '../database/client'
import { businessDate, localDate, localTime } from '#shared/dates'
import { EXPORTS, EXPORT_DISCLAIMER } from '#shared/types/export'
import type { CsvFile } from '#shared/types/export'
import type { CountView, LineRow, LineStatus } from '#shared/types'
import { getCount } from './counts'
import { listOwnerShifts, ownerShiftSummary } from './owner'
import { shiftLines } from './summaries'
import type { Queryable } from './types'
import { nowIso } from '../utils/ids'
import { getSettings } from './contracts'

// ===========================================================================
// The CSV primitives
// ===========================================================================

const BOM = '﻿'
const SEP = ';'
const CRLF = '\r\n'

/**
 * One field, quoted only when it has to be.
 *
 * A field that contains the delimiter, a quote or a line break is wrapped in
 * quotes and its own quotes are doubled — RFC 4180. A note a waiter typed is
 * the field that will eventually contain all three.
 */
export function csvField(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function csvRow(cells: string[]): string {
  return cells.map(csvField).join(SEP)
}

/**
 * The whole file: a header row, the body, the disclaimer, and the BOM in front.
 *
 * A trailing CRLF after the last row is what RFC 4180 allows and what every
 * spreadsheet handles; without it some editors report "no newline at end".
 */
export function csvFile(filename: string, header: string[], rows: string[][]): CsvFile {
  const lines = [csvRow(header), ...rows.map(csvRow), csvRow([EXPORT_DISCLAIMER])]
  return { filename, text: BOM + lines.join(CRLF) + CRLF }
}

/** `125050` → `"1250,50"`. Integer feninga in, no thousands separator out. */
export function csvAmount(fen: number): string {
  const rounded = Math.round(fen)
  const sign = rounded < 0 ? '-' : ''
  const abs = Math.abs(rounded)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/** `2.5` → `"2,5"`. Quantities are real numbers in base units, unlike money. */
export function csvQty(qty: number): string {
  return String(Math.round(qty * 1000) / 1000).replace('.', ',')
}

/**
 * `"2026-09-08"` → `"08.09.2026."`, and a UTC instant → the café's own date.
 *
 * A **business date** is already the café's day and must never be pushed
 * through a timezone a second time; an `at` is UTC and must be pushed through
 * exactly once. The regex is what tells the two apart.
 */
export function csvDate(value: string | null | undefined): string {
  if (!value) return ''
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (day) return `${day[3]}.${day[2]}.${day[1]}.`
  return Number.isNaN(Date.parse(value)) ? '' : localDate(value)
}

/** `"22:41"` — 24 h, on `Europe/Sarajevo`, never on the server's own clock. */
export function csvTime(value: string | null | undefined): string {
  if (!value || Number.isNaN(Date.parse(value))) return ''
  return localTime(value)
}

/** A shift with more lines than this is read in `shiftLines`-sized bites. */
const LINES_PAGE = 300
/** A guard on the paging loop: 60 pages is 18 000 lines, a very long month. */
const MAX_LINE_PAGES = 60

// ===========================================================================
// smjene.csv
// ===========================================================================

/**
 * One row per shift in the period, oldest first.
 *
 * The ten columns are `docs/PHASE2.md` §3's list verbatim. *Storna* is the
 * amount and not the count, because every other money column beside it is an
 * amount and a spreadsheet that mixes the two in one row is a spreadsheet
 * somebody sums wrongly.
 */
export function exportShifts(
  q: Queryable, venueId: string, from: string, to: string, now = nowIso(),
): CsvFile {
  const header = [
    'Datum', 'Otvorena', 'Zatvorena', 'Promet', 'Gotovina', 'Kartica',
    'Gratis', 'Storna', 'Razlika', 'Manjak robe',
  ]

  // `listOwnerShifts` answers newest first, which is the order the *Smjene*
  // screen wants; a file that will be read top to bottom wants the other one.
  const shifts = listOwnerShifts(q, venueId, from, to, now).slice().reverse()

  const rows = shifts.map((shift) => {
    const s = ownerShiftSummary(q, venueId, shift.id, now)
    return [
      csvDate(shift.business_date),
      csvTime(shift.opened_at),
      csvTime(shift.closed_at),
      csvAmount(s.promet_fen),
      csvAmount(s.cash_fen),
      csvAmount(s.card_fen),
      csvAmount(s.comp_fen),
      csvAmount(s.void_fen),
      s.diff_fen === null ? '' : csvAmount(s.diff_fen),
      csvAmount(s.stock_variance_fen),
    ]
  })

  return csvFile(EXPORTS.smjene.filename, header, rows)
}

// ===========================================================================
// dnevni_pazar.csv
// ===========================================================================

/**
 * One row per **business day** — the same numbers as `smjene.csv`, folded over
 * the day's shifts.
 *
 * A day can hold two shifts (an early close and a re-open, PLAN §10 F1), and
 * the owner's own question is "šta je bio pazar u petak", not "šta je bila
 * prva smjena u petak". `Razlika` sums only the shifts that have one: a night
 * nobody counted contributes nothing rather than a zero that would look like a
 * drawer that balanced.
 */
export function exportDailyRevenue(
  q: Queryable, venueId: string, from: string, to: string, now = nowIso(),
): CsvFile {
  const header = [
    'Datum', 'Smjene', 'Promet', 'Gotovina', 'Kartica', 'Nenaplaćeno',
    'Gratis', 'Storna', 'Razlika', 'Manjak robe',
  ]

  interface Day {
    shifts: number
    promet: number
    cash: number
    card: number
    unpaid: number
    comp: number
    voids: number
    diff: number | null
    variance: number
  }

  const days = new Map<string, Day>()
  for (const shift of listOwnerShifts(q, venueId, from, to, now)) {
    const s = ownerShiftSummary(q, venueId, shift.id, now)
    const day = days.get(shift.business_date) ?? {
      shifts: 0, promet: 0, cash: 0, card: 0, unpaid: 0,
      comp: 0, voids: 0, diff: null, variance: 0,
    }
    day.shifts += 1
    day.promet += s.promet_fen
    day.cash += s.cash_fen
    day.card += s.card_fen
    day.unpaid += s.unpaid_fen
    day.comp += s.comp_fen
    day.voids += s.void_fen
    if (s.diff_fen !== null) day.diff = (day.diff ?? 0) + s.diff_fen
    day.variance += s.stock_variance_fen
    days.set(shift.business_date, day)
  }

  const rows = [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, d]) => [
      csvDate(date),
      String(d.shifts),
      csvAmount(d.promet),
      csvAmount(d.cash),
      csvAmount(d.card),
      csvAmount(d.unpaid),
      csvAmount(d.comp),
      csvAmount(d.voids),
      d.diff === null ? '' : csvAmount(d.diff),
      csvAmount(d.variance),
    ])

  return csvFile(EXPORTS['dnevni-pazar'].filename, header, rows)
}

// ===========================================================================
// stavke.csv
// ===========================================================================

/** The Bosnian word for a line's status — a colour is not a word (§4). */
const STATUS_BS: Record<LineStatus, string> = {
  otvoreno: 'otvoreno',
  naplaceno: 'naplaćeno',
  nije_placeno: 'nije plaćeno',
  storno: 'storno',
  storno_na_cekanju: 'storno na čekanju',
  gratis: 'gratis',
}

/**
 * Every line item in the period, oldest first.
 *
 * **Initials by default.** A file of per-person money leaves the laptop the
 * moment it is exported, and CLAUDE.md's accountability rule is that staff are
 * never the subject of a document that travels: "A.H." is enough for the owner
 * to recognise his own shift and not enough to be a payroll list somebody else
 * reads. `full_names` is the explicit, deliberate opt-in on the page.
 */
export function exportLines(
  q: Queryable, venueId: string, from: string, to: string,
  opts: { fullNames?: boolean } = {}, now = nowIso(),
): CsvFile {
  const header = [
    'Datum', 'Vrijeme', 'Konobar', 'Sto', 'Stavka', 'Arome',
    'Količina', 'Cijena', 'Iznos', 'Status', 'Kasno sinhronizovano',
  ]

  const initials = new Map(
    q.select({ id: schema.users.id, initials: schema.users.initials })
      .from(schema.users)
      .where(eq(schema.users.venueId, venueId))
      .all()
      .map(u => [u.id, u.initials] as const),
  )

  const who = (line: LineRow): string =>
    opts.fullNames ? line.locked_by_name : initials.get(line.locked_by) ?? line.locked_by_name

  const rows: string[][] = []
  for (const shift of listOwnerShifts(q, venueId, from, to, now).slice().reverse()) {
    for (const line of allLines(q, venueId, shift.id)) {
      rows.push([
        csvDate(shift.business_date),
        csvTime(line.at),
        who(line),
        line.table_name,
        line.name_snapshot,
        line.flavour_names.join(', '),
        csvQty(line.qty),
        csvAmount(line.unit_price_fen),
        csvAmount(line.charged_fen),
        STATUS_BS[line.status],
        line.late_sync ? 'da' : '',
      ])
    }
  }

  return csvFile(EXPORTS.stavke.filename, header, rows)
}

/** Every line of one shift, walked through the keyset cursor `shiftLines` gives. */
function allLines(q: Queryable, venueId: string, shiftId: string): LineRow[] {
  const rows: LineRow[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_LINE_PAGES; page++) {
    const next = shiftLines(q, venueId, shiftId, {
      kat: 'sve', limit: LINES_PAGE, ...(cursor ? { cursor } : {}),
    })
    rows.push(...next.rows)
    if (!next.next_cursor) break
    cursor = next.next_cursor
  }
  return rows
}

// ===========================================================================
// popis.csv
// ===========================================================================

/**
 * One *popis* — one row per counted line, in the order the count holds them.
 *
 * `Razlika` is the quantity the shelf is short (or over) and `Vrijednost
 * razlike` is what that is worth in money, which is the number the shift page
 * calls *manjak robe*. `Procijenjeno` marks a line priced by the fallback cost
 * rather than by a real moving average — the honest caveat, in the file as well
 * as on the screen.
 */
export function exportCount(q: Queryable, venueId: string, countId: string): CsvFile {
  const count: CountView = getCount(q, venueId, countId)

  const header = [
    'Artikal', 'Jedinica', 'Izbrojano', 'Teoretski', 'Razlika',
    'Vrijednost razlike', 'Van tolerancije', 'Procijenjeno', 'Napomena',
  ]

  // Sorted by name so that two exports of the same count are the same file —
  // the join behind `CountView` has no order of its own.
  const rows = [...count.lines]
    .sort((a, b) => a.item_name.localeCompare(b.item_name, 'bs'))
    .map(line => [
      line.item_name,
      line.base_unit,
      csvQty(line.counted_qty),
      csvQty(line.theoretical_qty),
      csvQty(line.variance_qty),
      csvAmount(line.variance_fen),
      line.out_of_tolerance ? 'da' : '',
      line.estimated ? 'da' : '',
      line.note ?? '',
    ])

  return csvFile(EXPORTS.popis.filename, header, rows)
}

// ===========================================================================
// Shared route helpers
// ===========================================================================

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A `from` / `to` query value, or `undefined` if it is not a business date. */
export function dayParam(value: unknown): string | undefined {
  return typeof value === 'string' && DAY.test(value) ? value : undefined
}

/**
 * The `{ from, to }` a route exports over: what the query asked for, or today.
 *
 * "Today" is the **business date** — the café's day starts at 06:00, so an
 * export run at 02:30 while the bar is still open covers last night and not an
 * empty new one (`shared/dates.ts`).
 */
export function exportPeriod(
  q: Queryable, venueId: string, from?: string, to?: string, now = nowIso(),
): { from: string, to: string } {
  const settings = getSettings(q, venueId)
  const today = businessDate(now, settings.timezone, settings.business_day_start_hour)
  const end = to ?? from ?? today
  const start = from ?? end
  // A range typed backwards is still a range; sorting it beats an error.
  return start <= end ? { from: start, to: end } : { from: end, to: start }
}

/**
 * The two headers that turn a string into a saved file.
 *
 * `Content-Disposition: attachment` is what makes the browser write the file to
 * disk under `filename` instead of rendering it in a tab, and it is why a
 * download cannot go through `useAdminApi` — `$fetch` would read the bytes into
 * a variable and the browser would never see the header.
 */
export function csvHeaders(file: CsvFile): Record<string, string> {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${file.filename}"`,
    // A re-export after a correction must not come back out of the cache.
    'Cache-Control': 'private, no-store',
  }
}
