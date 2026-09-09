/**
 * The house rules of the schema, checked against a real migrated database.
 *
 * Everything here is a rule a person would otherwise have to remember while
 * adding a table at midnight: that the new table carries `venue_id`, that its
 * unique index is scoped by it, that its ledger trigger survived, that its cost
 * is not silently zero. A rule nothing checks is a comment.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GLOBAL_UNIQUE_INDEXES, TRIGGER_NAMES, VENUELESS_TABLES } from '#shared/constants'
import { makeFixture, schema, type Fixture } from '../helpers/db'

let f: Fixture

beforeEach(() => {
  f = makeFixture()
})

afterEach(() => {
  f.close()
})

interface IndexRow { seq: number, name: string, unique: number, origin: string, partial: number }
interface ColumnRow { cid: number, name: string, type: string, notnull: number, pk: number }

function tableNames(): string[] {
  return f.sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map(r => (r as { name: string }).name)
    .filter(name => !name.startsWith('sqlite_'))
}

function columns(table: string): ColumnRow[] {
  return f.sqlite.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as ColumnRow[]
}

function indexList(table: string): IndexRow[] {
  return f.sqlite.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all() as IndexRow[]
}

function indexColumns(index: string): string[] {
  return f.sqlite
    .prepare(`PRAGMA index_info(${JSON.stringify(index)})`)
    .all()
    .map(r => (r as { name: string | null }).name ?? '')
}

describe('every business table is scoped to a venue', () => {
  it('carries venue_id, so a second café is an insert and not a rewrite', () => {
    const exempt = new Set<string>(VENUELESS_TABLES)
    const missing = tableNames()
      .filter(t => !exempt.has(t) && t !== '__drizzle_migrations')
      .filter(t => !columns(t).some(c => c.name === 'venue_id'))

    expect(missing).toEqual([])
  })
})

describe('unique indexes', () => {
  /**
   * "That the schema declares" is load-bearing. `PRAGMA index_list` returns
   * three origins: `c` for a CREATE INDEX we wrote, `u` for a UNIQUE column
   * constraint, and `pk` for the index SQLite builds behind a primary key.
   * Every table here has `id TEXT PRIMARY KEY`, so every table also has a
   * `sqlite_autoindex_*` row with `unique: 1, origin: 'pk'`. A check that did
   * not filter would fail on essentially every table on its first run.
   */
  it('are scoped by venue_id unless they are on the global list', () => {
    const global = new Set<string>(GLOBAL_UNIQUE_INDEXES)
    const offenders: string[] = []

    for (const table of tableNames()) {
      for (const index of indexList(table)) {
        if (index.unique !== 1 || index.origin !== 'c') continue
        const first = indexColumns(index.name)[0]
        if (first !== 'venue_id' && !global.has(index.name)) {
          offenders.push(`${table}.${index.name} (first column: ${first})`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('has every name on the global list actually present', () => {
    const declared = new Set(
      tableNames().flatMap(t => indexList(t).filter(i => i.origin === 'c').map(i => i.name)),
    )
    for (const name of GLOBAL_UNIQUE_INDEXES) expect(declared).toContain(name)
  })

  it('gives every table a primary key of `id`, or the one composite one', () => {
    for (const table of tableNames()) {
      if (table === '__drizzle_migrations') continue
      const pk = columns(table).filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name)
      const expected = table === 'shift_summaries'
        ? ['shift_id', 'version']
        : table === 'changes' ? ['seq'] : ['id']
      expect([table, pk]).toEqual([table, expected])
    }
  })
})

describe('the triggers survived the migration', () => {
  it('has every name in TRIGGER_NAMES in sqlite_master', () => {
    const installed = new Set(
      f.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='trigger'`).all()
        .map(r => (r as { name: string }).name),
    )
    const missing = TRIGGER_NAMES.filter(name => !installed.has(name))
    expect(missing).toEqual([])
  })

  it('has retired Korak 1\'s tabs_update_guard', () => {
    const row = f.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='tabs_update_guard'`)
      .get()
    expect(row).toBeUndefined()
  })

  it('leaves the cursor tables deliberately unguarded', () => {
    const guarded = f.sqlite
      .prepare(`SELECT DISTINCT tbl_name AS t FROM sqlite_master WHERE type='trigger'`)
      .all()
      .map(r => (r as { t: string }).t)
    for (const table of ['changes', 'sessions', 'enrol_codes', 'devices', 'task_runs']) {
      expect(guarded).not.toContain(table)
    }
  })
})

describe('the seed', () => {
  /**
   * A zero cost silently switches off `variance_fen`, `waste_events.cost_fen`,
   * `stock_variance_fen` and *utrošak*. The dev seed prices every item with a
   * plausible placeholder so tests measure something; this assertion is what
   * makes adding a nineteenth-and-first item without a price a failing test
   * rather than four reports quietly reading 0,00 KM.
   */
  it('leaves no stock item with neither an average nor a last cost', () => {
    const unpriced = f.db.select().from(schema.stockItems).all()
      .filter(i => i.avgCostMfen === 0 && i.lastCostMfen === 0)
      .map(i => i.name)
    expect(unpriced).toEqual([])
  })

  it('has three roles and no `owner`', () => {
    const roles = new Set(f.db.select().from(schema.users).all().map(u => u.role))
    expect([...roles].sort()).toEqual(['admin', 'bartender', 'waiter'])
  })

  it('gives every product exactly one open price row', () => {
    const products = f.db.select().from(schema.products).all()
    const open = f.db.select().from(schema.priceHistory).all().filter(p => p.validTo === null)
    expect(open).toHaveLength(products.length)
    for (const product of products) {
      const row = open.find(p => p.productId === product.id)
      expect(row?.priceFen).toBe(product.priceFen)
    }
  })

  it('turns on the one setting the dev bar tablet needs', () => {
    const venue = f.db.select().from(schema.venues).get()!
    expect(JSON.parse(venue.settingsJson)).toEqual({ bartender_can_receive_goods: true })
  })

  it('stores PINs as scrypt hashes and never in the clear', () => {
    const amar = f.db.select().from(schema.users).all().find(u => u.name === 'Amar')!
    expect(amar.pinHash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/)
    expect(amar.pinHash).not.toContain('1111')

    // Only the admin has a way into `/a` on a laptop.
    const haris = f.db.select().from(schema.users).all().find(u => u.name === 'Haris')!
    expect(haris.email).toBe('haris@lounge.ba')
    expect(haris.passwordHash).not.toBeNull()
    expect(amar.passwordHash).toBeNull()
  })
})

describe('foreign keys', () => {
  it('are consistent after the migration and the seed', () => {
    expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('are actually switched on — SQLite ignores REFERENCES otherwise', () => {
    expect(f.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
