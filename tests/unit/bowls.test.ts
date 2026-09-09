/**
 * The bowl rule. Three screens and two reports count bowls; if they disagree,
 * the owner's grams-per-bowl check is meaningless.
 */
import { describe, expect, it } from 'vitest'
import { countBowls, gpbWithinBand, gramsPerBowl, gramsPerFlavour, isBowl } from '#shared/bowls'

describe('what counts as a bowl', () => {
  it('counts a nargila and a *Nova lula*', () => {
    // *Nova lula* is a fresh bowl on a running shisha: charged, its own tobacco,
    // no new coal. It is a bowl.
    expect(isBowl({ kind: 'shisha' })).toBe(true)
  })

  it('does not count *Dodatni žar*', () => {
    // Two more coals on a bowl already going. Counting it would inflate
    // *prodano lula* and make grams-per-bowl look far too low.
    expect(isBowl({ kind: 'simple' })).toBe(false)
  })

  it('counts quantity, not lines', () => {
    expect(countBowls([
      { kind: 'shisha', qty: 2 },
      { kind: 'shisha', qty: 1 },
      { kind: 'simple', qty: 3, parent_line_id: 'a-bowl' },
      { kind: 'simple', qty: 5 },
    ])).toBe(3)
  })

  it('is zero on a night with no shisha', () => {
    expect(countBowls([{ kind: 'simple', qty: 4 }])).toBe(0)
  })
})

describe('grams per bowl', () => {
  it('is the owner\'s monthly check', () => {
    // 11 000 g over 500 bowls is 22 g a bowl against a 20 g norm.
    expect(gramsPerBowl(11_000, 500)).toBe(22)
  })

  it('rounds to one decimal', () => {
    expect(gramsPerBowl(1000, 47)).toBe(21.3)
  })

  it('is null and not zero when nothing was sold', () => {
    // A screen showing 0,0 g would read as a catastrophe. "No answer" is the
    // honest answer to a division by zero.
    expect(gramsPerBowl(500, 0)).toBeNull()
  })

  it('accepts anything inside the band and flags what is outside', () => {
    // 15 % around 20 g accepts 17,0–23,0.
    expect(gpbWithinBand(22, 20, 15)).toBe(true)
    expect(gpbWithinBand(17, 20, 15)).toBe(true)
    expect(gpbWithinBand(26, 20, 15)).toBe(false)
    expect(gpbWithinBand(12, 20, 15)).toBe(false)
    // Nothing to judge is not a failure.
    expect(gpbWithinBand(null, 20, 15)).toBe(true)
  })
})

describe('a mixed bowl', () => {
  it('splits the venue norm evenly across the aromas', () => {
    // 20 g over two aromas is 10 g + 10 g (PLAN §9, the owner's own formula).
    expect(gramsPerFlavour(20, 1, 2)).toBe(10)
    expect(gramsPerFlavour(20, 2, 2)).toBe(20)
    expect(gramsPerFlavour(20, 1, 3)).toBeCloseTo(6.667, 3)
  })

  it('takes nothing when no aroma was chosen', () => {
    expect(gramsPerFlavour(20, 1, 0)).toBe(0)
  })
})
