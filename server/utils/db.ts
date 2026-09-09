/**
 * The single SQLite connection, shared by every route and service.
 *
 * Nuxt's dev server reloads modules on every save (HMR). Without the
 * `globalThis` cache below we would open a new connection — and re-run the
 * migrations — on every keystroke, so the instance is parked on the global
 * object where reloads cannot reach it.
 */
import type Database from 'better-sqlite3'
import { isAbsolute, resolve } from 'node:path'
import { openDatabase, schema, type Db } from '../database/client'

declare global {
  // eslint-disable-next-line no-var
  var __sankDb: { db: Db, sqlite: Database.Database } | undefined
}

function create(): { db: Db, sqlite: Database.Database } {
  const configured = process.env.DB_PATH || 'data/sank.db'
  const file = isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
  return openDatabase(file)
}

export function useDb(): Db {
  if (!globalThis.__sankDb) globalThis.__sankDb = create()
  return globalThis.__sankDb.db
}

/** The raw better-sqlite3 handle, for the few things Drizzle does not do. */
export function useSqlite(): Database.Database {
  if (!globalThis.__sankDb) globalThis.__sankDb = create()
  return globalThis.__sankDb.sqlite
}

export { schema }
export type { Db }
