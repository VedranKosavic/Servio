/**
 * The migration, run twice: on an empty database, and on one that already holds
 * a night of Korak 1 data.
 *
 * The second one is the test that matters. The owner's café will not be wiped
 * and re-seeded — it will be `git pull`, restart, and whatever `0001_korak2.sql`
 * does to the rows that are already there. Two ways that goes wrong, both
 * checked below:
 *
 *   - **a table rebuild.** drizzle-kit answers a changed column type or
 *     nullability by copying the table into `__new_x`, dropping the original and
 *     renaming — which silently drops every trigger on it half-way through a
 *     migration and fights the foreign keys. Korak 2 is written to never need
 *     one, and the grep below is what keeps it that way.
 *   - **a column that cannot be added.** Under `foreign_keys = ON` SQLite
 *     refuses `ADD COLUMN … NOT NULL DEFAULT '' REFERENCES users(id)`, so the
 *     new mandatory FK columns are added nullable, backfilled by an UPDATE in
 *     the same file, and made mandatory by a BEFORE INSERT trigger.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import {
  applyPragmas, applyTriggers, MIGRATIONS_DIR, openDatabase,
} from '../../server/database/client'
import * as schema from '../../server/database/schema'
import { TRIGGER_NAMES } from '#shared/constants'

const MIGRATIONS = resolve(process.cwd(), MIGRATIONS_DIR)
const KORAK2_SQL = readFileSync(join(MIGRATIONS, '0001_korak2.sql'), 'utf8')

const scratchDirs: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sank-migration-'))
  scratchDirs.push(dir)
  return dir
}

afterEach(() => {
  while (scratchDirs.length) rmSync(scratchDirs.pop()!, { recursive: true, force: true })
})

describe('0001_korak2.sql — the shape of the file', () => {
  it('rebuilds no table', () => {
    expect(KORAK2_SQL).not.toContain('__new_')
  })

  it('carries the four data statements no generator can infer', () => {
    // The role rename is the one that changes what an existing row *means*.
    expect(KORAK2_SQL).toContain("UPDATE users SET role = 'admin' WHERE role = 'owner'")
    // The backfill that lets `tabs_assigned_required` be true of every row.
    expect(KORAK2_SQL).toContain('UPDATE tabs SET assigned_to = opened_by WHERE assigned_to IS NULL')
    expect(KORAK2_SQL).toContain("UPDATE users SET created_at = strftime")
    expect(KORAK2_SQL).toContain("UPDATE products SET created_at = strftime")
  })

  it('adds every REFERENCES column as nullable with no default', () => {
    // `ADD COLUMN … NOT NULL … REFERENCES` is the statement SQLite refuses
    // outright once foreign keys are on, and `openDatabase` turns them on before
    // migrating. Catching it here beats catching it on the owner's laptop.
    const bad = KORAK2_SQL.split('\n')
      .filter(line => /ALTER TABLE .* ADD .*REFERENCES/.test(line))
      .filter(line => /NOT NULL|DEFAULT/.test(line))
    expect(bad).toEqual([])
  })
})

describe('a fresh database', () => {
  it('migrates, installs the triggers and passes a foreign key check', () => {
    const { sqlite, db } = openDatabase(':memory:')
    try {
      expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      const triggers = new Set(
        sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='trigger'`).all()
          .map(r => (r as { name: string }).name),
      )
      expect(TRIGGER_NAMES.filter(t => !triggers.has(t))).toEqual([])
      // The schema is live, not just present.
      expect(db.select().from(schema.venues).all()).toEqual([])
    } finally {
      sqlite.close()
    }
  })
})

/**
 * Korak 1's triggers, verbatim from the `triggers.sql` of commit `739cab7`.
 *
 * They are embedded rather than read from `server/database/triggers.sql`,
 * because that file now holds the *Korak 2* rules — and the whole point of this
 * fixture is to reproduce a database carrying the **old** ones. A real café's
 * database has these installed when the new server boots, and `applyTriggers()`
 * runs *after* `migrate()`, so the migration executes with them still in force.
 *
 * `tabs_update_guard` is the one that bites: it permits exactly one shape of tab
 * UPDATE — `open -> paid` — and the `assigned_to` backfill is not that shape.
 * On a database with a paid tab in it, a migration that does not drop this
 * trigger first aborts and the server fails to boot. That is a bug you find on
 * the owner's laptop or you find here.
 */
const KORAK1_TRIGGERS = `
CREATE TRIGGER order_lines_no_update BEFORE UPDATE ON order_lines
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER order_lines_no_delete BEFORE DELETE ON order_lines
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER tabs_no_delete BEFORE DELETE ON tabs
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER orders_update_guard BEFORE UPDATE ON orders
WHEN NOT (
  OLD.id IS NEW.id AND OLD.venue_id IS NEW.venue_id AND OLD.tab_id IS NEW.tab_id
  AND OLD.client_id IS NEW.client_id AND OLD.locked_by IS NEW.locked_by
  AND OLD.note IS NEW.note AND OLD.created_at IS NEW.created_at
  AND OLD.prepared_at IS NULL AND NEW.prepared_at IS NOT NULL
  AND OLD.prepared_by IS NULL AND NEW.prepared_by IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'orders: only prepared_at/prepared_by, once, NULL -> value'); END;
CREATE TRIGGER tabs_update_guard BEFORE UPDATE ON tabs
WHEN NOT (
  OLD.id IS NEW.id AND OLD.venue_id IS NEW.venue_id AND OLD.table_id IS NEW.table_id
  AND OLD.client_id IS NEW.client_id AND OLD.opened_by IS NEW.opened_by
  AND OLD.opened_at IS NEW.opened_at
  AND OLD.status = 'open' AND NEW.status = 'paid'
  AND OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL
  AND OLD.closed_by IS NULL AND NEW.closed_by IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'tabs: only open -> paid with closed_at/closed_by'); END;
`

/**
 * Build a database at Korak 1 — migration 0000 only — by replaying that one
 * migration out of a scratch folder holding a journal with a single entry.
 * The .sql file is copied byte for byte, so its hash matches and the real
 * migrator afterwards recognises it as already applied and runs only 0001.
 */
function korak1Database(file: string): void {
  const dir = scratch()
  mkdirSync(join(dir, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'))
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx === 0)
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal, null, 2))
  writeFileSync(
    join(dir, '0000_shiny_sumo.sql'),
    readFileSync(join(MIGRATIONS, '0000_shiny_sumo.sql'), 'utf8'),
  )

  const sqlite = new Database(file)
  applyPragmas(sqlite)
  migrate(drizzle(sqlite), { migrationsFolder: dir })
  sqlite.exec(KORAK1_TRIGGERS)
  sqlite.close()
}

/** A night of Korak 1 rows, written with the columns Korak 1 actually had. */
function korak1Data(file: string): {
  venueId: string, harisId: string, tabId: string, paidTabId: string
} {
  const sqlite = new Database(file)
  applyPragmas(sqlite)

  const venueId = randomUUID()
  const harisId = randomUUID()
  const amarId = randomUUID()
  const tableId = randomUUID()
  const tabId = randomUUID()
  const paidTabId = randomUUID()
  const tableId2 = randomUUID()
  const orderId = randomUUID()
  const now = new Date().toISOString()

  sqlite.exec('BEGIN')
  sqlite.prepare('INSERT INTO venues (id, name, slug, created_at) VALUES (?,?,?,?)')
    .run(venueId, 'Lounge', 'lounge', now)
  sqlite.prepare('INSERT INTO users (id, venue_id, name, initials, role, active) VALUES (?,?,?,?,?,1)')
    .run(harisId, venueId, 'Haris', 'HA', 'owner')
  sqlite.prepare('INSERT INTO users (id, venue_id, name, initials, role, active) VALUES (?,?,?,?,?,1)')
    .run(amarId, venueId, 'Amar', 'AM', 'waiter')
  sqlite.prepare(
    'INSERT INTO tables (id, venue_id, name, zone, col, row, sort, active) VALUES (?,?,?,?,?,?,?,1)',
  ).run(tableId, venueId, 'Sto 1', 'unutra', 1, 1, 1)
  sqlite.prepare(
    'INSERT INTO tabs (id, venue_id, table_id, client_id, status, opened_by, opened_at) '
    + 'VALUES (?,?,?,?,?,?,?)',
  ).run(tabId, venueId, tableId, randomUUID(), 'open', amarId, now)
  sqlite.prepare(
    'INSERT INTO orders (id, venue_id, tab_id, client_id, locked_by, created_at) VALUES (?,?,?,?,?,?)',
  ).run(orderId, venueId, tabId, randomUUID(), amarId, now)

  // A **paid** tab, because that is the row the backfill trips over. A fixture
  // with only open tabs passes a migration that would abort on a real café's
  // database the first evening it is deployed.
  sqlite.prepare(
    'INSERT INTO tables (id, venue_id, name, zone, col, row, sort, active) VALUES (?,?,?,?,?,?,?,1)',
  ).run(tableId2, venueId, 'Sto 2', 'unutra', 1, 2, 2)
  sqlite.prepare(
    'INSERT INTO tabs (id, venue_id, table_id, client_id, status, opened_by, opened_at, '
    + 'closed_at, closed_by) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(paidTabId, venueId, tableId2, randomUUID(), 'paid', amarId, now, now, amarId)
  sqlite.exec('COMMIT')
  sqlite.close()

  return { venueId, harisId, tabId, paidTabId }
}

describe('a database that already holds Korak 1 data', () => {
  it('upgrades in place: role renamed, assignee backfilled, triggers installed', () => {
    const dir = scratch()
    const file = join(dir, 'sank.db')
    korak1Database(file)
    const { harisId, tabId, paidTabId } = korak1Data(file)

    // This is exactly what happens on the VPS: the server boots and
    // `openDatabase` migrates, then re-applies the triggers.
    const { sqlite } = openDatabase(file)
    try {
      // The one rename. 'owner' is not an accepted role value anywhere after it.
      const roles = sqlite.prepare('SELECT DISTINCT role AS r FROM users').all()
        .map(r => (r as { r: string }).r).sort()
      expect(roles).toEqual(['admin', 'waiter'])
      const haris = sqlite.prepare('SELECT role FROM users WHERE id = ?').get(harisId)
      expect(haris).toEqual({ role: 'admin' })

      // The backfill that makes `tabs.assigned_to` true of every existing row —
      // which is why no reader needs a fallback for it.
      const tab = sqlite.prepare('SELECT assigned_to, opened_by FROM tabs WHERE id = ?').get(tabId) as
        { assigned_to: string, opened_by: string }
      expect(tab.assigned_to).toBe(tab.opened_by)

      // Including the paid one — which is only possible because the migration
      // drops Korak 1's `tabs_update_guard` before it backfills.
      const paid = sqlite
        .prepare('SELECT status, assigned_to, opened_by FROM tabs WHERE id = ?')
        .get(paidTabId) as { status: string, assigned_to: string, opened_by: string }
      expect(paid.status).toBe('paid')
      expect(paid.assigned_to).toBe(paid.opened_by)

      // '' is not a date. Every existing row got a real one.
      const blank = sqlite.prepare(`SELECT count(*) AS n FROM users WHERE created_at = ''`).get()
      expect(blank).toEqual({ n: 0 })

      // Korak 1's orders keep their NULL shift_id — the trigger guards INSERTs,
      // not history — and the foreign keys are still consistent.
      expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])

      const triggers = new Set(
        sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='trigger'`).all()
          .map(r => (r as { name: string }).name),
      )
      expect(TRIGGER_NAMES.filter(t => !triggers.has(t))).toEqual([])
      // …and Korak 1's replaced guard is gone rather than left refusing things.
      expect(triggers.has('tabs_update_guard')).toBe(false)

      // Every Korak 2 table arrived.
      const tables = new Set(
        sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all()
          .map(r => (r as { name: string }).name),
      )
      for (const t of [
        'devices', 'sessions', 'enrol_codes', 'auth_attempts', 'shifts', 'shift_members',
        'cash_movements', 'waiter_settlements', 'shift_summaries', 'payments',
        'line_adjustments', 'deliveries', 'delivery_lines', 'waste_events', 'stock_counts',
        'stock_count_lines', 'log_entries', 'alert_events', 'price_history', 'changes',
        'task_runs',
      ]) {
        expect([t, tables.has(t)]).toEqual([t, true])
      }
    } finally {
      sqlite.close()
    }
  })

  it('is idempotent: a second boot migrates nothing and re-applies the triggers', () => {
    const dir = scratch()
    const file = join(dir, 'sank.db')
    korak1Database(file)
    korak1Data(file)

    const first = openDatabase(file)
    first.sqlite.close()

    // Boot again, the way a restart does.
    const { sqlite } = openDatabase(file)
    try {
      // `applyTriggers` is a DROP + CREATE per trigger, so running it a third
      // time by hand must also be a no-op rather than a duplicate-name error.
      applyTriggers(sqlite)
      applyTriggers(sqlite)

      const count = sqlite
        .prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='trigger'`)
        .get() as { n: number }
      expect(count.n).toBe(TRIGGER_NAMES.length)
      expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      sqlite.close()
    }
  })
})
