/**
 * The two bits of language the order screens share.
 *
 * They live beside the components rather than in a composable because they are
 * pure functions of a string — no Vue, no state, nothing to hydrate — and both
 * S2 and S3 need the same answers to the same two questions.
 */

/** 1 stavka · 2–4 stavke · 5+ stavki — the three buckets Bosnian counts in. */
export function stavke(n: number): string {
  const ones = n % 10
  const tens = n % 100
  if (ones === 1 && tens !== 11) return `${n} stavka`
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return `${n} stavke`
  return `${n} stavki`
}

/**
 * Fold a word down to what a thumb actually types: lower case, no diacritics.
 *
 * A waiter typing "caj" at 23:40 means *Čaj*, and "sok od narandze" means *Sok
 * od narandže*. `normalize('NFD')` splits every accented letter into its base
 * letter plus a combining mark, and the regex then drops the marks — so č → c,
 * ž → z, đ → d (that last one is not a combining pair in Unicode, hence the
 * explicit replace beside it).
 */
export function fold(text: string): string {
  return text
    .toLocaleLowerCase('bs')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
}

/**
 * Does this product match what has been typed? **Prefix**, not substring, and
 * per word: "co" finds *Coca-Cola*, "ola" does not — a substring match on a
 * two-letter query turns a menu into noise. The words searched are the name,
 * the short name and every alias, which is how "kola" finds Coca-Cola without
 * "kola" being anybody's name.
 */
export function matchesQuery(
  product: { name: string, short_name: string | null, search_aliases: string },
  query: string,
): boolean {
  const q = fold(query).trim()
  if (q === '') return true
  const haystack = fold(`${product.name} ${product.short_name ?? ''} ${product.search_aliases}`)
  return haystack.split(/[\s·,\-/]+/).some(word => word.startsWith(q))
}
