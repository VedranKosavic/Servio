/**
 * A stock item's purchase cost, as the owner types it and as the server stores it.
 *
 * The server keeps `last_cost_mfen`: **milli-feninga per base unit** — a
 * thousandth of a fening — because a gram of tobacco costs a fraction of one.
 * Nobody types a price that way, so the article sheet asks for a readable one
 * and this file turns it into the stored number and back.
 *
 * The quantity the typed price is for (`costBasis`) depends on the unit alone:
 *
 * - **one piece** for `kom`;
 * - **a kilogram or a litre** for `g` / `ml`, where one unit would be a price of
 *   0,02 KM that rounds away.
 *
 * **There is no pack.** The owner's call: admins type every quantity in pieces
 * (or grams / millilitres), so a price is never "per gajba" either. The
 * `pack_name` / `pack_qty` columns survive on the server for old rows and are
 * ignored here on purpose.
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
  { value: 'kafa', label: 'Kafa' },
]

/**
 * The owner's three kinds of article (16.09.2026): everything is counted by
 * the piece, except coffee and nargila aromas, which are kept in grams.
 *
 * It is one choice on the form and two columns on the row — `kind` (what the
 * reports and the aroma picker ask) and `base_unit` (what the ledger sums in).
 * Choosing *Po komadu* keeps an older article's own piece kind (žar, hrana,
 * potrošni) rather than flattening it to *piće*.
 */
export type ArticleVrsta = 'komad' | 'kafa' | 'okus' | 'zar'

export const ARTICLE_VRSTA_OPTIONS: ReadonlyArray<{ value: ArticleVrsta, label: string }> = [
  { value: 'komad', label: 'Po komadu' },
  { value: 'kafa', label: 'Kafa (grami)' },
  { value: 'okus', label: 'Okus za nargilu (grami)' },
  // Bought by the kilogram, kept in grams like coffee (the owner, 17.09.2026).
  { value: 'zar', label: 'Žar (grami)' },
]

export function vrstaOf(kind: StockKind, unit: BaseUnit = 'kom'): ArticleVrsta {
  if (kind === 'kafa') return 'kafa'
  if (kind === 'duhan') return 'okus'
  if (kind === 'zar' && unit === 'g') return 'zar'
  return 'komad'
}

export function kindAndUnitOf(
  vrsta: ArticleVrsta, currentKind: StockKind,
): { kind: StockKind, base_unit: BaseUnit } {
  if (vrsta === 'kafa') return { kind: 'kafa', base_unit: 'g' }
  if (vrsta === 'okus') return { kind: 'duhan', base_unit: 'g' }
  if (vrsta === 'zar') return { kind: 'zar', base_unit: 'g' }
  const pieceKind = currentKind === 'kafa' || currentKind === 'duhan' ? 'pice' : currentKind
  return { kind: pieceKind, base_unit: 'kom' }
}

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
  /** Beside a price: "po kom", "po kg", "po l". */
  label: string
}

export function costBasis(unit: BaseUnit): CostBasis {
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

/** "1,20 KM po kom" — or `—` for an article nobody has priced yet. */
export function stockCostText(item: Pick<StockItemAdmin, 'last_cost_mfen' | 'base_unit'>): string {
  if (item.last_cost_mfen <= 0) return '—'
  const basis = costBasis(item.base_unit)
  return `${formatKm(fenFromMfen(item.last_cost_mfen, basis.qty))} ${basis.label}`
}
