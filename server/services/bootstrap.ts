/**
 * `GET /api/bootstrap` — everything a phone needs before it can show a screen:
 * who works here, what the floor looks like, and what is on the menu.
 *
 * One request instead of six, because a waiter opening the app on café Wi-Fi
 * should wait once.
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import type { Bootstrap, Flavour } from '#shared/types'
import type { Queryable } from './types'
import { onHandByItem } from './stock'

export function getBootstrap(db: Queryable, venueId: string): Bootstrap {
  const venue = db.select().from(schema.venues).where(eq(schema.venues.id, venueId)).get()!

  const users = db.select()
    .from(schema.users)
    .where(and(eq(schema.users.venueId, venueId), eq(schema.users.active, 1)))
    .orderBy(asc(schema.users.name))
    .all()

  const tables = db.select()
    .from(schema.tables)
    .where(and(eq(schema.tables.venueId, venueId), eq(schema.tables.active, 1)))
    .orderBy(asc(schema.tables.sort))
    .all()

  const categories = db.select()
    .from(schema.categories)
    .where(eq(schema.categories.venueId, venueId))
    .orderBy(asc(schema.categories.sort))
    .all()

  const products = db.select()
    .from(schema.products)
    .where(and(eq(schema.products.venueId, venueId), eq(schema.products.active, 1)))
    .orderBy(asc(schema.products.sort))
    .all()

  // Aromas are ordinary stock items of kind 'duhan'. They travel with the menu
  // because the shisha screen needs their names AND their grams on hand in the
  // same breath — an aroma at 0 g is offered greyed out, not hidden.
  const onHand = onHandByItem(db, venueId)
  const flavours: Flavour[] = db.select()
    .from(schema.stockItems)
    .where(and(
      eq(schema.stockItems.venueId, venueId),
      eq(schema.stockItems.kind, 'duhan'),
      eq(schema.stockItems.active, 1),
    ))
    .orderBy(asc(schema.stockItems.name))
    .all()
    .map(item => ({
      id: item.id,
      name: item.name,
      on_hand: onHand.get(item.id) ?? 0,
      base_unit: item.baseUnit,
    }))

  return {
    venue: { id: venue.id, name: venue.name, slug: venue.slug },
    users: users.map(u => ({ id: u.id, name: u.name, initials: u.initials, role: u.role })),
    tables: tables.map(t => ({
      id: t.id,
      name: t.name,
      zone: t.zone,
      col: t.col,
      row: t.row,
      grp: t.grp,
      sort: t.sort,
    })),
    categories: categories.map(c => ({ id: c.id, name: c.name, sort: c.sort })),
    products: products.map(p => ({
      id: p.id,
      category_id: p.categoryId,
      name: p.name,
      price_fen: p.priceFen,
      kind: p.kind,
      shisha_grams: p.shishaGrams,
      coal_pcs: p.coalPcs,
      is_favourite: p.isFavourite === 1,
      sort: p.sort,
    })),
    flavours,
  }
}

/** `GET /api/health` — is the process up and does the database open? */
export function getHealth(db: Queryable, venueId: string) {
  const tables = db.select({ n: sql<number>`count(*)` })
    .from(schema.tables)
    .where(eq(schema.tables.venueId, venueId))
    .get()?.n ?? 0
  const products = db.select({ n: sql<number>`count(*)` })
    .from(schema.products)
    .where(eq(schema.products.venueId, venueId))
    .get()?.n ?? 0
  return { ok: true as const, tables, products }
}
