/**
 * *Izvoz* — the four CSV files (`docs/PHASE2.md` §3, WP5).
 *
 * Two kinds of assertion live here and they are not the same kind of thing.
 *
 * **The file opens.** BOM, `;`, CRLF, `1250,50`, `08.09.2026.`, doubled quotes,
 * and č/ž/š surviving the round trip. These read like pedantry until the owner
 * double-clicks `dnevni_pazar.csv` on a Bosnian Windows and Excel puts the
 * whole night in one column with `Å¡` where the *š* should be — at which point
 * a correct export is indistinguishable from a broken one.
 *
 * **The file agrees with the screen.** A CSV is a second rendering of numbers
 * the owner has already read on `/admin`, so the day in `dnevni_pazar.csv` is
 * asserted to equal the sum of that day's rows in `smjene.csv`, and both are
 * asserted against `ownerShiftSummary` — the function *Smjena* itself reads.
 * A file that quietly disagreed with the page would be the worst possible bug
 * here, because it is the one nobody can see without adding the columns up.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import {
  csvAmount, csvDate, csvField, csvQty, csvTime,
  exportCount, exportDailyRevenue, exportLines, exportPeriod, exportShifts, csvHeaders,
} from '../../server/services/export'
import { ownerShiftSummary } from '../../server/services/owner'
import { EXPORTS, EXPORT_DISCLAIMER, EXPORT_ORDER, exportUrl } from '#shared/types/export'
import { ROUTE_ROLES, routeKey } from '#shared/routeRoles'
import { makeFixture, schema, type Fixture } from '../helpers/db'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

const DAY_A = '2026-09-08'
const DAY_B = '2026-09-09'

/** The rows of a file, BOM stripped, split on CRLF, with the trailing blank gone. */
function lines(text: string): string[] {
  expect(text.startsWith('﻿')).toBe(true)
  return text.slice(1).split('\r\n').filter(line => line !== '')
}

/** One row's cells. The test data never quotes, except where a test says so. */
function cells(row: string): string[] {
  return row.split(';')
}

/** Mark a tab paid — what turns a line's status into *naplaćeno*. */
function markPaid(tabId: string, at: string): void {
  f.db.update(schema.tabs)
    .set({ status: 'paid', closedAt: at, closedBy: f.userId('Emir') })
    .where(eq(schema.tabs.id, tabId))
    .run()
}

/** Close a shift the way the ledger does — the fixture opens, it does not close. */
function close(shiftId: string, at: string): void {
  f.db.update(schema.shifts)
    .set({ status: 'closed', closedAt: at, closedBy: f.userId('Emir') })
    .where(eq(schema.shifts.id, shiftId))
    .run()
}

/**
 * Two shifts on one business date and one on the next — the shape that makes
 * `dnevni_pazar.csv` a different file from `smjene.csv` rather than a copy.
 */
function twoNights(): { first: string, second: string, third: string } {
  const first = f.openShift({ members: ['Amar', 'Emir'], at: `${DAY_A}T18:00:00Z`, businessDate: DAY_A })
  const a = f.lock('Amar', 'Sto 3', [{ product: 'Kafa', qty: 2 }], { at: `${DAY_A}T18:30:00Z` })
  f.pay('Amar', a.tabId, a.totalFen, { method: 'cash', at: `${DAY_A}T19:00:00Z` })
  markPaid(a.tabId, `${DAY_A}T19:00:00Z`)
  close(first, `${DAY_A}T22:00:00Z`)

  const second = f.openShift({ members: ['Lejla'], at: `${DAY_A}T22:10:00Z`, businessDate: DAY_A })
  const b = f.lock('Lejla', 'Sto 5', [{ product: 'Red Bull' }], { at: `${DAY_A}T22:30:00Z` })
  f.pay('Lejla', b.tabId, b.totalFen, { method: 'card', at: `${DAY_A}T23:00:00Z` })
  markPaid(b.tabId, `${DAY_A}T23:00:00Z`)
  close(second, `${DAY_B}T01:00:00Z`)

  const third = f.openShift({ members: ['Dino'], at: `${DAY_B}T18:00:00Z`, businessDate: DAY_B })
  const c = f.lock('Dino', 'Sto 9', [
    { product: 'Sok od narandže' },
    { product: 'Nargila', flavours: ['Al Fakher · Grožđe'] },
  ], { at: `${DAY_B}T18:20:00Z` })
  // A gratis, so *Gratis* is not a column of zeros in either file.
  f.voidLine('Dino', c.lineIds[0]!, { kind: 'comp', status: 'applied', at: `${DAY_B}T18:25:00Z` })
  f.pay('Dino', c.tabId, 1500, { method: 'cash', at: `${DAY_B}T19:00:00Z` })
  markPaid(c.tabId, `${DAY_B}T19:00:00Z`)

  return { first, second, third }
}

// ===========================================================================
// The primitives
// ===========================================================================

describe('the CSV primitives', () => {
  it('writes an amount with a comma and no thousands separator', () => {
    // `formatAmount` would give "1.250,50" — right for a screen, wrong for a
    // spreadsheet, which would read the dot and store the cell as text.
    expect(csvAmount(125050)).toBe('1250,50')
    expect(csvAmount(0)).toBe('0,00')
    expect(csvAmount(5)).toBe('0,05')
    expect(csvAmount(-400)).toBe('-4,00')
  })

  it('writes a quantity with a comma, and a date the Bosnian way', () => {
    expect(csvQty(2.5)).toBe('2,5')
    expect(csvQty(12)).toBe('12')
    expect(csvDate('2026-09-08')).toBe('08.09.2026.')
    expect(csvDate(null)).toBe('')
  })

  it('renders an instant on the café clock, not on the server clock', () => {
    // 20:00 UTC in September is 22:00 in Sarajevo.
    expect(csvTime('2026-09-08T20:00:00Z')).toBe('22:00')
  })

  it('quotes only what has to be quoted, and doubles an inner quote', () => {
    expect(csvField('Kafa')).toBe('Kafa')
    expect(csvField('pukla; dvije')).toBe('"pukla; dvije"')
    expect(csvField('rekao "dvije"')).toBe('"rekao ""dvije"""')
    expect(csvField('prvi\r\ndrugi')).toBe('"prvi\r\ndrugi"')
  })
})

// ===========================================================================
// smjene.csv
// ===========================================================================

describe('smjene.csv', () => {
  it('is one row per shift, oldest first, with the header and the disclaimer', () => {
    const { first, second, third } = twoNights()
    const file = exportShifts(f.db, f.venueId, DAY_A, DAY_B, `${DAY_B}T23:00:00Z`)

    expect(file.filename).toBe('smjene.csv')
    const rows = lines(file.text)

    // header + three shifts + the disclaimer
    expect(rows).toHaveLength(5)
    expect(cells(rows[0]!)[0]).toBe('Datum')
    expect(rows[4]).toBe(EXPORT_DISCLAIMER)

    expect(cells(rows[1]!)[0]).toBe('08.09.2026.')
    expect(cells(rows[2]!)[0]).toBe('08.09.2026.')
    expect(cells(rows[3]!)[0]).toBe('09.09.2026.')

    // Oldest first: the 20:00 Sarajevo shift above the 00:10 one.
    expect(cells(rows[1]!)[1]).toBe('20:00')
    expect(cells(rows[2]!)[1]).toBe('00:10')

    // And the numbers are the page's own numbers.
    const summary = ownerShiftSummary(f.db, f.venueId, first, `${DAY_B}T23:00:00Z`)
    expect(cells(rows[1]!)[3]).toBe(csvAmount(summary.promet_fen))
    expect(cells(rows[1]!)[4]).toBe(csvAmount(summary.cash_fen))
    expect(second).toBeTruthy()
    expect(third).toBeTruthy()
  })

  it('leaves Razlika empty for a night nobody counted, rather than writing 0,00', () => {
    twoNights()
    const rows = lines(exportShifts(f.db, f.venueId, DAY_A, DAY_A, `${DAY_B}T23:00:00Z`).text)
    // A zero would read as "the drawer balanced". An empty cell reads as
    // "nobody counted it", which is the truth.
    expect(cells(rows[1]!)[8]).toBe('')
  })

  it('is a header and a disclaimer and nothing else on a period with no shifts', () => {
    const rows = lines(exportShifts(f.db, f.venueId, '2020-01-01', '2020-01-31').text)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toBe(EXPORT_DISCLAIMER)
  })
})

// ===========================================================================
// dnevni_pazar.csv
// ===========================================================================

describe('dnevni_pazar.csv', () => {
  it('folds the two shifts of one night into one row, and equals smjene.csv', () => {
    twoNights()
    const now = `${DAY_B}T23:00:00Z`

    const daily = lines(exportDailyRevenue(f.db, f.venueId, DAY_A, DAY_B, now).text)
    const shifts = lines(exportShifts(f.db, f.venueId, DAY_A, DAY_B, now).text)

    // header + two days + the disclaimer
    expect(daily).toHaveLength(4)
    expect(daily[3]).toBe(EXPORT_DISCLAIMER)

    const dayA = cells(daily[1]!)
    expect(dayA[0]).toBe('08.09.2026.')
    expect(dayA[1]).toBe('2')

    // The whole point of the file: the day is the sum of its shifts, to the fen.
    const fen = (text: string) => Math.round(Number(text.replace(',', '.')) * 100)
    const promet = fen(cells(shifts[1]!)[3]!) + fen(cells(shifts[2]!)[3]!)
    expect(dayA[2]).toBe(csvAmount(promet))

    const cash = fen(cells(shifts[1]!)[4]!) + fen(cells(shifts[2]!)[4]!)
    expect(dayA[3]).toBe(csvAmount(cash))
  })

  it('keeps the diacritics in its own header', () => {
    const rows = lines(exportDailyRevenue(f.db, f.venueId, DAY_A, DAY_A).text)
    expect(cells(rows[0]!)).toContain('Nenaplaćeno')
  })
})

// ===========================================================================
// stavke.csv
// ===========================================================================

describe('stavke.csv', () => {
  it('is one row per line item, with initials and never a full name by default', () => {
    twoNights()
    const rows = lines(exportLines(f.db, f.venueId, DAY_A, DAY_B, {}, `${DAY_B}T23:00:00Z`).text)

    // header + (2 Kafa lines are one row: qty 2) 1 + 1 + 2 + the disclaimer
    expect(rows).toHaveLength(6)
    expect(rows[5]).toBe(EXPORT_DISCLAIMER)

    const dino = f.db.select({ initials: schema.users.initials })
      .from(schema.users).where(eq(schema.users.id, f.userId('Dino'))).get()!

    const body = rows.slice(1, 5).map(cells)
    const konobari = body.map(row => row[2])
    expect(konobari).toContain(dino.initials)
    // Per-person money does not leave the laptop under somebody's full name
    // unless the owner asks for it.
    expect(rows.join('\n')).not.toContain('Dino')
  })

  it('writes full names only when the toggle says so', () => {
    twoNights()
    const rows = lines(
      exportLines(f.db, f.venueId, DAY_A, DAY_B, { fullNames: true }, `${DAY_B}T23:00:00Z`).text,
    )
    expect(rows.join('\n')).toContain('Dino')
  })

  it('keeps č, ž and đ intact — the item, its aroma and its status', () => {
    twoNights()
    const text = exportLines(f.db, f.venueId, DAY_B, DAY_B, {}, `${DAY_B}T23:00:00Z`).text

    expect(text).toContain('Sok od narandže')
    expect(text).toContain('Al Fakher · Grožđe')
    // Colour never carries a status on screen and a status is never a colour in
    // a file either: the word is written out, in Bosnian.
    expect(text).toContain('gratis')
    expect(text).toContain('naplaćeno')
  })
})

// ===========================================================================
// popis.csv
// ===========================================================================

describe('popis.csv', () => {
  it('is one row per count line, with the variance and what it is worth', () => {
    f.openShift({ members: ['Emir'], at: `${DAY_A}T18:00:00Z`, businessDate: DAY_A })
    const count = f.submitCount('Emir', ['Red Bull', 'Coca-Cola 0,25 l'], { kind: 'full', phase: 'close' })

    const file = exportCount(f.db, f.venueId, count.countId)
    expect(file.filename).toBe('popis.csv')

    const rows = lines(file.text)
    expect(rows).toHaveLength(4)
    expect(rows[3]).toBe(EXPORT_DISCLAIMER)

    // Sorted by article name, so two exports of one count are the same file.
    expect(cells(rows[1]!)[0]).toBe('Coca-Cola 0,25 l')
    const first = cells(rows[2]!)
    expect(first[0]).toBe('Red Bull')
    expect(first[1]).toBe('kom')
    expect(first[2]).toBe('10')   // izbrojano
    expect(first[3]).toBe('12')   // teoretski
    expect(first[4]).toBe('-2')   // razlika
    expect(first[5]).toBe('-0,02') // vrijednost razlike
  })

  it('quotes a note that carries a semicolon or a quote', () => {
    f.openShift({ members: ['Emir'], at: `${DAY_A}T18:00:00Z`, businessDate: DAY_A })
    const count = f.submitCount('Emir', ['Red Bull'])

    // `stock_count_lines` is append-only — a trigger refuses an UPDATE of
    // `note` — so the noted line is inserted rather than edited. That is also
    // how the real *Popis* form writes it: the whole count arrives in one POST.
    f.db.insert(schema.stockCountLines).values({
      id: randomUUID(),
      venueId: f.venueId,
      countId: count.countId,
      stockItemId: f.stockItemId('Voda 0,5 l'),
      countedQty: 8,
      theoreticalQty: 10,
      varianceQty: -2,
      unitCostMfen: 45_000,
      varianceFen: -90,
      note: 'pukla; rekao "dvije"',
    }).run()

    const text = exportCount(f.db, f.venueId, count.countId).text
    expect(text).toContain('"pukla; rekao ""dvije"""')
    // …and the quoted note is still one cell: header + two lines + disclaimer.
    expect(lines(text)).toHaveLength(4)
  })
})

// ===========================================================================
// The period, the headers and the routes
// ===========================================================================

describe('the export period', () => {
  it('defaults to the business date, so 02:30 exports last night', () => {
    // 00:30 Sarajevo on the 9th is still the business day of the 8th.
    const period = exportPeriod(f.db, f.venueId, undefined, undefined, `${DAY_B}T00:30:00Z`)
    expect(period).toEqual({ from: DAY_A, to: DAY_A })
  })

  it('sorts a range that was typed backwards instead of refusing it', () => {
    expect(exportPeriod(f.db, f.venueId, DAY_B, DAY_A)).toEqual({ from: DAY_A, to: DAY_B })
  })
})

describe('the download headers', () => {
  it('names the file with an underscore even though the path has a hyphen', () => {
    const headers = csvHeaders(exportDailyRevenue(f.db, f.venueId, DAY_A, DAY_A))
    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8')
    expect(headers['Content-Disposition']).toBe('attachment; filename="dnevni_pazar.csv"')
    // A re-export after a correction must not come out of the browser cache.
    expect(headers['Cache-Control']).toBe('private, no-store')
    expect(EXPORTS['dnevni-pazar'].path).toBe('/api/owner/export/dnevni-pazar')
  })
})

describe('the four routes', () => {
  it('are declared owner-only in ROUTE_ROLES — an undeclared route is a dead one', () => {
    for (const key of EXPORT_ORDER) {
      expect(ROUTE_ROLES[routeKey('GET', EXPORTS[key].path)]).toEqual(['admin'])
    }
  })

  it('builds the URL the Izvoz page links to, filters included', () => {
    expect(exportUrl('smjene', { from: DAY_A, to: DAY_B }))
      .toBe('/api/owner/export/smjene?from=2026-09-08&to=2026-09-09')
    expect(exportUrl('stavke', { from: DAY_A, to: DAY_A, full_names: true }))
      .toBe('/api/owner/export/stavke?from=2026-09-08&to=2026-09-08&full_names=1')
    expect(exportUrl('popis', { count_id: 'abc' })).toBe('/api/owner/export/popis?count_id=abc')
    expect(exportUrl('popis')).toBe('/api/owner/export/popis')
  })
})

describe('every file', () => {
  it('ends with the disclaimer — Šank is not a fiscal device', () => {
    const { third } = twoNights()
    const count = f.submitCount('Dino', ['Red Bull'])
    expect(third).toBeTruthy()

    const files = [
      exportShifts(f.db, f.venueId, DAY_A, DAY_B),
      exportDailyRevenue(f.db, f.venueId, DAY_A, DAY_B),
      exportLines(f.db, f.venueId, DAY_A, DAY_B),
      exportCount(f.db, f.venueId, count.countId),
    ]

    for (const file of files) {
      expect(file.text.startsWith('﻿')).toBe(true)
      expect(file.text.endsWith(`${EXPORT_DISCLAIMER}\r\n`)).toBe(true)
      // CRLF everywhere, never a bare LF that Excel would run together.
      expect(file.text.replace(/\r\n/g, '')).not.toContain('\n')
    }
  })
})
