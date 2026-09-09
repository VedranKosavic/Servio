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
import type { Actor, Queryable } from './types'
import { onHandByItem } from './stock'
import { getMe } from './auth'
import { shiftBrief } from './shifts'
import { menuVersion } from './changes'

/**
 * `actor` is required and comes from the session — `ROUTE_ROLES` gives this
 * route `'any'`, so by the time the handler runs there is one. It is what turns
 * a catalogue into a boot: `me`, `device` and `shift` are all per person, and
 * `shift.my_open_tabs` is a different number for Amar than for Lejla.
 */
export function getBootstrap(db: Queryable, venueId: string, actor: Actor): Bootstrap {
  const venue = db.select().from(schema.venues).where(eq(schema.venues.id, venueId)).get()!
  const me = getMe(db, venueId, actor)

  // Column by column, never `select()` (§5.7). This table carries `pin_hash`,
  // `password_hash`, `email` and `telegram_chat_id` since Korak 2; a `SELECT *`
  // that someone later forgets to map is every phone in the café holding the
  // owner's password hash. `api-shapes.test.ts` sweeps every response for the
  // shape of those keys, and this is the query that must not produce them.
  const users = db.select({
    id: schema.users.id,
    name: schema.users.name,
    initials: schema.users.initials,
    role: schema.users.role,
  })
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
    seq: me.seq,
    menu_version: menuVersion(db, venueId),
    me: me.user,
    device: me.device,
    shift: shiftBrief(db, venueId, actor),
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

/**
 * `GET /api/health` — is the process up and does the database open?
 *
 * The one route in the app with **no venue**. It is `'public'` in `ROUTE_ROLES`
 * because `deploy/deploy.sh` curls it from the server itself after every
 * restart, before any cookie exists, and rolls the release back when it does not
 * answer — so it must not need a session, and it must not need the database to
 * be seeded either. `venueId` is therefore optional: with one it counts that
 * café's rows (which is what the tests assert), without one it counts the whole
 * file. Either way the counts come from real queries, because a process that is
 * up but cannot read SQLite is exactly the failure this route exists to catch
 * and an `{ ok: true }` that asks nothing would sail past it.
 */
export function getHealth(db: Queryable, venueId?: string) {
  const tables = db.select({ n: sql<number>`count(*)` })
    .from(schema.tables)
    .where(venueId ? eq(schema.tables.venueId, venueId) : undefined)
    .get()?.n ?? 0
  const products = db.select({ n: sql<number>`count(*)` })
    .from(schema.products)
    .where(venueId ? eq(schema.products.venueId, venueId) : undefined)
    .get()?.n ?? 0
  return { ok: true as const, tables, products }
}
