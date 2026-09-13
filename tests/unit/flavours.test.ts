/**
 * How a bowl is mixed — and the one identity that makes the shape safe.
 *
 * A mix is `flavour_ids` with repeats: `["ice","ice","swiss"]` is two parts
 * *Ice* to one part *Swiss*. That was chosen over a second column because
 * `resolveStock()` already divides the bowl's grams evenly across the entries
 * of that array, so the proportion the waiter taps out **is** the proportion
 * that leaves the shelf. The last block here is that claim, checked against the
 * real deduction rather than against a comment.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { flavourShares, isEvenMix, mixLabels } from '../../shared/flavours'
import { createOrder } from '../../server/services/orders'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { syncFlavours, TOBACCOS } from '../../server/database/flavours'

describe('flavourShares', () => {
  it('is one whole aroma when the bowl has one', () => {
    expect(flavourShares(['ice'])).toEqual([{ id: 'ice', parts: 1, pct: 100 }])
  })

  it('is halves for two, and two thirds to one for a repeat', () => {
    expect(flavourShares(['ice', 'swiss']).map(s => s.pct)).toEqual([50, 50])
    expect(flavourShares(['ice', 'ice', 'swiss'])).toEqual([
      { id: 'ice', parts: 2, pct: 67 },
      { id: 'swiss', parts: 1, pct: 33 },
    ])
  })

  it('is thirds for three, which is where the owner said three aromas sit', () => {
    expect(flavourShares(['a', 'b', 'c']).map(s => s.pct)).toEqual([33, 33, 33])
  })

  it('keeps the aromas in the order they were first tapped', () => {
    // Not sorted by share: the waiter tapped them in an order, and the bar must
    // not reshuffle under his thumb when he gives the second one another part.
    expect(flavourShares(['swiss', 'ice', 'ice']).map(s => s.id)).toEqual(['swiss', 'ice'])
  })

  it('is nothing at all for an empty bowl', () => {
    expect(flavourShares([])).toEqual([])
  })
})

describe('mixLabels', () => {
  const name = (id: string) => ({ ice: 'Ice', swiss: 'Swiss', baku: 'Baku' }[id] ?? '—')

  it('prints the name alone for every even bowl — one, halves, thirds', () => {
    // Which is every bowl the café has ever sold, so no existing ticket,
    // export or drill-down reads differently than it did.
    expect(mixLabels(['ice'], name)).toEqual(['Ice'])
    expect(mixLabels(['ice', 'swiss'], name)).toEqual(['Ice', 'Swiss'])
    expect(mixLabels(['ice', 'swiss', 'baku'], name)).toEqual(['Ice', 'Swiss', 'Baku'])
  })

  it('prints the share only when the share is news', () => {
    expect(mixLabels(['ice', 'ice', 'swiss'], name)).toEqual(['Ice 67%', 'Swiss 33%'])
  })

  it('says an aroma once, however many parts it has', () => {
    // The bug this replaced: `ids.map(name)` on a repeated id printed "Ice"
    // twice with no hint that the two entries meant one heavier aroma.
    expect(mixLabels(['ice', 'ice'], name)).toEqual(['Ice'])
  })
})

describe('isEvenMix', () => {
  it('is true for an empty bowl, so an unmixed line never prints a percentage', () => {
    expect(isEvenMix(flavourShares([]))).toBe(true)
  })
})

// ===========================================================================

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

describe('a mix is deducted in the proportion it was tapped', () => {
  /**
   * The whole argument for holding a mix as a list with repeats, checked
   * against the real lock rather than against the comment that claims it.
   *
   * *Nargila* is 20 g a bowl in the seed. Two parts *Jabuka* to one part
   * *Menta* must take 13.33 g off the first and 6.67 g off the second — and it
   * must do so without one line of shisha code knowing that proportions exist.
   */
  it('takes two thirds off one aroma and one third off the other', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    expect(shiftId).toBeTruthy()

    const jabuka = f.stockItemId('Al Fakher · Jabuka')
    const menta = f.stockItemId('Al Fakher · Menta')
    const before = (id: string) => onHand(id)

    const jabukaBefore = before(jabuka)
    const mentaBefore = before(menta)

    createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 7'),
      lines: [{
        id: randomUUID(),
        product_id: f.productId('Nargila'),
        qty: 1,
        flavour_ids: [jabuka, jabuka, menta],
      }],
    })

    const grams = f.db.select().from(schema.products).all()
      .find(p => p.name === 'Nargila')!.shishaGrams!

    expect(jabukaBefore - onHand(jabuka)).toBeCloseTo((grams * 2) / 3, 6)
    expect(mentaBefore - onHand(menta)).toBeCloseTo(grams / 3, 6)
  })

  it('still splits an even bowl in half, which is what it always did', () => {
    f.openShift({ members: ['Amar'] })
    const jabuka = f.stockItemId('Al Fakher · Jabuka')
    const menta = f.stockItemId('Al Fakher · Menta')
    const jabukaBefore = onHand(jabuka)
    const mentaBefore = onHand(menta)

    createOrder(f.db, f.venueId, f.actor('Amar'), {
      client_id: randomUUID(),
      table_id: f.tableId('Sto 8'),
      lines: [{
        id: randomUUID(),
        product_id: f.productId('Nargila'),
        qty: 1,
        flavour_ids: [jabuka, menta],
      }],
    })

    expect(jabukaBefore - onHand(jabuka)).toBeCloseTo(mentaBefore - onHand(menta), 6)
  })

  function onHand(stockItemId: string): number {
    return f.db.select().from(schema.stockMovements).all()
      .filter(m => m.stockItemId === stockItemId)
      .reduce((sum, m) => sum + m.qtyDelta, 0)
  }
})

describe('db:flavours', () => {
  it('adds what is missing, keeps what is there, and does nothing twice', () => {
    const admin = f.db.select().from(schema.users).all().find(u => u.role === 'admin')!

    const first = syncFlavours(f.db, f.venueId, admin.id)
    // The seed ships the six Al Fakher; the Adalya line is what this adds.
    expect(first.kept).toHaveLength(6)
    expect(first.added).toEqual([
      'Adalya · Ice', 'Adalya · Swiss', 'Adalya · Baku', 'Adalya · Moscow',
    ])

    const second = syncFlavours(f.db, f.venueId, admin.id)
    expect(second.added).toEqual([])
    expect(second.kept).toHaveLength(TOBACCOS.length)
  })

  it('opens a new aroma at nothing, so the picker greys it until a prijem', () => {
    const admin = f.db.select().from(schema.users).all().find(u => u.role === 'admin')!
    syncFlavours(f.db, f.venueId, admin.id)

    const ice = f.db.select().from(schema.stockItems).all()
      .find(item => item.name === 'Adalya · Ice')!
    const moved = f.db.select().from(schema.stockMovements).all()
      .filter(m => m.stockItemId === ice.id)

    expect(moved).toEqual([])
    // And priced, because a zero cost silently switches off variance, waste
    // cost and utrošak — the rule `schema.test.ts` guards over the whole shelf.
    expect(ice.lastCostMfen).toBeGreaterThan(0)
  })
})
