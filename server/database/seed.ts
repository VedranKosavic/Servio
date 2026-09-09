/**
 * The venue, as it really is: six waiters and a bar, 27 tables across two zones,
 * the menu with its normativi, and the opening stock count.
 *
 * Run by `npm run db:seed`, and automatically at dev startup when the `venues`
 * table is empty, so a fresh clone has something to look at. It never runs
 * against a database that already has a venue — seeding twice would duplicate
 * the whole catalog and, worse, write a second set of `opening` movements that
 * silently doubles the stock on hand.
 */
import { sql } from 'drizzle-orm'
import type { Db } from './client'
import * as schema from './schema'
import { randomUUID } from 'node:crypto'

const id = () => randomUUID()

/** True when this database has never been seeded. */
export function isEmpty(db: Db): boolean {
  const n = db.select({ n: sql<number>`count(*)` }).from(schema.venues).get()?.n ?? 0
  return n === 0
}

export function seedIfEmpty(db: Db): boolean {
  if (!isEmpty(db)) return false
  seed(db)
  return true
}

export function seed(db: Db): void {
  db.transaction((tx) => {
    const now = new Date().toISOString()
    const venueId = id()

    tx.insert(schema.venues).values({
      id: venueId,
      name: 'Lounge',
      slug: 'lounge',
      createdAt: now,
    }).run()

    // -- People -------------------------------------------------------------
    // No PINs and no passwords in this slice: the phone says who it is and the
    // server believes it. Real login is PLAN.md §5 "Auth", a later step.
    const staff: Array<{ name: string, role: 'waiter' | 'bartender' | 'owner' }> = [
      { name: 'Amar', role: 'waiter' },
      { name: 'Lejla', role: 'waiter' },
      { name: 'Dino', role: 'waiter' },
      { name: 'Tarik', role: 'waiter' },
      { name: 'Emir', role: 'bartender' },
      { name: 'Haris', role: 'owner' },
    ]
    for (const person of staff) {
      tx.insert(schema.users).values({
        id: id(),
        venueId,
        name: person.name,
        // Everyone goes by a first name here, so the avatar shows its first two
        // letters rather than one lonely capital.
        initials: person.name.slice(0, 2).toUpperCase(),
        role: person.role,
        active: 1,
      }).run()
    }

    // -- The floor plan -----------------------------------------------------
    // `col`/`row` are the table's place on its zone's bird's-eye schematic, not
    // a list position. Tables in a `grp` (the VIP box) are drawn inside their
    // own container, so their coordinates are relative to that box and may
    // repeat coordinates used by the main grid of the same zone.
    const floor: Array<{ name: string, zone: 'unutra' | 'basta', col: number, row: number, grp?: string }> = []
    let n = 1
    // Unutra, column 1: six tables down the wall.
    for (let row = 1; row <= 6; row++) floor.push({ name: `Sto ${n++}`, zone: 'unutra', col: 1, row })
    // Column 2: four.
    for (let row = 1; row <= 4; row++) floor.push({ name: `Sto ${n++}`, zone: 'unutra', col: 2, row })
    // Column 3: five.
    for (let row = 1; row <= 5; row++) floor.push({ name: `Sto ${n++}`, zone: 'unutra', col: 3, row })
    // The VIP box, off column 3.
    for (let row = 1; row <= 2; row++) floor.push({ name: `Sto ${n++}`, zone: 'unutra', col: 3, row, grp: 'vip' })
    // Bašta, first row: three tables along the front.
    for (let col = 1; col <= 3; col++) floor.push({ name: `Sto ${n++}`, zone: 'basta', col, row: 1 })
    // Second row: seven.
    for (let col = 1; col <= 7; col++) floor.push({ name: `Sto ${n++}`, zone: 'basta', col, row: 2 })

    floor.forEach((table, i) => {
      tx.insert(schema.tables).values({
        id: id(),
        venueId,
        name: table.name,
        zone: table.zone,
        col: table.col,
        row: table.row,
        grp: table.grp ?? null,
        sort: i + 1,
        active: 1,
      }).run()
    })

    // -- Categories ---------------------------------------------------------
    const categoryIds = new Map<string, string>()
    const categoryNames = ['Kafa', 'Bezalkoholna', 'Energetska', 'Čaj', 'Nargila', 'Ostalo']
    categoryNames.forEach((name, i) => {
      const catId = id()
      categoryIds.set(name, catId)
      tx.insert(schema.categories).values({ id: catId, venueId, name, sort: i + 1 }).run()
    })

    // -- Stock items, and the opening count ---------------------------------
    // `opening` movements are the *početno stanje*: what was on the shelf the
    // evening the app was switched on. They are the only movements that ever
    // carry `ref_type='venue_setup'`, and there is exactly one per item.
    const stockIds = new Map<string, string>()
    interface SeedStock {
      name: string
      kind: 'pice' | 'duhan' | 'zar' | 'potrosni'
      unit: 'kom' | 'g' | 'ml'
      opening: number
      packName?: string
      packQty?: number
      isSpot?: boolean
    }
    const stock: SeedStock[] = [
      { name: 'Kafa (mljevena)', kind: 'potrosni', unit: 'g', opening: 2400, isSpot: true },
      { name: 'Šećer', kind: 'potrosni', unit: 'g', opening: 4200, isSpot: true },
      { name: 'Mlijeko', kind: 'potrosni', unit: 'ml', opening: 5000 },
      { name: 'Nes', kind: 'potrosni', unit: 'kom', opening: 40 },
      { name: 'Čaj (vrećice)', kind: 'potrosni', unit: 'kom', opening: 90 },
      { name: 'Coca-Cola 0,25 l', kind: 'pice', unit: 'kom', opening: 79, packName: 'gajba', packQty: 24, isSpot: true },
      { name: 'Fanta 0,25 l', kind: 'pice', unit: 'kom', opening: 72, isSpot: true },
      { name: 'Cedevita', kind: 'pice', unit: 'kom', opening: 30, isSpot: true },
      { name: 'Sok od narandže', kind: 'pice', unit: 'kom', opening: 24 },
      { name: 'Voda 0,5 l', kind: 'pice', unit: 'kom', opening: 72 },
      { name: 'Red Bull', kind: 'pice', unit: 'kom', opening: 28, isSpot: true },
      { name: 'Limun', kind: 'potrosni', unit: 'kom', opening: 20 },
      // Tobacco: one stock item per aroma, weighed in grams. All on the spot
      // list — an open tin is the easiest thing in the café to lose track of.
      { name: 'Al Fakher · Jabuka', kind: 'duhan', unit: 'g', opening: 643, isSpot: true },
      { name: 'Al Fakher · Menta', kind: 'duhan', unit: 'g', opening: 500, isSpot: true },
      { name: 'Al Fakher · Grožđe', kind: 'duhan', unit: 'g', opening: 400, isSpot: true },
      { name: 'Al Fakher · Limun-menta', kind: 'duhan', unit: 'g', opening: 300, isSpot: true },
      { name: 'Al Fakher · Lubenica', kind: 'duhan', unit: 'g', opening: 250, isSpot: true },
      { name: 'Al Fakher · Borovnica', kind: 'duhan', unit: 'g', opening: 150, isSpot: true },
      { name: 'Ugalj (kocke)', kind: 'zar', unit: 'kom', opening: 103, isSpot: true },
    ]

    for (const item of stock) {
      const itemId = id()
      stockIds.set(item.name, itemId)
      tx.insert(schema.stockItems).values({
        id: itemId,
        venueId,
        name: item.name,
        kind: item.kind,
        baseUnit: item.unit,
        packName: item.packName ?? null,
        packQty: item.packQty ?? null,
        isSpot: item.isSpot ? 1 : 0,
        active: 1,
      }).run()

      tx.insert(schema.stockMovements).values({
        id: id(),
        venueId,
        stockItemId: itemId,
        type: 'opening',
        qtyDelta: item.opening,
        refType: 'venue_setup',
        refId: venueId,
        userId: null,
        note: 'početno stanje',
        occurredAt: now,
        createdAt: now,
      }).run()
    }

    // -- The menu -----------------------------------------------------------
    // `sells` is the 1:1 case (a bottle is a bottle); `recipe` is the normativ
    // (a kafa is 7 g kafa + 5 g šećera). A shisha product resolves its tobacco
    // from the aromas chosen at order time, so it declares grams and coal only.
    interface SeedProduct {
      name: string
      category: string
      priceFen: number
      kind?: 'simple' | 'shisha'
      sells?: string
      recipe?: Array<[string, number]>
      shishaGrams?: number
      coalPcs?: number
      favourite?: boolean
    }
    const menu: SeedProduct[] = [
      { name: 'Kafa', category: 'Kafa', priceFen: 150, recipe: [['Kafa (mljevena)', 7], ['Šećer', 5]], favourite: true },
      { name: 'Kafa s mlijekom', category: 'Kafa', priceFen: 200, recipe: [['Kafa (mljevena)', 7], ['Šećer', 5], ['Mlijeko', 30]] },
      { name: 'Nes', category: 'Kafa', priceFen: 250, recipe: [['Nes', 1], ['Šećer', 5]] },
      { name: 'Čaj', category: 'Čaj', priceFen: 200, recipe: [['Čaj (vrećice)', 1], ['Šećer', 5]], favourite: true },
      { name: 'Coca-Cola', category: 'Bezalkoholna', priceFen: 300, sells: 'Coca-Cola 0,25 l', favourite: true },
      { name: 'Fanta', category: 'Bezalkoholna', priceFen: 300, sells: 'Fanta 0,25 l' },
      { name: 'Cedevita', category: 'Bezalkoholna', priceFen: 250, sells: 'Cedevita' },
      { name: 'Sok od narandže', category: 'Bezalkoholna', priceFen: 300, sells: 'Sok od narandže' },
      { name: 'Voda 0,5 l', category: 'Bezalkoholna', priceFen: 150, sells: 'Voda 0,5 l' },
      { name: 'Red Bull', category: 'Energetska', priceFen: 500, sells: 'Red Bull', favourite: true },
      { name: 'Limunada', category: 'Bezalkoholna', priceFen: 350, recipe: [['Limun', 1], ['Šećer', 10]], favourite: true },
      { name: 'Nargila', category: 'Nargila', priceFen: 1500, kind: 'shisha', shishaGrams: 20, coalPcs: 3, favourite: true },
      // A fresh bowl on a running shisha: charged, its own tobacco, no new coal.
      { name: 'Nova lula', category: 'Nargila', priceFen: 1000, kind: 'shisha', shishaGrams: 20, coalPcs: 0 },
      // Free for the guest, never free for the café: two pieces of coal leave
      // the box and the ledger says so.
      { name: 'Dodatni žar', category: 'Nargila', priceFen: 0, recipe: [['Ugalj (kocke)', 2]] },
    ]

    menu.forEach((product, i) => {
      const productId = id()
      const categoryId = categoryIds.get(product.category)
      if (!categoryId) throw new Error(`seed: unknown category ${product.category}`)

      tx.insert(schema.products).values({
        id: productId,
        venueId,
        categoryId,
        name: product.name,
        priceFen: product.priceFen,
        kind: product.kind ?? 'simple',
        sellsStockItemId: product.sells ? requireStock(stockIds, product.sells) : null,
        shishaGrams: product.shishaGrams ?? null,
        coalPcs: product.coalPcs ?? null,
        isFavourite: product.favourite ? 1 : 0,
        sort: i + 1,
        active: 1,
      }).run()

      for (const [itemName, qty] of product.recipe ?? []) {
        tx.insert(schema.recipeLines).values({
          id: id(),
          venueId,
          productId,
          stockItemId: requireStock(stockIds, itemName),
          qty,
        }).run()
      }
    })
  })
}

function requireStock(ids: Map<string, string>, name: string): string {
  const found = ids.get(name)
  if (!found) throw new Error(`seed: unknown stock item ${name}`)
  return found
}
