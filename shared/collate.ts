/**
 * Bosnian alphabetical order, computed the same way in Node and in the browser.
 *
 * `localeCompare(x, y, 'bs')` **cannot** be used in code that renders on both
 * sides. Node ships full ICU and resolves `'bs'` to real Bosnian collation;
 * Chromium has no Bosnian data and silently falls back to `en-US`. The two
 * disagree about č/ć/đ/š/ž, so a list sorted that way comes out of the server
 * in one order and hydrates in another — which Vue reports as a hydration
 * mismatch, not as a cosmetic difference. Measured: on Node
 * `'Slika uklonjena'.localeCompare('Šablon smjene promijenjen', 'bs')` is -1 and
 * in Chromium it is +1.
 *
 * So we do not ask either runtime for a locale: `bsKey` turns a string into a
 * sort key using one table that both runtimes read identically.
 *
 * The table is per **character**. The digraphs dž, lj and nj are therefore
 * ranked as d+ž, l+j and n+j rather than as letters of their own, which real
 * Bosnian collation would do. That is a deliberate trade: the lists this sorts
 * are short label menus where the difference never shows, and an identical
 * order on both sides is the whole point. Server-only sorting (the roster, the
 * reports, the exports) runs in one runtime and may keep using `localeCompare`.
 */

/** Lower/upper pairs; the index >> 1 is the letter's rank. */
const BS_ORDER = 'aAbBcCčČćĆdDđĐeEfFgGhHiIjJkKlLmMnNoOpPrRsSšŠtTuUvVzZžŽ'

const RANK = new Map<string, number>()
for (let i = 0; i < BS_ORDER.length; i++) RANK.set(BS_ORDER[i]!, i >> 1)

/**
 * A comparable key: every Bosnian letter becomes one code point in alphabet
 * order, and anything else (a digit, a space, `·`) keeps its own identity
 * behind a sentinel so it sorts after the letters — deterministically, which is
 * all the hydration needs.
 */
export function bsKey(s: string): string {
  let out = ''
  for (const ch of s.toLowerCase()) {
    const rank = RANK.get(ch)
    out += rank === undefined ? '￿' + ch : String.fromCharCode(0x100 + rank)
  }
  return out
}

/** `Array.prototype.sort` comparator for Bosnian labels. */
export function bsCompare(a: string, b: string): number {
  const ka = bsKey(a)
  const kb = bsKey(b)
  return ka < kb ? -1 : ka > kb ? 1 : 0
}
