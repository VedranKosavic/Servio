/**
 * `npm run db:seed` — open the real database file, migrate it, apply the
 * triggers and seed it if it is empty. Run through `tsx`, which compiles
 * TypeScript on the fly so this file needs no build step of its own.
 */
import { isAbsolute, resolve } from 'node:path'
import { count } from 'drizzle-orm'
import { openDatabase } from './client'
import * as schema from './schema'
import { isEmpty, seed } from './seed'
import { getHealth } from '../services/bootstrap'

const configured = process.env.DB_PATH || 'data/sank.db'
const file = isAbsolute(configured) ? configured : resolve(process.cwd(), configured)

const { db, sqlite } = openDatabase(file)

if (!isEmpty(db)) {
  console.info(`[sank] ${file} already has a venue — nothing to seed.`)
} else {
  // Dev secrets — the PINs and the admin password of `docs/BACKEND.md` §5.6 —
  // are an explicit decision, never an environment guess. On a production
  // install the six people arrive with no PIN and cannot log in until the owner
  // sets them in `/admin`, which is the only way a default PIN never reaches a
  // café.
  const devSecrets = process.env.NODE_ENV !== 'production'
  // The cast is the same kind of decision, and the same kind of flag. The venue
  // has three accounts — Haris, Amar, Emir — and that is what a fresh clone and
  // the café's own database get. The Playwright suite needs somebody to hand a
  // float to and somebody to swap a shift with, so its harness sets
  // `SANK_SEED_CAST=full` and gets Lejla, Dino and Tarik as well. Spelled out
  // rather than inferred from `NODE_ENV`, so a test cast can never arrive in a
  // café as a stranger's name on the lock screen.
  const cast = process.env.SANK_SEED_CAST === 'full' ? 'full' : 'default'
  seed(db, { devSecrets, cast })
  // Counted, not written down: the line said "14 products" for as long as the
  // seed had fourteen, and then it said it for a while longer.
  const { tables, products } = getHealth(db)
  const items = db.select({ n: count() }).from(schema.stockItems).get()?.n ?? 0
  console.info(
    `[sank] seeded ${file}: venue "Lounge", ${tables} tables, ${products} products, ${items} stock items.`,
  )
  if (!devSecrets) console.info('[sank] postavi PIN-ove u /admin')
}

sqlite.close()
