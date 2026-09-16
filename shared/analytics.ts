/**
 * *Analitika* — the month, as the owner reads it (16.09.2026).
 *
 * The arithmetic that both the server and the screen need lives here, once:
 * which costs there are, where each one comes from, and the one subtraction the
 * whole page leads to —
 *
 *     Ukupan pazar − Neplaćeno − Troškovi = Ostaje
 *
 * **Neplaćeno** is what was rung up and never paid for, by design: *Otpis*,
 * *Rashod*, *Policija*, *Osoblje*. Those rounds are in the pazar (that is what
 * moved the stock), but no money came in for them, so a profit line that kept
 * them would count takings that never existed.
 *
 * **Troškovi** are what the month cost: the goods out of *Prijem robe*, the day
 * wages, the payouts the šanker made from the till that are not goods (*Kafa*,
 * *Merkator*, *Dodatna plaćanja*), and the three bills the owner types.
 *
 * **Why goods come from *Prijem robe* and not from the closings' *Plaćanje
 * robe / okusa / žara*.** Both describe the same crates — one as delivered, one
 * as paid out of the till — and taking both would subtract every crate twice.
 * The delivery is the one that exists for every crate, however it was paid.
 */

/** Every cost line, in the order the page lists them. */
export const MONTH_COST_KEYS = [
  'roba', 'okusi', 'zar', 'kafa', 'merkator', 'dodatna', 'dnevnice', 'struja', 'voda', 'kirija',
] as const
export type MonthCostKey = (typeof MONTH_COST_KEYS)[number]

/** The three the owner types; the rest the server reads out of the ledger. */
export const MANUAL_COST_KINDS = ['struja', 'voda', 'kirija'] as const
export type ManualCostKind = (typeof MANUAL_COST_KINDS)[number]

export const MONTH_COST_LABELS: Record<MonthCostKey, string> = {
  roba: 'Roba',
  okusi: 'Okusi',
  zar: 'Žar',
  kafa: 'Kafa',
  merkator: 'Merkator',
  dodatna: 'Dodatna plaćanja',
  dnevnice: 'Dnevnice',
  struja: 'Struja',
  voda: 'Voda',
  kirija: 'Kirija',
}

/** Where a line's number comes from — the small print under it. */
export const MONTH_COST_SOURCES: Record<MonthCostKey, string> = {
  roba: 'Iz prijema robe',
  okusi: 'Iz prijema robe',
  zar: 'Iz prijema robe',
  kafa: 'Plaćeno iz kase, iz zaključenih smjena',
  merkator: 'Plaćeno iz kase, iz zaključenih smjena',
  dodatna: 'Plaćeno iz kase, iz zaključenih smjena',
  dnevnice: 'Iz zaključenih smjena',
  struja: 'Unosi se ručno',
  voda: 'Unosi se ručno',
  kirija: 'Fiksno, prenosi se svaki mjesec',
}

/**
 * Which cost a delivered stock item is, by its `kind`.
 *
 * `duhan` is what a bowl is filled with — the flavours — and `zar` is the coal.
 * Everything else a delivery brings (drinks, consumables, food) is *Roba*, so a
 * kind added tomorrow lands somewhere visible instead of nowhere.
 */
export function costKeyOfStockKind(kind: string): 'roba' | 'okusi' | 'zar' {
  if (kind === 'duhan') return 'okusi'
  if (kind === 'zar') return 'zar'
  return 'roba'
}

/**
 * What was rung up and paid for by nobody — the four reasons a tab may close
 * authorised (`AUTHORISED_UNPAID_REASONS`), in the order *Zaključi smjenu*
 * lists them.
 */
export const UNPAID_KEYS = ['otpis', 'rashod', 'policija', 'osoblje'] as const
export type UnpaidKey = (typeof UNPAID_KEYS)[number]

export const UNPAID_LABELS: Record<UnpaidKey, string> = {
  otpis: 'Otpis',
  rashod: 'Rashod',
  policija: 'Policija',
  osoblje: 'Osoblje',
}

/** Σ of the four. */
export function totalUnpaidFen(unpaid: Record<UnpaidKey, number>): number {
  return UNPAID_KEYS.reduce((sum, key) => sum + unpaid[key], 0)
}

/** Σ of every cost line. */
export function totalCostFen(costs: Record<MonthCostKey, number>): number {
  return MONTH_COST_KEYS.reduce((sum, key) => sum + costs[key], 0)
}

/** `YYYY-MM`, and nothing looser. */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** The month a business day belongs to: `"2026-09-14"` → `"2026-09"`. */
export function monthOf(businessDay: string): string {
  return businessDay.slice(0, 7)
}

/** `"2026-09"` → `"2026-08"`, across the year boundary too. */
export function addMonths(month: string, n: number): string {
  const [year, mon] = month.split('-').map(Number)
  const d = new Date(Date.UTC(year!, mon! - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** How many days the month has. */
export function daysInMonth(month: string): number {
  const [year, mon] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, mon!, 0)).getUTCDate()
}

const MONTHS_BS = [
  'Januar', 'Februar', 'Mart', 'April', 'Maj', 'Juni',
  'Juli', 'August', 'Septembar', 'Oktobar', 'Novembar', 'Decembar',
]

/** `"2026-09"` → `"Septembar 2026."` */
export function monthLabelBs(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  return `${MONTHS_BS[mon! - 1]} ${year}.`
}

/** `"2026-09"` → `"Sep"`, for a bar under a chart. */
export function monthShortBs(month: string): string {
  const mon = Number(month.slice(5, 7))
  return MONTHS_BS[mon - 1]!.slice(0, 3)
}
