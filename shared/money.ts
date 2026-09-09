/**
 * Money in Šank is an integer number of feninga (1 KM = 100 feninga), never a
 * float. `12.30` cannot be stored exactly in binary floating point, so a column
 * of prices that looks right adds up to 0.01 KM wrong; integers cannot drift.
 *
 * Formatting is written by hand rather than taken from `Intl.NumberFormat`,
 * because ICU output has varied between Node builds (space vs non-breaking
 * space, "KM" vs "BAM") and this string appears on every screen in the app.
 */

/** The character between the number and "KM": U+00A0, so the two never wrap apart. */
const NBSP = ' '

/**
 * `125050` → `"1.250,50 KM"` (Bosnian convention: dot groups thousands, comma
 * separates the decimals, non-breaking space before the currency).
 */
export function formatKm(fen: number): string {
  return `${formatAmount(fen)}${NBSP}KM`
}

/** The same number without the "KM" suffix — for inputs and table cells. */
export function formatAmount(fen: number): string {
  const rounded = Math.round(fen)
  const sign = rounded < 0 ? '-' : ''
  const abs = Math.abs(rounded)

  const marka = Math.floor(abs / 100)
  const feninga = abs % 100

  return `${sign}${groupThousands(marka)},${String(feninga).padStart(2, '0')}`
}

/** `1250` → `"1.250"`. */
function groupThousands(n: number): string {
  const digits = String(n)
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    // Insert the separator before every digit whose distance from the end is a
    // non-zero multiple of three.
    const fromEnd = digits.length - i
    if (i > 0 && fromEnd % 3 === 0) out += '.'
    out += digits[i]
  }
  return out
}

/**
 * `"1.250,50 KM"` → `125050`, and so does `"1250.50"`, `"1250,5"`, `"1250"`.
 * Returns `null` for anything it cannot read, so a caller must decide what an
 * unreadable amount means — it never guesses zero.
 *
 * Both separators are accepted because a phone keyboard offers whichever it
 * likes and a waiter types whichever he has: PLAN.md §5 "decimal inputs accept
 * `,` and `.`".
 */
export function parseKm(input: string): number | null {
  const cleaned = input
    .replace(/km/gi, '')
    .replace(/[\s ]/g, '')
    .trim()
  if (cleaned === '') return null

  const sign = cleaned.startsWith('-') ? -1 : 1
  let body = cleaned.replace(/^[+-]/, '')
  if (!/^[\d.,]+$/.test(body)) return null

  const hasComma = body.includes(',')
  const hasDot = body.includes('.')

  if (hasComma && hasDot) {
    // "1.250,50" — the comma is the decimal mark, the dots group thousands.
    body = body.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    body = body.replace(',', '.')
  } else if (hasDot) {
    // Ambiguous: "1.250" is one thousand two hundred fifty, "12.50" is twelve
    // and a half. Groups of exactly three after every dot mean thousands.
    if (/^\d{1,3}(\.\d{3})+$/.test(body)) body = body.replace(/\./g, '')
  }

  const value = Number(body)
  if (!Number.isFinite(value)) return null
  return sign * Math.round(value * 100)
}

/** `2.5, 'g'` → `"2,5 g"`. Quantities are REAL in base units, unlike money. */
export function formatQty(qty: number, unit?: string): string {
  const rounded = Math.round(qty * 1000) / 1000
  const text = String(rounded).replace('.', ',')
  return unit ? `${text}${NBSP}${unit}` : text
}
