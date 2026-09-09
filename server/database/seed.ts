/**
 * The venue, as it really is: six people and a bar, 27 tables across two zones,
 * the menu with its normativi, and the opening stock count.
 *
 * Run by `npm run db:seed`, and automatically at dev startup when the `venues`
 * table is empty, so a fresh clone has something to look at. It never runs
 * against a database that already has a venue — seeding twice would duplicate
 * the whole catalog and, worse, write a second set of `opening` movements that
 * silently doubles the stock on hand.
 *
 * **`devSecrets` is an explicit argument, not an environment guess.** With it
 * on (dev, tests) the six people get the PINs listed below and Haris gets an
 * email and a password, so a fresh clone can log in. With it off the users are
 * inserted with `pin_hash NULL` — which means "cannot log in" — and the CLI
 * prints a line telling whoever is installing to set the PINs in `/a`. A default
 * PIN that reaches a real café is a PIN nobody ever changes.
 */
import { sql } from 'drizzle-orm'
import type { Db } from './client'
import * as schema from './schema'
import { randomUUID } from 'node:crypto'
import { hashSecret } from '../utils/password'

const id = () => randomUUID()

export interface SeedOptions {
  /** Give the seeded people the dev PINs and Haris his email + password. */
  devSecrets?: boolean
}

/**
 * Fixed ids for the six seeded people.
 *
 * They are constants for one reason: `hashSecret` mixes the user id into the
 * hash, so a memoised hash is only reusable if the id is the same every time.
 * A vitest file that builds twenty fixtures would otherwise run twenty × six
 * scrypt hashes — about a minute of a deliberately slow function, per file.
 */
const SEED_USER_IDS = {
  Amar: '11111111-1111-4111-8111-111111111111',
  Lejla: '22222222-2222-4222-8222-222222222222',
  Dino: '33333333-3333-4333-8333-333333333333',
  Tarik: '44444444-4444-4444-8444-444444444444',
  Emir: '55555555-5555-4555-8555-555555555555',
  Haris: '66666666-6666-4666-8666-666666666666',
} as const

/** Dev only. Documented in `docs/BACKEND.md` §5.6 and nowhere near production. */
const DEV_PINS: Record<keyof typeof SEED_USER_IDS, string> = {
  Amar: '1111',
  Lejla: '2222',
  Dino: '3333',
  Tarik: '4444',
  Emir: '123456',
  Haris: '123456',
}

const DEV_ADMIN_EMAIL = 'haris@lounge.ba'
const DEV_ADMIN_PASSWORD = 'lounge'

/** Module scope, so the whole test suite pays for each hash exactly once. */
const hashCache = new Map<string, string>()
function memoHash(plain: string, userId: string): string {
  const key = `${userId}:${plain}`
  let hash = hashCache.get(key)
  if (!hash) {
    hash = hashSecret(plain, userId)
    hashCache.set(key, hash)
  }
  return hash
}

/** True when this database has never been seeded. */
export function isEmpty(db: Db): boolean {
  const n = db.select({ n: sql<number>`count(*)` }).from(schema.venues).get()?.n ?? 0
  return n === 0
}

export function seedIfEmpty(db: Db, opts: SeedOptions = {}): boolean {
  if (!isEmpty(db)) return false
  seed(db, opts)
  return true
}

export function seed(db: Db, opts: SeedOptions = {}): void {
  const devSecrets = opts.devSecrets ?? true

  db.transaction((tx) => {
    const now = new Date().toISOString()
    const venueId = id()

    tx.insert(schema.venues).values({
      id: venueId,
      name: 'Lounge',
      slug: 'lounge',
      // The one override the dev venue needs: the existing `/s` delivery screen
      // is the bartender's, and the production default is `false`.
      settingsJson: devSecrets ? '{"bartender_can_receive_goods":true}' : '{}',
      createdAt: now,
    }).run()

    // -- People -------------------------------------------------------------
    // Three roles: `admin` has the dashboard and the approvals, `waiter` and
    // `bartender` are identical on the floor apart from the default screen and
    // the fact that a bartender is a default approver (a setting, not a rule).
    const staff: Array<{
      name: keyof typeof SEED_USER_IDS
      role: 'admin' | 'waiter' | 'bartender'
      pinLen: 4 | 6
    }> = [
      { name: 'Amar', role: 'waiter', pinLen: 4 },
      { name: 'Lejla', role: 'waiter', pinLen: 4 },
      { name: 'Dino', role: 'waiter', pinLen: 4 },
      { name: 'Tarik', role: 'waiter', pinLen: 4 },
      { name: 'Emir', role: 'bartender', pinLen: 6 },
      { name: 'Haris', role: 'admin', pinLen: 6 },
    ]
    for (const person of staff) {
      const userId = SEED_USER_IDS[person.name]
      const isAdmin = person.role === 'admin'
      tx.insert(schema.users).values({
        id: userId,
        venueId,
        name: person.name,
        // Everyone goes by a first name here, so the avatar shows its first two
        // letters rather than one lonely capital.
        initials: person.name.slice(0, 2).toUpperCase(),
        role: person.role,
        active: 1,
        pinHash: devSecrets ? memoHash(DEV_PINS[person.name], userId) : null,
        pinLen: person.pinLen,
        pinSetAt: devSecrets ? now : null,
        pinPepperV: 1,
        // Email + password is the only way into `/a` on a laptop, and only an
        // admin has one.
        passwordHash: devSecrets && isAdmin ? memoHash(DEV_ADMIN_PASSWORD, userId) : null,
        email: devSecrets && isAdmin ? DEV_ADMIN_EMAIL : null,
        logSeenAt: null,
        createdAt: now,
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
    // `kind` is what the category *is*, for the reports: the Nargila column of
    // the monthly report is "every category whose kind is nargila", not a name
    // match that breaks the day somebody renames it.
    const categoryIds = new Map<string, string>()
    const categories: Array<{ name: string, kind: 'pice' | 'hrana' | 'nargila' | 'ostalo' }> = [
      { name: 'Kafa', kind: 'pice' },
      { name: 'Bezalkoholna', kind: 'pice' },
      { name: 'Energetska', kind: 'pice' },
      { name: 'Čaj', kind: 'pice' },
      { name: 'Nargila', kind: 'nargila' },
      { name: 'Ostalo', kind: 'ostalo' },
    ]
    categories.forEach((category, i) => {
      const catId = id()
      categoryIds.set(category.name, catId)
      tx.insert(schema.categories).values({
        id: catId,
        venueId,
        name: category.name,
        kind: category.kind,
        noteChipsJson: '[]',
        sort: i + 1,
        active: 1,
      }).run()
    })

    // -- Stock items, and the opening count ---------------------------------
    // `opening` movements are the *početno stanje*: what was on the shelf the
    // evening the app was switched on. They are the only movements that ever
    // carry `ref_type='venue_setup'`, and there is exactly one per item.
    //
    // **The costs are plausible placeholders, and they are honest about it.**
    // The dev venue needs non-zero costs or every variance, every *utrošak* and
    // every waste value in a test is 0,00 KM and proves nothing. The *live*
    // venue does not get them: its 19 rows are priced once, by the owner, through
    // `POST /api/stock/opening` — the *Početno stanje* screen — reading out real
    // purchase prices. `schema.test.ts` asserts the seed leaves no item with
    // both costs at zero, so a new item added here without a price fails a test
    // rather than silently switching off half the reports.
    //
    // Costs are **milli-feninga per base unit**: 12 000 mfen/g is 12 fen a gram,
    // which is a 30 KM tin of 250 g.
    const stockIds = new Map<string, string>()
    interface SeedStock {
      name: string
      kind: 'pice' | 'duhan' | 'zar' | 'potrosni' | 'hrana'
      unit: 'kom' | 'g' | 'ml'
      opening: number
      /** Placeholder purchase cost, milli-feninga per base unit. */
      costMfen: number
      category: string
      packName?: string
      packQty?: number
      isSpot?: boolean
      weigh?: boolean
    }
    const stock: SeedStock[] = [
      { name: 'Kafa (mljevena)', kind: 'potrosni', unit: 'g', opening: 2400, costMfen: 1_800, category: 'Kafa', isSpot: true, weigh: true },
      { name: 'Šećer', kind: 'potrosni', unit: 'g', opening: 4200, costMfen: 200, category: 'Ostalo', isSpot: true, weigh: true },
      { name: 'Mlijeko', kind: 'potrosni', unit: 'ml', opening: 5000, costMfen: 200, category: 'Ostalo' },
      { name: 'Nes', kind: 'potrosni', unit: 'kom', opening: 40, costMfen: 40_000, category: 'Kafa' },
      { name: 'Čaj (vrećice)', kind: 'potrosni', unit: 'kom', opening: 90, costMfen: 15_000, category: 'Čaj' },
      { name: 'Coca-Cola 0,25 l', kind: 'pice', unit: 'kom', opening: 79, costMfen: 90_000, category: 'Bezalkoholna', packName: 'gajba', packQty: 24, isSpot: true },
      { name: 'Fanta 0,25 l', kind: 'pice', unit: 'kom', opening: 72, costMfen: 90_000, category: 'Bezalkoholna', isSpot: true },
      { name: 'Cedevita', kind: 'pice', unit: 'kom', opening: 30, costMfen: 70_000, category: 'Bezalkoholna', isSpot: true },
      { name: 'Sok od narandže', kind: 'pice', unit: 'kom', opening: 24, costMfen: 100_000, category: 'Bezalkoholna' },
      { name: 'Voda 0,5 l', kind: 'pice', unit: 'kom', opening: 72, costMfen: 45_000, category: 'Bezalkoholna' },
      { name: 'Red Bull', kind: 'pice', unit: 'kom', opening: 28, costMfen: 200_000, category: 'Energetska', isSpot: true },
      { name: 'Limun', kind: 'potrosni', unit: 'kom', opening: 20, costMfen: 50_000, category: 'Ostalo' },
      // Tobacco: one stock item per aroma, weighed in grams. All on the spot
      // list — an open tin is the easiest thing in the café to lose track of.
      { name: 'Al Fakher · Jabuka', kind: 'duhan', unit: 'g', opening: 643, costMfen: 12_000, category: 'Nargila', isSpot: true, weigh: true },
      { name: 'Al Fakher · Menta', kind: 'duhan', unit: 'g', opening: 500, costMfen: 12_000, category: 'Nargila', isSpot: true, weigh: true },
      { name: 'Al Fakher · Grožđe', kind: 'duhan', unit: 'g', opening: 400, costMfen: 12_000, category: 'Nargila', isSpot: true, weigh: true },
      { name: 'Al Fakher · Limun-menta', kind: 'duhan', unit: 'g', opening: 300, costMfen: 12_000, category: 'Nargila', isSpot: true, weigh: true },
      { name: 'Al Fakher · Lubenica', kind: 'duhan', unit: 'g', opening: 250, costMfen: 12_000, category: 'Nargila', isSpot: true, weigh: true },
      { name: 'Al Fakher · Borovnica', kind: 'duhan', unit: 'g', opening: 150, costMfen: 12_000, category: 'Nargila', isSpot: true, weigh: true },
      { name: 'Ugalj (kocke)', kind: 'zar', unit: 'kom', opening: 103, costMfen: 25_000, category: 'Nargila', isSpot: true },
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
        categoryId: categoryIds.get(item.category) ?? null,
        brand: null,
        packName: item.packName ?? null,
        packQty: item.packQty ?? null,
        avgCostMfen: item.costMfen,
        lastCostMfen: item.costMfen,
        countMethod: item.weigh ? 'weigh' : 'count',
        tareG: null,
        toleranceQty: 0,
        parQty: null,
        isSpot: item.isSpot ? 1 : 0,
        available: 1,
        active: 1,
      }).run()

      tx.insert(schema.stockMovements).values({
        id: id(),
        venueId,
        stockItemId: itemId,
        type: 'opening',
        qtyDelta: item.opening,
        unitCostMfen: item.costMfen,
        refType: 'venue_setup',
        refId: venueId,
        userId: null,
        shiftId: null,
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
      staffDrink?: boolean
    }
    const menu: SeedProduct[] = [
      { name: 'Kafa', category: 'Kafa', priceFen: 150, recipe: [['Kafa (mljevena)', 7], ['Šećer', 5]], favourite: true, staffDrink: true },
      { name: 'Kafa s mlijekom', category: 'Kafa', priceFen: 200, recipe: [['Kafa (mljevena)', 7], ['Šećer', 5], ['Mlijeko', 30]], staffDrink: true },
      { name: 'Nes', category: 'Kafa', priceFen: 250, recipe: [['Nes', 1], ['Šećer', 5]] },
      { name: 'Čaj', category: 'Čaj', priceFen: 200, recipe: [['Čaj (vrećice)', 1], ['Šećer', 5]], favourite: true, staffDrink: true },
      { name: 'Coca-Cola', category: 'Bezalkoholna', priceFen: 300, sells: 'Coca-Cola 0,25 l', favourite: true },
      { name: 'Fanta', category: 'Bezalkoholna', priceFen: 300, sells: 'Fanta 0,25 l' },
      { name: 'Cedevita', category: 'Bezalkoholna', priceFen: 250, sells: 'Cedevita' },
      { name: 'Sok od narandže', category: 'Bezalkoholna', priceFen: 300, sells: 'Sok od narandže' },
      { name: 'Voda 0,5 l', category: 'Bezalkoholna', priceFen: 150, sells: 'Voda 0,5 l', staffDrink: true },
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
        shortName: null,
        searchAliases: '',
        priceFen: product.priceFen,
        kind: product.kind ?? 'simple',
        sellsStockItemId: product.sells ? requireStock(stockIds, product.sells) : null,
        shishaGrams: product.shishaGrams ?? null,
        shishaGramsMeasuredAt: null,
        coalPcs: product.coalPcs ?? null,
        staffDrinkAllowed: product.staffDrink ? 1 : 0,
        isFavourite: product.favourite ? 1 : 0,
        sort: i + 1,
        active: 1,
        createdAt: now,
        updatedAt: null,
      }).run()

      // One open price row per product. `price_history_open_uq` — a partial
      // unique index on `valid_to IS NULL` — is what makes "the current price"
      // exactly one row, and a price change closes this one and writes another.
      tx.insert(schema.priceHistory).values({
        id: id(),
        venueId,
        productId,
        priceFen: product.priceFen,
        validFrom: now,
        validTo: null,
        changedBy: null,
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
