import { describe, expect, it } from 'vitest'
import { formatAmount, formatKm, parseKm } from '../../shared/money'

// U+00A0. The formatter puts a non-breaking space before "KM" so an amount
// never wraps onto two lines; a plain space here would make the test lie.
const NBSP = ' '

describe('formatKm', () => {
  it('formats the canonical example', () => {
    expect(formatKm(125050)).toBe(`1.250,50${NBSP}KM`)
  })

  it('pads the feninga and groups the thousands', () => {
    expect(formatKm(0)).toBe(`0,00${NBSP}KM`)
    expect(formatKm(5)).toBe(`0,05${NBSP}KM`)
    expect(formatKm(150)).toBe(`1,50${NBSP}KM`)
    expect(formatKm(100000)).toBe(`1.000,00${NBSP}KM`)
    expect(formatKm(123456789)).toBe(`1.234.567,89${NBSP}KM`)
    expect(formatKm(-1250)).toBe(`-12,50${NBSP}KM`)
  })

  it('formatAmount is the same string without the currency', () => {
    expect(formatAmount(125050)).toBe('1.250,50')
  })
})

describe('parseKm', () => {
  it('reads back what formatKm writes', () => {
    for (const fen of [0, 5, 150, 125050, 100000, 123456789]) {
      expect(parseKm(formatKm(fen))).toBe(fen)
    }
  })

  it('accepts both separators, as a phone keyboard offers them', () => {
    expect(parseKm('12,50')).toBe(1250)
    expect(parseKm('12.50')).toBe(1250)
    expect(parseKm('1.250,50')).toBe(125050)
    expect(parseKm('1250')).toBe(125000)
    expect(parseKm('1.250')).toBe(125000)
  })

  it('returns null rather than guessing', () => {
    expect(parseKm('')).toBeNull()
    expect(parseKm('deset')).toBeNull()
  })
})
