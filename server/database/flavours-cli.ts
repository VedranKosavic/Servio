/**
 * `npm run db:flavours` — put the café's aroma list on the shelf of an existing
 * database, in place.
 *
 * The same shape as `db:roster` and `db:retire`: a list a migration cannot
 * write sensibly, applied through the app's own `createStockItem` so the log
 * entry, both change bumps and the poll all happen; safe to run twice; and it
 * prints exactly what it added so a database that already had them shows up as
 * "0 new" rather than as a silent success. `flavours.ts` carries the list and
 * says why a new aroma opens at zero grams.
 *
 * ```
 * DB_PATH=data/sank.db npm run db:flavours
 * ```
 */
import { isAbsolute, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase, schema } from './client'
import { syncFlavours } from './flavours'

const configured = process.env.DB_PATH || 'data/sank.db'
const file = isAbsolute(configured) ? configured : resolve(process.cwd(), configured)

const { db, sqlite } = openDatabase(file)

const venue = db.select().from(schema.venues).get()
if (!venue) {
  console.error(`[sank] ${file} has no venue — run npm run db:seed first.`)
  process.exit(1)
}

// Whoever the log entry is written as. The first admin, which on this café's
// roster is Harun; a database with no admin at all cannot be written to.
const admin = db.select().from(schema.users)
  .where(eq(schema.users.role, 'admin'))
  .all()
  .find(user => user.active === 1)

if (!admin) {
  console.error(`[sank] ${file} has no active admin to attribute the change to.`)
  process.exit(1)
}

const result = syncFlavours(db, venue.id, admin.id)

console.info(
  `[sank] ${file}: ${result.added.length} nova aroma/e`
  + (result.added.length ? ` — ${result.added.join(', ')}` : '')
  + `; ${result.kept.length} već na polici.`,
)
if (result.added.length > 0) {
  console.info('[sank] nove arome stoje na 0 g — upiši ih kroz Prijem robe.')
}

sqlite.close()
