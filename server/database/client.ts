/**
 * Opening the database, and the two boot steps that must follow it.
 *
 * better-sqlite3 is *synchronous*: a query blocks until it returns. For one
 * local file that is both fast and a gift — an order lock is
 * `insert tab → insert order → insert lines → insert movements` as plain
 * top-to-bottom code, with no `await` in the middle where a second request
 * could interleave and half-write a round.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

/** Where the committed migrations live, relative to the project root. */
export const MIGRATIONS_DIR = 'server/database/migrations'
const TRIGGERS_FILE = 'server/database/triggers.sql'

/**
 * The pragmas every connection needs, applied the same way in production and in
 * a test's `:memory:` database — a test running under different rules is a test
 * that proves nothing.
 */
export function applyPragmas(sqlite: Database.Database): void {
  // WAL = Write-Ahead Logging. Writes go to a side file and are folded in
  // later, so a reader (the bartender's ticket screen) never blocks on a writer
  // (a waiter locking a round). The default mode would make them queue.
  sqlite.pragma('journal_mode = WAL')
  // SQLite ignores REFERENCES unless this is on — off by default, per connection.
  sqlite.pragma('foreign_keys = ON')
  // If another connection holds the write lock, wait up to 5 s instead of
  // failing instantly with SQLITE_BUSY.
  sqlite.pragma('busy_timeout = 5000')
}

/**
 * Re-create every trigger in `triggers.sql`.
 *
 * Runs after `migrate()` at every boot — see the header of that file for why it
 * cannot simply be part of a migration. Cheap (~50 ms) and safe to repeat.
 */
export function applyTriggers(sqlite: Database.Database): void {
  sqlite.exec(readTriggersSql())
}

function readTriggersSql(): string {
  // Read from the working directory first: that is how the app runs in dev and
  // on the VPS, where the source tree sits next to the build. The second path
  // is the fallback for a runner started from somewhere else (vitest, a script).
  const candidates = [
    resolve(process.cwd(), TRIGGERS_FILE),
    resolve(dirname(fileURLToPath(import.meta.url)), 'triggers.sql'),
  ]
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      // try the next one
    }
  }
  throw new Error(`triggers.sql not found (looked in: ${candidates.join(', ')})`)
}

/**
 * Run the committed migrations with foreign keys switched **off**, then prove
 * nothing was orphaned.
 *
 * This is SQLite's own prescription, not a shortcut. SQLite cannot take
 * `NOT NULL` off a column; the only way is to build the new shape beside the
 * old one, copy the rows, drop the original and rename — and while the original
 * is gone, every child row pointing at it is briefly an orphan.
 * `0003_phase3.sql` does exactly that to `tabs` (PHASE3 §1.11).
 *
 * The pragma has to be set *here* rather than inside the .sql file for a reason
 * worth knowing: **`PRAGMA foreign_keys` is silently ignored inside a
 * transaction**, and drizzle's migrator wraps each file in one. Its deferred
 * cousin does work there, but deferring is not enough either — SQLite counts
 * violations as they happen and a rename does not decrement that counter, so
 * the COMMIT fails anyway.
 *
 * So: off before, `foreign_key_check` after, and back on. The check is the part
 * that matters — it walks every row of every child table and returns the ones
 * whose parent is missing. An empty answer means the rebuild kept its promises;
 * anything else stops the boot here rather than one query at a time on a
 * Saturday night.
 */
function migrateWithForeignKeysOff(sqlite: Database.Database, db: Db): void {
  sqlite.pragma('foreign_keys = OFF')
  try {
    migrate(db, { migrationsFolder: resolve(process.cwd(), MIGRATIONS_DIR) })
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }

  const orphans = sqlite.prepare('PRAGMA foreign_key_check').all() as {
    table: string, rowid: number, parent: string
  }[]
  if (orphans.length > 0) {
    const first = orphans.slice(0, 5)
      .map(o => `${o.table}.rowid=${o.rowid} -> ${o.parent}`)
      .join(', ')
    throw new Error(
      `migration left ${orphans.length} orphaned row(s): ${first}`
      + (orphans.length > 5 ? ', …' : ''),
    )
  }
}

/**
 * Open a database, bring the schema up to date and install the triggers.
 * `:memory:` gives a throwaway database that lives only inside this process —
 * exactly what a test wants, with the real migrations and the real triggers.
 */
export function openDatabase(file: string): { db: Db, sqlite: Database.Database } {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })

  const sqlite = new Database(file)
  applyPragmas(sqlite)

  const db = drizzle(sqlite, { schema })
  migrateWithForeignKeysOff(sqlite, db)
  applyTriggers(sqlite)

  return { db, sqlite }
}

export { schema }
