/**
 * `shared/collate.ts` — the sort order that does not change between runtimes.
 *
 * The two pairs asserted first are not decoration: they are the exact two
 * option pairs whose SSR/client DOM diff made `/a/dnevnik` log a Vue hydration
 * mismatch on every load. `localeCompare(…, 'bs')` gives one answer on Node
 * (full ICU, real Bosnian collation) and the opposite in Chromium (no 'bs'
 * data, falls back to en-US), so the *Vrsta* dropdown rendered in one order and
 * hydrated in another.
 */
import { describe, expect, it } from 'vitest'
import { bsCompare, bsKey } from '#shared/collate'

describe('bsCompare', () => {
  it('orders the two pairs that made /a/dnevnik mismatch', () => {
    expect(bsCompare('Slika uklonjena', 'Šablon smjene promijenjen')).toBeLessThan(0)
    expect(bsCompare('Popis potvrđen', 'Popis potvrdio svjedok')).toBeGreaterThan(0)
  })

  it('puts the Bosnian letters where the alphabet does', () => {
    expect(bsCompare('cvijet', 'čaša')).toBeLessThan(0)
    expect(bsCompare('čaša', 'ćevap')).toBeLessThan(0)
    expect(bsCompare('dan', 'đak')).toBeLessThan(0)
    expect(bsCompare('sok', 'šećer')).toBeLessThan(0)
    expect(bsCompare('zid', 'žito')).toBeLessThan(0)
    // …and ž stays last rather than landing next to d because of the dž pair.
    expect(bsCompare('žito', 'voda')).toBeGreaterThan(0)
  })

  it('ignores case and is its own inverse', () => {
    expect(bsCompare('Čaj', 'čaj')).toBe(0)
    for (const [a, b] of [['Amar', 'Emir'], ['šećer', 'sok'], ['žito', 'Ana']]) {
      expect(bsCompare(a!, b!)).toBe(-bsCompare(b!, a!))
    }
  })

  it('gives a deterministic key for characters outside the alphabet', () => {
    expect(bsKey('a')).toBe(bsKey('A'))
    expect(bsKey('9')).toBe(bsKey('9'))
    expect(bsCompare('Roba · popis', 'Roba · popis')).toBe(0)
  })

  it('is a total order, so a sort is stable across runtimes', () => {
    const words = ['žito', 'Ana', 'ćevap', 'čaj', 'đak', 'dan', 'šećer', 'sok', 'cvijet']
    expect([...words].sort(bsCompare)).toEqual(
      ['Ana', 'cvijet', 'čaj', 'ćevap', 'dan', 'đak', 'sok', 'šećer', 'žito'],
    )
  })
})
