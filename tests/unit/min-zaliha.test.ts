/**
 * *Minimalna zaliha* — when the shelf turns red (the owner, 16.09.2026).
 *
 * `nisko` is `on_hand <= par_qty`, and it is decided **before** *bez cijene*:
 * reaching the minimum is what the owner watches for, so an article with a
 * missing price record must still turn red when it runs low.
 */
import { describe, expect, it } from 'vitest'
import { stockStatus } from '../../server/services/stock'

const priced = { avgCostMfen: 1_000, lastCostMfen: 1_000, parQty: 10 }
const unpriced = { avgCostMfen: 0, lastCostMfen: 0, parQty: 10 }

describe('stockStatus', () => {
  it('turns red at the minimum, not only under it', () => {
    expect(stockStatus(priced, 11)).toBe('ok')
    expect(stockStatus(priced, 10)).toBe('nisko')
    expect(stockStatus(priced, 3)).toBe('nisko')
  })

  it('says minus before anything else', () => {
    expect(stockStatus(priced, -1)).toBe('u_minusu')
  })

  it('puts the minimum before a missing price', () => {
    expect(stockStatus(unpriced, 5)).toBe('nisko')
    expect(stockStatus(unpriced, 50)).toBe('bez_cijene')
  })

  it('never turns red on an article with no minimum', () => {
    expect(stockStatus({ ...priced, parQty: null }, 0)).toBe('ok')
  })
})
