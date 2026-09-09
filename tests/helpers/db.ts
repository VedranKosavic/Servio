/**
 * A whole café in memory.
 *
 * `:memory:` is a real SQLite database that lives only inside this process and
 * disappears when the test ends — so every test gets the *real* migrations and
 * the *real* triggers on a clean venue, in a few milliseconds, with nothing to
 * clean up. A test running against a different schema, or with the triggers
 * missing, would prove nothing about production.
 */
import { and, eq } from 'drizzle-orm'
import { openDatabase, type Db } from '../../server/database/client'
import * as schema from '../../server/database/schema'
import { seed } from '../../server/database/seed'

export interface Fixture {
  db: Db
  close: () => void
  venueId: string
  userId: (name: string) => string
  tableId: (name: string) => string
  productId: (name: string) => string
  stockItemId: (name: string) => string
  onHand: (name: string) => number
}

export function makeFixture(): Fixture {
  const { db, sqlite } = openDatabase(':memory:')
  seed(db)

  const venueId = db.select().from(schema.venues).get()!.id

  const byName = <T extends { id: string, name: string }>(rows: T[], name: string): string => {
    const row = rows.find(r => r.name === name)
    if (!row) throw new Error(`fixture: no row named "${name}"`)
    return row.id
  }

  const users = db.select().from(schema.users).all()
  const tables = db.select().from(schema.tables).all()
  const products = db.select().from(schema.products).all()
  const stockItems = db.select().from(schema.stockItems).all()

  return {
    db,
    close: () => sqlite.close(),
    venueId,
    userId: name => byName(users, name),
    tableId: name => byName(tables, name),
    productId: name => byName(products, name),
    stockItemId: name => byName(stockItems, name),
    onHand: (name) => {
      const itemId = byName(stockItems, name)
      return db.select().from(schema.stockMovements)
        .where(and(
          eq(schema.stockMovements.venueId, venueId),
          eq(schema.stockMovements.stockItemId, itemId),
        ))
        .all()
        .reduce((sum, m) => sum + m.qtyDelta, 0)
    },
  }
}

export { schema }
