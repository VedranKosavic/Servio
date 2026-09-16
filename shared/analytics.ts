/**
 * *Analitika* — the month, as the owner reads it (16.09.2026).
 *
 * The arithmetic that both the server and the screen need lives here, once:
 * which costs there are, where each one comes from, and the one subtraction the
 * whole page leads to —
 *
 *     Ukupan pazar − (Roba + Okusi + Žar + Dnevnice + Struja + Voda + Kirija)
 *
 * **Gross pazar, not *Za predati*.** *Za predati* is what the šanker handed over
 * after paying suppliers out of the till; subtracting the month's goods from it
 * again would count the same crate twice. The month's pazar is every round the
 * café rang up, and the costs are what the month cost — a plain profit line.
 */

/** Every cost line, in the order the page lists them. */
export const MONTH_COST_KEYS = [
  'roba', 'okusi', 'zar', 'dnevnice', 'struja', 'voda', 'kirija',
] as const
export type MonthCostKey = (typeof MONTH_COST_KEYS)[number]

/** The three the owner types; the rest the server reads out of the ledger. */
export const MANUAL_COST_KINDS = ['struja', 'voda', 'kirija'] as const
export type ManualCostKind = (typeof MANUAL_COST_KINDS)[number]

export const MONTH_COST_LABELS: Record<MonthCostKey, string> = {
  roba: 'Roba',
  okusi: 'Okusi',
  zar: 'Žar',
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
