/**
 * WP6 — admin CRUD (`docs/BACKEND.md` §6.10, §11 *admin.test.ts*).
 *
 * The four things this file exists to prove, in the order §11 names them:
 *
 *   **The `price_history` invariant.** A price change closes the open row and
 *   opens a new one, the open row always equals `products.price_fen`, and no
 *   `order_lines` row moves — a price corrected at midnight must not change what
 *   the guest was charged at nine.
 *   **`setRecipe` is atomic.** Delete-then-insert, so a throw halfway leaves the
 *   old *normativ* exactly as it was rather than a product that consumes sugar
 *   and nothing else.
 *   **No hash in any response.** `createUser` stores a peppered scrypt hash and
 *   the answer carries none of it — the same grep `api-shapes.test.ts` runs over
 *   the phone-facing envelopes, run here over the admin ones.
 *   **The refusals with a Bosnian sentence behind them**: `SELF_DEACTIVATE`,
 *   `UNIT_FROZEN`, `COST_REQUIRED`, `TABLE_HAS_OPEN_TAB`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { formatKm } from '../../shared/money'
import { maxSeq } from '../../server/services/changes'
import { requireRole } from '../../server/utils/auth'
import { resetPin } from '../../server/services/auth'
import {
  createCategory, createProduct, createStockItem, createTable, createUser,
  getVenueSettings, listCategories, listProducts, listStockItems, listTables, listUsers,
  setRecipe, updateCategory, updateProduct, updateSettings, updateStockItem,
  updateTable, updateUser,
} from '../../server/services/admin'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

const admin = () => f.adminActor()

/** The seed's Kafa category — `createProduct` needs one and no helper names it. */
function categoryId(name = 'Kafa'): string {
  const row = f.db.select().from(schema.categories)
    .where(eq(schema.categories.name, name)).get()
  return row!.id
}

function entries(kind: string) {
  return f.db.select().from(schema.logEntries)
    .where(eq(schema.logEntries.kind, kind))
    .all()
}

function priceRows(productId: string) {
  return f.db.select().from(schema.priceHistory)
    .where(eq(schema.priceHistory.productId, productId))
    .all()
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom))
}

/** Every key in a response, however deeply nested — for the secrets grep. */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, out)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      out.push(key)
      allKeys(child, out)
    }
  }
  return out
}

// ===========================================================================

describe('products and the price history', () => {
  it('opens a price_history row with the product, and it equals products.price_fen', () => {
    const product = createProduct(f.db, f.venueId, admin(), {
      category_id: categoryId(), name: 'Espresso', price_fen: 220,
    })

    const rows = priceRows(product.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.priceFen).toBe(220)
    expect(rows[0]!.validTo).toBeNull()
    expect(product.price_fen).toBe(220)
    expect(product.price_since).toBe(rows[0]!.validFrom)
  })

  it('closes the open row and opens a new one on a price change', () => {
    const kafa = f.productId('Kafa')
    const before = priceRows(kafa)
    expect(before).toHaveLength(1)
    expect(before[0]!.validTo).toBeNull()

    // Off the fixture's clock, not a literal: a hardcoded instant is *before*
    // the seeded row's `valid_from` for a couple of minutes a year, and then
    // the two rows sort the other way round and this test fails on the wall
    // clock rather than on the code.
    f.clock.advance(3600)
    const at = f.clock.now()
    const after = updateProduct(f.db, f.venueId, admin(), kafa, { price_fen: 180 }, at)

    const rows = priceRows(kafa)
    expect(rows).toHaveLength(2)

    // The old row is closed at exactly the moment the new one opens: no gap a
    // report could fall into, and no overlap two rows could both claim.
    expect(rows[0]!.priceFen).toBe(150)
    expect(rows[0]!.validTo).toBe(at)
    expect(rows[1]!.priceFen).toBe(180)
    expect(rows[1]!.validTo).toBeNull()
    expect(rows[1]!.validFrom).toBe(at)
    expect(rows[1]!.changedBy).toBe(f.userId('Haris'))

    expect(after.price_fen).toBe(180)
  })

  it('keeps exactly one open row per product, whatever the price does', () => {
    const kafa = f.productId('Kafa')
    updateProduct(f.db, f.venueId, admin(), kafa, { price_fen: 180 })
    updateProduct(f.db, f.venueId, admin(), kafa, { price_fen: 200 })
    updateProduct(f.db, f.venueId, admin(), kafa, { price_fen: 160 })

    const open = f.db.select().from(schema.priceHistory)
      .where(and(
        eq(schema.priceHistory.productId, kafa),
        isNull(schema.priceHistory.validTo),
      ))
      .all()
    expect(open).toHaveLength(1)

    const product = f.db.select().from(schema.products).where(eq(schema.products.id, kafa)).get()!
    expect(open[0]!.priceFen).toBe(product.priceFen)
    expect(priceRows(kafa)).toHaveLength(4)
  })

  it('never touches a line that was already sold', () => {
    const round = f.lock('Amar', 'Sto 7', [{ product: 'Kafa', qty: 2 }])
    const linesBefore = f.db.select().from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, round.orderId)).all()

    updateProduct(f.db, f.venueId, admin(), f.productId('Kafa'), { price_fen: 999 })

    const linesAfter = f.db.select().from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, round.orderId)).all()
    expect(linesAfter).toEqual(linesBefore)
    expect(linesAfter[0]!.unitPriceFen).toBe(150)
    expect(linesAfter[0]!.chargedFen).toBe(300)
  })

  it('writes one price_changed entry, with the two amounts and no more', () => {
    updateProduct(f.db, f.venueId, admin(), f.productId('Kafa'), { price_fen: 180 })

    const written = entries('price_changed')
    expect(written).toHaveLength(1)
    expect(JSON.parse(written[0]!.bodyJson)).toMatchObject({
      product_id: f.productId('Kafa'), before: 150, after: 180,
    })
    // `formatKm` puts a non-breaking space before the currency, so this is
    // matched in pieces rather than as one literal nobody could retype.
    expect(written[0]!.titleBs).toMatch(/^Cijena promijenjena · Kafa · 1,50\sKM → 1,80\sKM$/)
    expect(written[0]!.actorId).toBe(f.userId('Haris'))
  })

  it('separates the price from the rest of the patch', () => {
    updateProduct(f.db, f.venueId, admin(), f.productId('Kafa'), {
      price_fen: 180, name: 'Kafa domaća', sort: 3,
    })

    expect(entries('price_changed')).toHaveLength(1)
    const changed = entries('product_changed')
    expect(changed).toHaveLength(1)
    // The labels name the fields that moved, never their values, and never the
    // price — that one has its own kind.
    expect(changed[0]!.titleBs).toContain('naziv')
    expect(changed[0]!.titleBs).toContain('sortiranje')
    expect(changed[0]!.titleBs).not.toContain('cijena')
  })

  it('says nothing when a field is re-sent with the value it already had', () => {
    updateProduct(f.db, f.venueId, admin(), f.productId('Kafa'), {
      price_fen: 150, name: 'Kafa', is_favourite: true,
    })
    expect(entries('price_changed')).toHaveLength(0)
    expect(entries('product_changed')).toHaveLength(0)
    expect(priceRows(f.productId('Kafa'))).toHaveLength(1)
  })

  it('refuses a patch with no fields, and a category that is not this venue’s', () => {
    expect(() => updateProduct(f.db, f.venueId, admin(), f.productId('Kafa'), {}))
      .toThrow(/EMPTY_PATCH|no fields/)
    expect(() => createProduct(f.db, f.venueId, admin(), {
      category_id: '00000000-0000-4000-8000-000000000000', name: 'X', price_fen: 100,
    })).toThrow(/no such category/)
  })

  it('bumps the menu so every phone refetches its bootstrap', () => {
    const before = maxSeq(f.db, f.venueId)
    updateProduct(f.db, f.venueId, admin(), f.productId('Kafa'), { price_fen: 180 })
    expect(maxSeq(f.db, f.venueId)).toBeGreaterThan(before)

    const bumped = f.db.select().from(schema.changes).all().map(c => c.entity)
    expect(bumped).toContain('menu')
  })
})

describe('setRecipe', () => {
  it('replaces the normativ whole', () => {
    const kafa = f.productId('Kafa')
    const lines = setRecipe(f.db, f.venueId, admin(), kafa, {
      lines: [
        { stock_item_id: f.stockItemId('Kafa (mljevena)'), qty: 8 },
        { stock_item_id: f.stockItemId('Mlijeko'), qty: 20 },
      ],
    })

    expect(lines.map(l => l.stock_item_name).sort()).toEqual(['Kafa (mljevena)', 'Mlijeko'])
    expect(lines.find(l => l.stock_item_name === 'Kafa (mljevena)')?.qty).toBe(8)
    // Šećer was in the seeded recipe and is gone: a PUT is the whole statement.
    expect(lines.map(l => l.stock_item_name)).not.toContain('Šećer')

    const stored = f.db.select().from(schema.recipeLines)
      .where(eq(schema.recipeLines.productId, kafa)).all()
    expect(stored).toHaveLength(2)
  })

  it('is atomic: a throw halfway leaves the old recipe exactly as it was', () => {
    const kafa = f.productId('Kafa')
    const before = f.db.select().from(schema.recipeLines)
      .where(eq(schema.recipeLines.productId, kafa)).all()
    expect(before.length).toBeGreaterThan(1)
    const seqBefore = maxSeq(f.db, f.venueId)

    // The delete has already run when this fires, which is precisely the moment
    // a non-transactional implementation would leave the product with no recipe.
    f.sqlite.exec(
      `CREATE TEMP TRIGGER wp6_boom BEFORE INSERT ON recipe_lines
       BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    )
    expect(() => setRecipe(f.db, f.venueId, admin(), kafa, {
      lines: [{ stock_item_id: f.stockItemId('Mlijeko'), qty: 20 }],
    })).toThrow(/boom/)
    f.sqlite.exec('DROP TRIGGER wp6_boom')

    const after = f.db.select().from(schema.recipeLines)
      .where(eq(schema.recipeLines.productId, kafa)).all()
    expect(after).toEqual(before)
    expect(entries('recipe_changed')).toHaveLength(0)
    expect(maxSeq(f.db, f.venueId)).toBe(seqBefore)
  })

  it('empties a recipe when the body says so, and refuses the same item twice', () => {
    const kafa = f.productId('Kafa')
    expect(setRecipe(f.db, f.venueId, admin(), kafa, { lines: [] })).toEqual([])

    expect(() => setRecipe(f.db, f.venueId, admin(), kafa, {
      lines: [
        { stock_item_id: f.stockItemId('Šećer'), qty: 5 },
        { stock_item_id: f.stockItemId('Šećer'), qty: 6 },
      ],
    })).toThrow(/twice/)
  })
})

describe('categories and tables', () => {
  it('counts the products a category still holds', () => {
    const kafa = listCategories(f.db, f.venueId).find(c => c.name === 'Kafa')!
    expect(kafa.product_count).toBe(3)
    expect(kafa.active).toBe(true)
  })

  it('creates and renames, with note chips surviving the round trip', () => {
    const created = createCategory(f.db, f.venueId, admin(), {
      name: 'Kokteli', kind: 'pice', note_chips: ['bez leda', 'duplo'], sort: 7,
    })
    expect(created.note_chips).toEqual(['bez leda', 'duplo'])

    const renamed = updateCategory(f.db, f.venueId, admin(), created.id, { name: 'Koktel' })
    expect(renamed.name).toBe('Koktel')
    expect(renamed.note_chips).toEqual(['bez leda', 'duplo'])
    expect(entries('category_changed')).toHaveLength(2)
  })

  it('refuses to take a table out of use while guests are sitting at it', () => {
    f.lock('Amar', 'Sto 7', [{ product: 'Kafa' }])
    const sto7 = listTables(f.db, f.venueId).find(t => t.name === 'Sto 7')!
    expect(sto7.has_open_tab).toBe(true)

    expect(() => updateTable(f.db, f.venueId, admin(), sto7.id, { active: false }))
      .toThrow(/open tab/)

    // An empty table deactivates fine, and the row survives — admin never deletes.
    const sto1 = listTables(f.db, f.venueId).find(t => t.name === 'Sto 1')!
    expect(updateTable(f.db, f.venueId, admin(), sto1.id, { active: false }).active).toBe(false)
    expect(listTables(f.db, f.venueId).find(t => t.name === 'Sto 1')).toBeDefined()
  })

  it('puts a new table on the floor plan and moves the two payloads that draw it', () => {
    const created = createTable(f.db, f.venueId, admin(), {
      name: 'Sto 99', zone: 'basta', col: 4, row: 3, grp: null,
    })
    expect(created.zone).toBe('basta')
    expect(created.has_open_tab).toBe(false)

    const bumped = f.db.select().from(schema.changes).all().map(c => c.entity)
    expect(bumped).toContain('table')
    expect(bumped).toContain('menu')
  })
})

describe('stock items', () => {
  it('refuses a new item with no cost — and a zero is no cost', () => {
    const body = { name: 'Sprite 0,25 l', kind: 'pice', base_unit: 'kom' } as const

    expect(() => createStockItem(f.db, f.venueId, admin(), body))
      .toThrow(/last_cost_mfen/)
    expect(() => createStockItem(f.db, f.venueId, admin(), { ...body, last_cost_mfen: 0 }))
      .toThrow(/last_cost_mfen/)

    const created = createStockItem(f.db, f.venueId, admin(), { ...body, last_cost_mfen: 90_000 })
    // The first cost seeds both columns: an item whose only price is the one you
    // typed has that price as its average too, until a delivery recomputes it.
    expect(created.last_cost_mfen).toBe(90_000)
    expect(created.avg_cost_mfen).toBe(90_000)
    expect(created.estimated_cost).toBe(false)
  })

  it('seeds a still-zero moving average from a corrected cost', () => {
    const cedevita = f.stockItemId('Cedevita')
    f.db.update(schema.stockItems).set({ avgCostMfen: 0 })
      .where(eq(schema.stockItems.id, cedevita)).run()

    expect(listStockItems(f.db, f.venueId).find(i => i.id === cedevita)!.estimated_cost).toBe(true)

    const fixed = updateStockItem(f.db, f.venueId, admin(), cedevita, { last_cost_mfen: 75_000 })
    expect(fixed.avg_cost_mfen).toBe(75_000)
    expect(fixed.estimated_cost).toBe(false)
  })

  it('freezes base_unit once the item has a movement', () => {
    const created = createStockItem(f.db, f.venueId, admin(), {
      name: 'Tonik 0,2 l', kind: 'pice', base_unit: 'kom', last_cost_mfen: 80_000,
    })
    expect(created.unit_frozen).toBe(false)

    // No movements yet: the unit is still a typo somebody may fix.
    expect(updateStockItem(f.db, f.venueId, admin(), created.id, { base_unit: 'ml' }).base_unit)
      .toBe('ml')

    // The seeded items all have an `opening` movement behind them, so on hand is
    // a sum in the old unit and changing it would add millilitres to grams.
    const kafa = f.stockItemId('Kafa (mljevena)')
    expect(listStockItems(f.db, f.venueId).find(i => i.id === kafa)!.unit_frozen).toBe(true)
    expect(() => updateStockItem(f.db, f.venueId, admin(), kafa, { base_unit: 'kom' }))
      .toThrow(/movements/)

    // …but everything else about a moved item still edits.
    expect(updateStockItem(f.db, f.venueId, admin(), kafa, { par_qty: 500 }).par_qty).toBe(500)
  })
})

describe('users', () => {
  it('stores only a hash, and hands back none of it', () => {
    const created = createUser(f.db, f.venueId, admin(), {
      name: 'Nedim', initials: 'ne', role: 'radnik', pin: '4321',
    })

    expect(created.name).toBe('Nedim')
    expect(created.initials).toBe('NE')
    expect(created.has_pin).toBe(true)
    expect(created.pin_len).toBe(4)
    expect(created.active).toBe(true)
    expect(Object.keys(created)).not.toContain('pin_hash')

    const row = f.db.select().from(schema.users).where(eq(schema.users.id, created.id)).get()!
    expect(row.pinHash).toMatch(/^scrypt\$/)
    expect(row.pinHash).not.toContain('4321')
    expect(row.pinPepperV).toBe(1)

    // Two different PINs must not produce related hashes — the salt is the id.
    const second = createUser(f.db, f.venueId, admin(), {
      name: 'Adi', initials: 'AD', role: 'radnik', pin: '4322',
    })
    const other = f.db.select().from(schema.users).where(eq(schema.users.id, second.id)).get()!
    expect(other.pinHash).not.toBe(row.pinHash)
  })

  /**
   * The invariant that moved, and the sentence that names it (CLAUDE.md):
   * **two people may no longer share a PIN.** This test used to assert the
   * opposite — that Nedim and Adi could both be on 4321 and merely get
   * different hashes, which was true and harmless while the lock screen asked
   * *who* first. It no longer asks: the PIN is the only question, so a PIN two
   * people answer identifies neither, and the salt property it was really about
   * is asserted above with two different PINs instead.
   */
  it('refuses a PIN somebody active already uses, and frees it when they leave', () => {
    createUser(f.db, f.venueId, admin(), {
      name: 'Selma', initials: 'SE', role: 'radnik', pin: '8181',
    })

    expect(() => createUser(f.db, f.venueId, admin(), {
      name: 'Selma D.', initials: 'SD', role: 'radnik', pin: '8181',
    })).toThrow(/already belongs to somebody/)

    // A seeded person's PIN is taken too — this is not only about new rows.
    expect(() => createUser(f.db, f.venueId, admin(), {
      name: 'Neko', initials: 'NE', role: 'radnik', pin: f.pin('Amar'),
    })).toThrow(/already belongs to somebody/)

    // Deactivated people hold nothing against anybody: their rows stay for the
    // history on February's rounds, not for the lock screen.
    const users = f.db.select().from(schema.users).all()
    const selma = users.find(u => u.name === 'Selma')!
    updateUser(f.db, f.venueId, admin(), selma.id, { active: false })

    const reused = createUser(f.db, f.venueId, admin(), {
      name: 'Amra', initials: 'AM', role: 'radnik', pin: '8181',
    })
    expect(reused.has_pin).toBe(true)
  })

  it('refuses a reset to a PIN that is already somebody else\'s', () => {
    expect(() => resetPin(f.db, f.venueId, admin(), f.userId('Amar'), f.pin('Emir')))
      .toThrow(/already belongs to somebody/)

    // His own digits are not a collision with himself.
    expect(resetPin(f.db, f.venueId, admin(), f.userId('Amar'), f.pin('Amar')).ok).toBe(true)
  })

  it('refuses a 5-digit PIN', () => {
    expect(() => createUser(f.db, f.venueId, admin(), {
      name: 'Kenan', initials: 'KE', role: 'radnik', pin: '12345',
    })).toThrow(/4 or 6/)
  })

  /**
   * 4 and 6 are both legal lengths, but **not in the same venue** — and that is
   * the rule that closes the prefix hole, not tidiness.
   *
   * "Unique" alone was never enough. `222299` and `2222` are two different PINs
   * and neither is the other, so the old check let an admin set both; but the
   * pad has to fire on some number of taps before it can ask the server whose
   * they are, so the six-digit typist's fourth tap sent `2222` — and signed in
   * whoever `2222` belongs to. One length per venue makes the prefix
   * unreachable and lets the pad fire on the real length from the first tap.
   */
  it('refuses a PIN of a different length to the ones the venue already uses', () => {
    expect(() => createUser(f.db, f.venueId, admin(), {
      name: 'Selma', initials: 'SE', role: 'radnik', pin: '222299',
    })).toThrow(/same number of digits/)
    // The very hole, from the other end: `2222` is Amar's, and the first four of
    // the six above. Neither the duplicate check nor the pad could have caught it.
    expect(() => resetPin(f.db, f.venueId, admin(), f.userId('Haris'), '222299'))
      .toThrow(/same number of digits/)

    // A venue with no PINs at all takes either length, and the first one fixes
    // it: this is the only way the café changes from four digits to six.
    f.db.update(schema.users).set({ pinHash: null }).run()
    const now6 = createUser(f.db, f.venueId, admin(), {
      name: 'Selma', initials: 'SE', role: 'radnik', pin: '222299',
    })
    expect(now6.pin_len).toBe(6)
    expect(() => resetPin(f.db, f.venueId, admin(), f.userId('Amar'), '2222'))
      .toThrow(/same number of digits/)
  })

  it('refuses an email that already belongs to somebody', () => {
    expect(() => createUser(f.db, f.venueId, admin(), {
      name: 'Lažni Haris', initials: 'LH', role: 'admin', pin: '8282',
      email: 'haris@lounge.ba',
    })).toThrow(/already belongs/)
  })

  it('deactivates a worker, and refuses to let the admin lock himself out', () => {
    const amar = f.userId('Amar')
    const gone = updateUser(f.db, f.venueId, admin(), amar, { active: false })
    expect(gone.active).toBe(false)

    const written = entries('user_changed')
    expect(written).toHaveLength(1)
    expect(written[0]!.titleBs).toBe('Konobar deaktiviran · Amar')

    // Still there — admin never deletes, and February's rounds still say "Amar".
    expect(listUsers(f.db, f.venueId).map(u => u.name)).toContain('Amar')

    expect(() => updateUser(f.db, f.venueId, admin(), f.userId('Haris'), { active: false }))
      .toThrow(/himself/)
  })

  it('takes the admin e-mail without ever putting it in the Dnevnik', () => {
    const haris = f.userId('Haris')
    const saved = updateUser(f.db, f.venueId, admin(), haris, { email: 'haris@lounge.ba' })
    expect(saved.email).toBe('haris@lounge.ba')

    // §8's bodies carry ids and integers, never a contact detail — `log.test.ts`
    // greps every rendered body for exactly this, and the entry below is the one
    // an admin CRUD route could most easily get wrong.
    for (const entry of entries('user_changed')) {
      expect(entry.bodyJson).not.toContain('haris@lounge.ba')
      expect(entry.titleBs).not.toContain('haris@lounge.ba')
    }
  })

  it('hands a PIN reset to WP1’s resetPin, which is the only function that hashes one', () => {
    const amar = f.userId('Amar')
    const before = f.db.select().from(schema.users).where(eq(schema.users.id, amar)).get()!

    const result = resetPin(f.db, f.venueId, admin(), amar, '9988')
    expect(result.ok).toBe(true)

    const after = f.db.select().from(schema.users).where(eq(schema.users.id, amar)).get()!
    expect(after.pinHash).not.toBe(before.pinHash)
    expect(after.pinLen).toBe(4)
    expect(entries('user_changed').map(e => JSON.parse(e.bodyJson).what)).toEqual(['pin_resetovan'])
  })
})

describe('settings', () => {
  it('reads the defaults with the owner’s overrides on top', () => {
    const settings = getVenueSettings(f.db, f.venueId)
    expect(settings.timezone).toBe('Europe/Sarajevo')
    expect(settings.cash_tolerance_fen).toBe(500)
    // The dev seed's one override.
    expect(settings.bartender_can_receive_goods).toBe(true)
  })

  it('writes one entry per changed key, and nothing for a key that did not move', () => {
    const after = updateSettings(f.db, f.venueId, admin(), {
      cash_tolerance_fen: 700,
      variance_alert_fen: 2000,
      // Already true in the seed: re-saving a form is not an event.
      bartender_can_receive_goods: true,
    })

    expect(after.cash_tolerance_fen).toBe(700)
    expect(after.variance_alert_fen).toBe(2000)

    const written = entries('settings_changed')
    expect(written).toHaveLength(2)
    expect(written.map(e => JSON.parse(e.bodyJson).key).sort())
      .toEqual(['cash_tolerance_fen', 'variance_alert_fen'])
    // A `*_fen` setting is money in the Dnevnik too, not raw feninga. The space
    // before "KM" is the non-breaking one `formatKm` writes.
    expect(written.map(e => e.titleBs)).toContain(
      `Postavke promijenjene · Tolerancija kase ${formatKm(500)} → ${formatKm(700)}`,
    )
  })

  it('keeps only what the owner touched, so a default that moves later moves for him', () => {
    updateSettings(f.db, f.venueId, admin(), { cash_tolerance_fen: 700 })

    const stored = JSON.parse(
      f.db.select().from(schema.venues).where(eq(schema.venues.id, f.venueId)).get()!.settingsJson,
    )
    expect(stored).toEqual({ bartender_can_receive_goods: true, cash_tolerance_fen: 700 })
    expect(stored.timezone).toBeUndefined()
  })

  it('refuses an empty patch and bumps `settings` on a real one', () => {
    expect(() => updateSettings(f.db, f.venueId, admin(), {})).toThrow(/no fields/)

    const before = maxSeq(f.db, f.venueId)
    updateSettings(f.db, f.venueId, admin(), { early_close_min: 45 })
    expect(maxSeq(f.db, f.venueId)).toBeGreaterThan(before)
    expect(f.db.select().from(schema.changes).all().map(c => c.entity)).toContain('settings')
  })
})

describe('the responses', () => {
  it('carry no hash, no token, no password and no pepper', () => {
    const product = createProduct(f.db, f.venueId, admin(), {
      category_id: categoryId(), name: 'Espresso', price_fen: 220,
    })
    createUser(f.db, f.venueId, admin(), {
      name: 'Nedim', initials: 'NE', role: 'radnik', pin: '4321', email: 'nedim@lounge.ba',
    })

    const responses: unknown[] = [
      listProducts(f.db, f.venueId),
      listCategories(f.db, f.venueId),
      listTables(f.db, f.venueId),
      listStockItems(f.db, f.venueId),
      listUsers(f.db, f.venueId),
      getVenueSettings(f.db, f.venueId),
      product,
    ]

    for (const response of responses) {
      for (const key of allKeys(response)) {
        expect(key, `${key} looks like a secret`).not.toMatch(/_hash$|token|password|pepper/)
      }
      expect(JSON.stringify(response)).not.toContain('scrypt$')
    }
  })
})

describe('the guard on every admin route', () => {
  const ADMIN_DIR = resolve(process.cwd(), 'server/api/admin')

  /** The WP6 subtrees; `devices` and `enrol-codes` are WP1's (§12). */
  const MINE = ['products', 'categories', 'tables', 'stock-items', 'users', 'settings']

  function files(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...files(full))
      else if (entry.endsWith('.ts')) out.push(full)
    }
    return out
  }

  it('says `admin` in the handler as well as in ROUTE_ROLES', () => {
    const mine = files(ADMIN_DIR).filter(
      path => MINE.some(prefix => path.includes(`/admin/${prefix}`)),
    )
    expect(mine.length).toBe(19)

    for (const path of mine) {
      expect(readFileSync(path, 'utf8'), `${path} has no requireRole`)
        .toContain("requireRole(event.context.actor, 'admin')")
    }
  })

  it('is a real refusal and not a no-op', () => {
    expect(() => requireRole(f.actor('Amar'), 'admin')).toThrow(/may not/)
    expect(() => requireRole(f.actor('Emir'), 'admin')).toThrow(/may not/)
    expect(() => requireRole(admin(), 'admin')).not.toThrow()
  })
})
