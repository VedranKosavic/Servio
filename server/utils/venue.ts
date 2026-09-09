import { eq } from 'drizzle-orm'
import type { Db } from '../database/client'
import { schema } from '../database/client'
import { notFound } from './errors'

/**
 * Which venue is this request about?
 *
 * There is one café, so in this slice the answer is "the only row in `venues`".
 * Every table still carries `venue_id` and every service still takes a venueId
 * argument, so a second café is an INSERT rather than a rewrite. When auth
 * lands (PLAN.md §5), this is replaced by `server/middleware/tenant.ts` reading
 * the venue from the session and putting it on `event.context`.
 */
export function currentVenueId(db: Db): string {
  const venue = db.select({ id: schema.venues.id }).from(schema.venues).limit(1).get()
  if (!venue) throw notFound('NO_VENUE', 'no venue in the database — run `npm run db:seed`')
  return venue.id
}

export function currentVenue(db: Db) {
  const venue = db.select().from(schema.venues).limit(1).get()
  if (!venue) throw notFound('NO_VENUE', 'no venue in the database — run `npm run db:seed`')
  return venue
}

export function venueExists(db: Db, id: string): boolean {
  return db.select({ id: schema.venues.id }).from(schema.venues).where(eq(schema.venues.id, id)).get() !== undefined
}
