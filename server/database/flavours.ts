/**
 * `npm run db:flavours` — bring the tobacco shelf onto the café's real list.
 *
 * The seed ships six Al Fakher aromas because a fresh clone needs *something*
 * in the picker; the café carries more than that, and the owner asked for the
 * Adalya line by name. A migration cannot do this — migrations add tables, not
 * rows — and a reseed is not an option on a database with a night's takings in
 * it, so this is the same shape as `db:roster`: a list in code, applied to a
 * live database through the app's own door.
 *
 * **Through the app's own door** is the load-bearing part. Every aroma is
 * created by `createStockItem()`, which writes the `log_entries` row, bumps
 * `stock` **and** `menu` (the waiter's picker comes from `/api/bootstrap`, so
 * an aroma that moved only the stock version would not appear on a phone until
 * something else changed the menu) and announces the change to the poll. A
 * hand-written INSERT would skip all three.
 *
 * It is **additive and idempotent**. An aroma already on the shelf is left
 * exactly as it is — its cost, its opening stock and its movements are the
 * café's, not this file's — and running the script twice does nothing the
 * second time. Nothing here deactivates anything: `db:retire` is the script
 * that takes an article off the shelf, and it says so out loud.
 *
 * A new aroma arrives **at zero grams**, which is the honest opening balance:
 * the box is on the shelf the moment a *Prijem robe* says it is, and until then
 * the picker shows it greyed with *Nema* rather than pretending to a stock
 * nobody counted.
 *
 * **The seed is deliberately not changed to match.** `server/database/seed.ts`
 * is the fixture eight tests measure real scenarios against — 15 kg of tobacco
 * in, 4 kg left, 550 expected bowls against 500 sold — and four more aromas on
 * the shelf move every one of those numbers without teaching anybody anything.
 * The café's actual list belongs to the café's actual database, which is what
 * this script is for; a fresh clone gets the six Al Fakher the seed has always
 * had, and one command more if it wants the rest.
 */
import { and, eq } from 'drizzle-orm'
import { schema, type Db } from './client'
import { createStockItem } from '../services/admin'
import type { Actor } from '../services/types'

/**
 * What the café smokes, as the owner named it.
 *
 * The brand is carried in the name — "Adalya · Ice" — because that is how the
 * waiter asks for it at the bar and how the picker has always read; `brand` is
 * set as well, so a later report can group by it without parsing a string.
 *
 * `cost_mfen` is a **placeholder at the café's current Al Fakher price**, and
 * the first *Prijem robe* replaces it with what was actually paid (the moving
 * average is retroactive on the first real cost). It must not be zero: a zero
 * cost silently switches off `variance_fen`, `waste_events.cost_fen` and
 * *utrošak*, which is the one thing `schema.test.ts` refuses to allow.
 */
export interface FlavourSpec {
  name: string
  brand: string
}

const COST_MFEN = 12_000

export const TOBACCOS: FlavourSpec[] = [
  { name: 'Al Fakher · Jabuka', brand: 'Al Fakher' },
  { name: 'Al Fakher · Menta', brand: 'Al Fakher' },
  { name: 'Al Fakher · Grožđe', brand: 'Al Fakher' },
  { name: 'Al Fakher · Limun-menta', brand: 'Al Fakher' },
  { name: 'Al Fakher · Lubenica', brand: 'Al Fakher' },
  { name: 'Al Fakher · Borovnica', brand: 'Al Fakher' },
  { name: 'Adalya · Ice', brand: 'Adalya' },
  { name: 'Adalya · Swiss', brand: 'Adalya' },
  { name: 'Adalya · Baku', brand: 'Adalya' },
  { name: 'Adalya · Moscow', brand: 'Adalya' },
]

/** Folded the way the rest of the app folds a name, so case and spacing cannot duplicate a shelf. */
function fold(name: string): string {
  return name.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export interface FlavourSyncResult {
  added: string[]
  kept: string[]
}

/**
 * Add every aroma on `TOBACCOS` that the shelf has not got, and touch nothing
 * else. Returns what it did, so the CLI can print it and a test can assert it.
 */
export function syncFlavours(db: Db, venueId: string, actorId: string): FlavourSyncResult {
  const existing = new Set(
    db.select({ name: schema.stockItems.name })
      .from(schema.stockItems)
      .where(and(
        eq(schema.stockItems.venueId, venueId),
        eq(schema.stockItems.kind, 'duhan'),
      ))
      .all()
      .map(row => fold(row.name)),
  )

  // The aromas hang off the same product category the seed files them under, so
  // *Stanje šanka* groups them where the owner expects. A café whose category
  // is named something else gets them uncategorised rather than a crash.
  const category = db.select({ id: schema.categories.id, name: schema.categories.name })
    .from(schema.categories)
    .where(eq(schema.categories.venueId, venueId))
    .all()
    .find(row => fold(row.name) === 'nargila')

  // The script runs with no request behind it, so the actor is built here
  // rather than by `authorizeRequest`: an admin, on no device, in no session.
  // `createStockItem` uses only `userId` — the log entry's author.
  const actor: Actor = {
    venueId,
    userId: actorId,
    role: 'admin',
    sessionId: 'db:flavours',
    sessionKind: 'admin',
    deviceId: null,
    deviceBoundUserId: null,
    borrowed: false,
    mode: null,
  }

  const added: string[] = []
  const kept: string[] = []

  for (const spec of TOBACCOS) {
    if (existing.has(fold(spec.name))) {
      kept.push(spec.name)
      continue
    }
    createStockItem(db, venueId, actor, {
      name: spec.name,
      kind: 'duhan',
      base_unit: 'g',
      brand: spec.brand,
      ...(category ? { category_id: category.id } : {}),
      last_cost_mfen: COST_MFEN,
      // A box is weighed, not counted, and it is a spot-check article — the
      // same three settings the seeded aromas carry.
      count_method: 'weigh',
      tare_g: 40,
      tolerance_qty: 5,
      is_spot: true,
    })
    added.push(spec.name)
  }

  return { added, kept }
}
