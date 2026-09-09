/**
 * `0003_phase3.sql` replayed on a database that already holds a night.
 *
 * The file does something the two before it deliberately avoided: it **rebuilds
 * `tabs`**. SQLite has no way to take `NOT NULL` off a column, and *Bez stola*
 * (PHASE3 §1.11) needs `table_id` nullable, so the migration copies the table
 * into a new shape, drops the original and renames — which drops the original's
 * indexes and triggers on the way through, and leaves `orders`, `payments` and
 * `line_adjustments` pointing at a table that does not exist for three
 * statements.
 *
 * That is the whole reason this file exists. Four things are checked on a
 * database with real rows in it: the rows survive, the six indexes come back,
 * `PRAGMA foreign_key_check` is empty, and `applyTriggers()` puts every trigger
 * back afterwards — because the migrator runs first and the boot sequence in
 * `openDatabase` is `migrate()` then `applyTriggers()`, in that order.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { applyPragmas, applyTriggers, MIGRATIONS_DIR, openDatabase } from '../../server/database/client'
import * as schema from '../../server/database/schema'
import { TRIGGER_NAMES } from '#shared/constants'

const MIGRATIONS = resolve(process.cwd(), MIGRATIONS_DIR)
const PHASE3_SQL = readFileSync(join(MIGRATIONS, '0003_phase3.sql'), 'utf8')

const scratchDirs: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sank-0003-'))
  scratchDirs.push(dir)
  return dir
}
afterEach(() => {
  while (scratchDirs.length) rmSync(scratchDirs.pop()!, { recursive: true, force: true })
})

/**
 * Replay migrations 0000–0002 out of a scratch folder holding a trimmed
 * journal. Each .sql is copied byte for byte, so its hash still matches and the
 * real migrator afterwards recognises them as applied and runs only 0003.
 */
function korak2Database(file: string): void {
  const dir = scratch()
  mkdirSync(join(dir, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'))
  const kept = journal.entries.filter((e: { idx: number }) => e.idx <= 2)
  journal.entries = kept
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal, null, 2))
  for (const entry of kept as { tag: string }[]) {
    writeFileSync(join(dir, `${entry.tag}.sql`), readFileSync(join(MIGRATIONS, `${entry.tag}.sql`), 'utf8'))
  }

  const sqlite = new Database(file)
  applyPragmas(sqlite)
  migrate(drizzle(sqlite), { migrationsFolder: dir })
  // The café's server has the Korak 2 triggers installed when the new build
  // boots, and `applyTriggers()` runs *after* `migrate()` — so 0003 executes
  // with `tabs_no_delete` and friends still in force.
  applyTriggers(sqlite)
  sqlite.close()
}

interface Seeded { venueId: string, tabId: string, paidTabId: string, orderId: string }

/** A night's rows, in the shape the schema had before this migration. */
function korak2Data(file: string): Seeded {
  const sqlite = new Database(file)
  applyPragmas(sqlite)

  const venueId = randomUUID()
  const amarId = randomUUID()
  const tableId = randomUUID()
  const table2Id = randomUUID()
  const tabId = randomUUID()
  const paidTabId = randomUUID()
  const orderId = randomUUID()
  const shiftId = randomUUID()
  const now = new Date().toISOString()

  sqlite.exec('BEGIN')
  sqlite.prepare('INSERT INTO venues (id, name, slug, created_at) VALUES (?,?,?,?)')
    .run(venueId, 'Lounge', 'lounge', now)
  sqlite.prepare(
    'INSERT INTO users (id, venue_id, name, initials, role, active, created_at) VALUES (?,?,?,?,?,1,?)',
  ).run(amarId, venueId, 'Amar', 'AM', 'waiter', now)
  for (const [id, name, col] of [[tableId, 'Sto 1', 1], [table2Id, 'Sto 2', 2]] as const) {
    sqlite.prepare(
      'INSERT INTO tables (id, venue_id, name, zone, col, row, sort, active) VALUES (?,?,?,?,?,?,?,1)',
    ).run(id, venueId, name, 'unutra', col, 1, col)
  }
  sqlite.prepare(
    'INSERT INTO shifts (id, venue_id, business_date, status, opened_by, opened_at, created_at)'
    + ' VALUES (?,?,?,?,?,?,?)',
  ).run(shiftId, venueId, '2026-09-08', 'open', amarId, now, now)
  sqlite.prepare(
    'INSERT INTO tabs (id, venue_id, table_id, client_id, status, shift_id, opened_by, opened_at,'
    + ' assigned_to) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(tabId, venueId, tableId, randomUUID(), 'open', shiftId, amarId, now, amarId)
  sqlite.prepare(
    'INSERT INTO tabs (id, venue_id, table_id, client_id, status, shift_id, opened_by, opened_at,'
    + ' assigned_to, closed_at, closed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(paidTabId, venueId, table2Id, randomUUID(), 'paid', shiftId, amarId, now, amarId, now, amarId)
  // The row that makes the foreign key part of this test real.
  sqlite.prepare(
    'INSERT INTO orders (id, venue_id, tab_id, client_id, locked_by, shift_id, shift_seq, created_at)'
    + ' VALUES (?,?,?,?,?,?,?,?)',
  ).run(orderId, venueId, tabId, randomUUID(), amarId, shiftId, 1, now)
  sqlite.exec('COMMIT')
  sqlite.close()

  return { venueId, tabId, paidTabId, orderId }
}

function names(sqlite: Database.Database, type: 'index' | 'trigger', table?: string): string[] {
  const rows = sqlite.prepare(
    `SELECT name FROM sqlite_master WHERE type = ?${table ? ' AND tbl_name = ?' : ''}`,
  ).all(...(table ? [type, table] : [type])) as { name: string }[]
  // `sqlite_autoindex_*` is the index SQLite makes for a PRIMARY KEY itself.
  return rows.map(r => r.name).filter(n => !n.startsWith('sqlite_autoindex')).sort()
}

describe('0003_phase3.sql — the shape of the file', () => {
  it('defers the foreign keys rather than trying to switch them off', () => {
    // `PRAGMA foreign_keys` is a no-op inside a transaction and the migrator
    // wraps every file in one; `defer_foreign_keys` is the one that works there.
    expect(PHASE3_SQL).toContain('PRAGMA defer_foreign_keys=ON;')
    expect(PHASE3_SQL).not.toContain('PRAGMA foreign_keys=OFF;')
  })

  it('re-creates every index the dropped table carried', () => {
    for (const index of [
      'tabs_client_uq', 'tabs_one_open_per_table_uq', 'tabs_unpaid_client_uq',
      'tabs_venue_status_idx', 'tabs_shift_idx', 'tabs_assigned_idx',
    ]) {
      expect(PHASE3_SQL).toContain(index)
    }
  })

  it('rebuilds `tabs` and nothing else', () => {
    expect(PHASE3_SQL.match(/__new_\w+/g)?.map(m => m.replace('__new_', ''))).toEqual(
      ['tabs', 'tabs', 'tabs'],
    )
  })
})

describe('0003 on a database that already holds a night', () => {
  it('keeps the rows, the indexes and the foreign keys, and the triggers come back', () => {
    const dir = scratch()
    const file = join(dir, 'night.db')
    korak2Database(file)
    const seeded = korak2Data(file)

    const { sqlite, db } = openDatabase(file)
    try {
      // The rows are still there, with their columns intact.
      const tabs = db.select().from(schema.tabs).all()
      expect(tabs.map(t => t.id).sort()).toEqual([seeded.tabId, seeded.paidTabId].sort())
      expect(tabs.find(t => t.id === seeded.paidTabId)?.status).toBe('paid')
      expect(db.select().from(schema.orders).all()).toHaveLength(1)

      // The rebuild did not orphan the order that points at the tab.
      expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(sqlite.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })

      expect(names(sqlite, 'index', 'tabs')).toEqual([
        'tabs_assigned_idx', 'tabs_client_uq', 'tabs_one_open_per_table_uq',
        'tabs_shift_idx', 'tabs_unpaid_client_uq', 'tabs_venue_status_idx',
      ])

      // `applyTriggers()` ran after `migrate()` and put back what DROP TABLE took.
      const installed = new Set(names(sqlite, 'trigger'))
      expect(TRIGGER_NAMES.filter(t => !installed.has(t))).toEqual([])
    } finally {
      sqlite.close()
    }
  })

  it('lets a tab be opened with no table at all, and more than one of them', () => {
    const dir = scratch()
    const file = join(dir, 'bez-stola.db')
    korak2Database(file)
    const seeded = korak2Data(file)

    const { sqlite } = openDatabase(file)
    try {
      const venue = seeded.venueId
      const user = (sqlite.prepare('SELECT id FROM users').get() as { id: string }).id
      const insert = sqlite.prepare(
        'INSERT INTO tabs (id, venue_id, table_id, client_id, status, opened_by, opened_at,'
        + ' assigned_to) VALUES (?,?,NULL,?,?,?,?,?)',
      )
      const now = new Date().toISOString()
      insert.run(randomUUID(), venue, randomUUID(), 'open', user, now, user)
      // Two NULLs are *different* values to a unique index in SQLite, which is
      // exactly why `tabs_one_open_per_table_uq` needed no change: the bar can
      // hold a dozen table-less tabs while Sto 1 still holds exactly one.
      insert.run(randomUUID(), venue, randomUUID(), 'open', user, now, user)

      const loose = sqlite.prepare(
        `SELECT COUNT(*) AS n FROM tabs WHERE table_id IS NULL AND status = 'open'`,
      ).get() as { n: number }
      expect(loose.n).toBe(2)
    } finally {
      sqlite.close()
    }
  })

  it('gives a venue one *Dodatni žar* product and refuses a second', () => {
    const { sqlite } = openDatabase(':memory:')
    try {
      const venue = randomUUID()
      const category = randomUUID()
      const now = new Date().toISOString()
      sqlite.prepare('INSERT INTO venues (id, name, slug, created_at) VALUES (?,?,?,?)')
        .run(venue, 'Lounge', 'lounge', now)
      sqlite.prepare('INSERT INTO categories (id, venue_id, name, sort) VALUES (?,?,?,1)')
        .run(category, venue, 'Nargile')
      const product = sqlite.prepare(
        'INSERT INTO products (id, venue_id, category_id, name, price_fen, system_key, created_at)'
        + ' VALUES (?,?,?,?,?,?,?)',
      )
      product.run(randomUUID(), venue, category, 'Dodatni žar', 0, 'zar', now)
      expect(() => product.run(randomUUID(), venue, category, 'Žar 2', 0, 'zar', now)).toThrow()
      // The partial index indexes only the rows that have a key, so any number
      // of ordinary products may sit at NULL.
      product.run(randomUUID(), venue, category, 'Kafa', 200, null, now)
      product.run(randomUUID(), venue, category, 'Čaj', 200, null, now)
    } finally {
      sqlite.close()
    }
  })

  it('stores one note per person per shift and lets it be rewritten', () => {
    const { sqlite } = openDatabase(':memory:')
    try {
      const venue = randomUUID()
      const user = randomUUID()
      const shift = randomUUID()
      const now = new Date().toISOString()
      sqlite.prepare('INSERT INTO venues (id, name, slug, created_at) VALUES (?,?,?,?)')
        .run(venue, 'Lounge', 'lounge', now)
      sqlite.prepare(
        'INSERT INTO users (id, venue_id, name, initials, role, active, created_at) VALUES (?,?,?,?,?,1,?)',
      ).run(user, venue, 'Amar', 'AM', 'waiter', now)
      sqlite.prepare(
        'INSERT INTO shifts (id, venue_id, business_date, status, opened_by, opened_at, created_at)'
        + ' VALUES (?,?,?,?,?,?,?)',
      ).run(shift, venue, '2026-09-08', 'open', user, now, now)

      const id = randomUUID()
      sqlite.prepare(
        'INSERT INTO staff_notes (id, venue_id, shift_id, user_id, body, created_at) VALUES (?,?,?,?,?,?)',
      ).run(id, venue, shift, user, 'Gužva do 2', now)

      // Not a ledger table: no trigger stands in the way of a correction.
      sqlite.prepare('UPDATE staff_notes SET body = ?, updated_at = ? WHERE id = ?')
        .run('Gužva do 3', now, id)
      expect((sqlite.prepare('SELECT body FROM staff_notes WHERE id = ?').get(id) as { body: string }).body)
        .toBe('Gužva do 3')
      sqlite.prepare('DELETE FROM staff_notes WHERE id = ?').run(id)
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM staff_notes').get()).toEqual({ n: 0 })
    } finally {
      sqlite.close()
    }
  })
})
