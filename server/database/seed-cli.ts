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
  // Dev secrets — the PINs and the admin password of `docs/BACKEND.md` §5.6 —
  // are an explicit decision, never an environment guess. On a production
  // install the six people arrive with no PIN and cannot log in until the owner
  // sets them in `/a`, which is the only way a default PIN never reaches a café.
  const devSecrets = process.env.NODE_ENV !== 'production'
  seed(db, { devSecrets })
  console.info(`[sank] seeded ${file}: venue "Lounge", 27 tables, 14 products, 19 stock items.`)
  if (!devSecrets) console.info('[sank] postavi PIN-ove u /a')
}

sqlite.close()
