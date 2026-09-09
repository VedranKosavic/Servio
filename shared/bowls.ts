/**
 * The bowl rule — one place, because three screens and two reports count bowls
 * and they must all count the same thing.
 *
 * A *lula* (bowl) is a line whose product is `kind: 'shisha'`. That is the whole
 * rule, and the two edges it gets right are the ones the owner cares about:
 *
 *   - *Nova lula* — a fresh bowl on a running shisha — **is** a bowl. It is
 *     charged, it burns its own 20 g of tobacco, and it takes no new coal.
 *   - *Dodatni žar* — two more coals on a bowl already going — is **not** a
 *     bowl. It is a `simple` product with a coal recipe and a `parent_line_id`
 *     pointing at the bowl it tops up. Counting it would inflate *prodano lula*
 *     and make grams-per-bowl look far too low.
 *
 * `qty` counts: one line of 2 × Nargila is two bowls.
 */
import type { ProductKind } from './types'

export interface BowlLine {
  kind: ProductKind
  qty: number
  /** Set on a *Dodatni žar* row: the bowl it tops up. */
  parent_line_id?: string | null
}

/** Is this line a bowl? */
export function isBowl(line: Pick<BowlLine, 'kind'>): boolean {
  return line.kind === 'shisha'
}

/** *Prodano lula* over a set of lines. */
export function countBowls(lines: BowlLine[]): number {
  return lines.reduce((n, line) => (isBowl(line) ? n + line.qty : n), 0)
}

/**
 * Grams of tobacco per bowl — the owner's monthly sanity check on whether the
 * tins are emptying faster than the bowls are being sold.
 *
 * `null` when nothing was sold: a division by zero is not "0 g per bowl", it is
 * "no answer", and a screen showing 0,0 g would read as a catastrophe.
 */
export function gramsPerBowl(tobaccoG: number, bowls: number): number | null {
  if (bowls <= 0) return null
  return Math.round((tobaccoG / bowls) * 10) / 10
}

/**
 * Is the measured grams-per-bowl inside the venue's band around the norm?
 * `bandPct` of 15 around a 20 g norm accepts 17,0–23,0 g.
 */
export function gpbWithinBand(
  actual: number | null,
  expected: number,
  bandPct: number,
): boolean {
  if (actual === null) return true
  const slack = (expected * bandPct) / 100
  return Math.abs(actual - expected) <= slack
}

/**
 * How the tobacco of one bowl is split across the aromas the guest chose:
 * 20 g over two aromas is 10 g + 10 g (PLAN §9, the owner's own formula).
 * Returns grams **per flavour**, still positive — the caller makes it a negative
 * movement.
 */
export function gramsPerFlavour(shishaGrams: number, qty: number, flavours: number): number {
  if (flavours <= 0) return 0
  return (shishaGrams * qty) / flavours
}
