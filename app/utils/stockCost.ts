/**
 * A stock item's purchase cost, as the owner types it and as the server stores it.
 *
 * The server keeps `last_cost_mfen`: **milli-feninga per base unit** — a
 * thousandth of a fening — because a gram of tobacco costs a fraction of one.
 * Nobody reads an invoice that way. It says "gajba 28,80 KM" or "1 kg 240,00 KM",
 * so the article sheet asks for the price of the thing the paper prices and this
 * file turns it into the stored number and back.
 *
 * The quantity the typed price is for (`costBasis`):
 *
 * - **the pack**, when the article has one — the line an invoice actually has;
 * - otherwise **one piece** for `kom`;
 * - otherwise **a kilogram or a litre** for `g` / `ml`, where one unit would be
 *   a price of 0,02 KM that rounds away.
 *
 * Pure and in `app/utils/`, so it is auto-imported by Nuxt and testable in Node.
 */
import { formatKm } from '#shared/money'
import type { StockItemAdmin } from '#shared/types'

type BaseUnit = StockItemAdmin['base_unit']
type StockKind = StockItemAdmin['kind']

export const STOCK_KIND_OPTIONS: ReadonlyArray<{ value: StockKind, label: string }> = [
  { value: 'pice', label: 'Piće' },
  { value: 'duhan', label: 'Duhan' },
  { value: 'zar', label: 'Žar' },
  { value: 'potrosni', label: 'Potrošni' },
  { value: 'hrana', label: 'Hrana' },
]

export const BASE_UNIT_OPTIONS: ReadonlyArray<{ value: BaseUnit, label: string }> = [
  { value: 'kom', label: 'komad' },
  { value: 'g', label: 'gram' },
  { value: 'ml', label: 'mililitar' },
]

export function stockKindLabel(kind: StockKind): string {
  return STOCK_KIND_OPTIONS.find(option => option.value === kind)?.label ?? kind
}

export interface CostBasis {
  /** How many base units the typed price is for. */
  qty: number
  /** Beside a price: "po kom", "po kg", "gajba · 24 kom". */
  label: string
}

export function costBasis(
  unit: BaseUnit, packName: string | null | undefined, packQty: number | null | undefined,
): CostBasis {
  const pack = packName?.trim()
  if (pack && packQty && packQty > 0) return { qty: packQty, label: `${pack} · ${packQty} ${unit}` }
  if (unit === 'g') return { qty: 1000, label: 'po kg' }
  if (unit === 'ml') return { qty: 1000, label: 'po l' }
  return { qty: 1, label: 'po kom' }
}

/**
 * The price of `qty` base units, in feninga → milli-feninga per base unit.
 * Never below 1: a cost that rounds to zero is the cost the server refuses
 * (`COST_REQUIRED`), and it would be refusing a real price.
 */
export function mfenFromFen(fen: number, qty: number): number {
  if (fen <= 0 || qty <= 0) return 0
  return Math.max(1, Math.round((fen * 1000) / qty))
}

/** The stored per-unit cost → the price of `qty` base units, in feninga. */
export function fenFromMfen(mfen: number, qty: number): number {
  if (mfen <= 0 || qty <= 0) return 0
  return Math.round((mfen * qty) / 1000)
}

/** "28,80 KM · gajba · 24 kom" — or `—` for an article nobody has priced yet. */
export function stockCostText(item: Pick<StockItemAdmin, 'last_cost_mfen' | 'base_unit' | 'pack_name' | 'pack_qty'>): string {
  if (item.last_cost_mfen <= 0) return '—'
  const basis = costBasis(item.base_unit, item.pack_name, item.pack_qty)
  return `${formatKm(fenFromMfen(item.last_cost_mfen, basis.qty))} ${basis.label}`
}
