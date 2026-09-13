/**
 * How a bowl is mixed — the one rule shared by the waiter's picker, the
 * bartender's ticket and the stock deduction.
 *
 * **A mix is a list with repeats, and that is the whole trick.** `flavours_json`
 * on an order line has always been an array of stock item ids; a bowl of pure
 * *Ice* is `["ice"]` and half and half is `["ice","swiss"]`. Two thirds *Ice*
 * to one third *Swiss* is therefore `["ice","ice","swiss"]` — and nothing in
 * the database, the wire schema or the stock code had to learn a new shape for
 * it, because `resolveStock()` already splits the bowl's grams evenly across
 * the entries of that array. Three entries, one of them twice: twice the grams.
 * The proportion the waiter taps out **is** the proportion that leaves the
 * shelf, by construction rather than by a second calculation that could drift.
 *
 * The cap is three entries (`money.ts`: `.min(1).max(3)`), which is why the
 * mixes a bowl can have are exactly the ones the owner described: one aroma
 * whole, two at halves or at two-to-one, or three at thirds.
 *
 * Nothing here formats money, reads a clock or touches a database, so it runs
 * unchanged on the phone and on the server.
 */

/** One aroma's share of a bowl. `parts` is entries in the list; `pct` rounds it. */
export interface FlavourShare {
  id: string
  /** How many of the list's entries are this aroma. */
  parts: number
  /**
   * `parts / total`, as a whole percent, **for display only**.
   *
   * Three equal thirds round to 33 + 33 + 33 = 99, and that is deliberate: the
   * bar is laid out from `parts` and never from this number, and the label only
   * ever prints a percentage for a mix that is *not* even — where the rounding
   * happens to be exact (67 + 33). A reader who needs the truth has `parts`.
   */
  pct: number
}

/**
 * Fold a flavour list into its shares, in the order the aromas first appear.
 *
 * First appearance rather than most parts: the waiter tapped them in an order
 * and the bowl he is being shown should not reshuffle itself under his thumb
 * when he adds a second part to the second aroma.
 */
export function flavourShares(ids: string[]): FlavourShare[] {
  const parts = new Map<string, number>()
  for (const id of ids) parts.set(id, (parts.get(id) ?? 0) + 1)

  const total = ids.length
  return [...parts.entries()].map(([id, n]) => ({
    id,
    parts: n,
    pct: total === 0 ? 0 : Math.round((n / total) * 100),
  }))
}

/** True when every aroma in the bowl has the same share — one, halves, thirds. */
export function isEvenMix(shares: FlavourShare[]): boolean {
  return shares.every(share => share.parts === shares[0]?.parts)
}

/**
 * What a line says about its bowl: `["Ice", "Swiss"]` for an even mix, and
 * `["Ice 67%", "Swiss 33%"]` when it is not.
 *
 * The percentage appears **only when it carries information**. Every bowl the
 * café has ever sold until tonight was even, so every existing ticket, export
 * and drill-down reads exactly as it did — and the day a waiter packs one two
 * to one, the bartender is told so on the same line, in the same place, without
 * a second field crossing four read models to get there.
 */
export function mixLabels(ids: string[], nameOf: (id: string) => string): string[] {
  const shares = flavourShares(ids)
  const even = isEvenMix(shares)
  return shares.map(share => (even ? nameOf(share.id) : `${nameOf(share.id)} ${share.pct}%`))
}
