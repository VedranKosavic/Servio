/**
 * The bartender screens' formatting: clock, ticket age, stock quantities.
 *
 * Files in `app/utils/` are auto-imported by Nuxt, exactly like composables —
 * no `import` line is needed in a page or a component that calls these.
 *
 * Two house rules live here:
 *   1. Every timestamp in the database is UTC (`nowIso()` on the server). Local
 *      time is a *display* concern, so every clock string is rendered through
 *      `Europe/Sarajevo` — never `new Date().getHours()`, which would read the
 *      device's own zone and show 20:41 on a phone left on German time.
 *   2. Numbers are Bosnian: the decimal separator is a comma, and a minus is
 *      the real minus sign "−" (U+2212), not a hyphen, so "−14 g" lines up in
 *      a column of tabular figures.
 */
import type { BaseUnit, StockLastMovement } from '#shared/types'

const ZONE = 'Europe/Sarajevo'

/**
 * `hourCycle: 'h23'` rather than `hour12: false`: some locales answer the
 * latter with a 24:05 for five past midnight.
 */
const clockFormat = new Intl.DateTimeFormat('bs-BA', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: ZONE,
})

/** "21:41" — a UTC timestamp as the wall clock behind the bar. */
export function clockHm(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return clockFormat.format(date)
}

/** How long a ticket has been waiting, in seconds. Never negative. */
export function ticketAgeSeconds(iso: string, nowMs: number): number {
  const started = new Date(iso).getTime()
  if (Number.isNaN(started)) return 0
  return Math.max(0, Math.round((nowMs - started) / 1000))
}

/** "prije 5 s" while it is fresh, then "čeka 4 min", then "čeka 1 h 12 min". */
export function ticketAge(iso: string, nowMs: number): string {
  const seconds = ticketAgeSeconds(iso, nowMs)
  if (seconds < 60) return `prije ${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `čeka ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `čeka ${hours} h` : `čeka ${hours} h ${rest} min`
}

/**
 * A plain number with a Bosnian decimal comma. Trailing zeros are trimmed down
 * to `minDecimals`, so 4,190 kg reads "4,19 kg" and 15,000 kg reads "15 kg".
 */
function decimalComma(value: number, maxDecimals: number, minDecimals = 0): string {
  let text = value.toFixed(maxDecimals)
  if (maxDecimals > 0) {
    const [whole = '0', fraction = ''] = text.split('.')
    let trimmed = fraction
    while (trimmed.length > minDecimals && trimmed.endsWith('0')) trimmed = trimmed.slice(0, -1)
    text = trimmed.length > 0 ? `${whole}.${trimmed}` : whole
  }
  return text.replace('.', ',')
}

/**
 * On hand, in the unit a bartender thinks in: "78 kom", "2,386 kg", "633 g",
 * "5,0 l", "250 ml". Grams and millilitres climb to kilos and litres at 1000,
 * because "2386 g" is a number nobody can read at a glance.
 */
export function formatStockQty(qty: number, unit: BaseUnit): string {
  const sign = qty < 0 ? '−' : ''
  const abs = Math.abs(qty)
  if (unit === 'g' && abs >= 1000) return `${sign}${decimalComma(abs / 1000, 3)} kg`
  if (unit === 'ml' && abs >= 1000) return `${sign}${decimalComma(abs / 1000, 2, 1)} l`
  return `${sign}${decimalComma(abs, 2)} ${unit}`
}

/**
 * One movement's size: "−14 g", "+24". Pieces carry no unit — "+24" beside a
 * row that already says "kom" is enough.
 */
export function formatMovementQty(delta: number, unit: BaseUnit): string {
  const sign = delta < 0 ? '−' : '+'
  const body = decimalComma(Math.abs(delta), 2)
  return unit === 'kom' ? `${sign}${body}` : `${sign}${body} ${unit}`
}

/**
 * The short middle of a movement chip.
 *
 * The server's `ref_label` is a full sentence — "Sto 7 · narudžba", "prijem
 * robe", "početno stanje". In a chip beside a quantity there is room for one
 * word, and for a sale the useful word is the table.
 */
export function movementShortLabel(movement: StockLastMovement): string {
  switch (movement.type) {
    case 'sale':
      return movement.ref_label.split(' · ')[0] || 'narudžba'
    case 'delivery':
      return 'prijem'
    case 'opening':
      return 'početno'
    default:
      return 'korekcija'
  }
}

/**
 * A typed quantity, Bosnian-style: "2,5" and "2.5" both mean two and a half.
 * Returns null when the field is empty or not a number, so the caller can keep
 * *Proknjiži* disabled instead of posting a NaN.
 */
export function parseDecimalInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (cleaned.length === 0) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}
