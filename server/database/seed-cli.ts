/**
 * `npm run db:seed` — open the real database file, migrate it, apply the
 * triggers and seed it if it is empty. Run through `tsx`, which compiles
 * TypeScript on the fly so this file needs no build step of its own.
 */
import { isAbsolute, resolve } from 'node:path'
import { openDatabase } from './client'
import { isEmpty, seed } from './seed'

const configured = process.env.DB_PATH || 'data/sank.db'
const file = isAbsolute(configured) ? configured : resolve(process.cwd(), configured)

const { db, sqlite } = openDatabase(file)

if (!isEmpty(db)) {
  console.info(`[sank] ${file} already has a venue — nothing to seed.`)
} else {
  seed(db)
  console.info(`[sank] seeded ${file}: venue "Lounge", 27 tables, 14 products, 19 stock items.`)
}

sqlite.close()
