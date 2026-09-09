/**
 * Who is making this request, and which venue is it about?
 *
 * In the finished app both answers come from `server/middleware/tenant.ts`
 * (WP1), which resolves the `sank_s` / `sank_d` cookies once and puts
 * `event.context.venueId` and `event.context.actor` on the request — every
 * handler then just reads them, and a route missing from `ROUTE_ROLES` is a 403
 * before it ever runs.
 *
 * That middleware has not landed. This file is the seam: it prefers the context
 * whenever it is there, so the day WP1 merges nothing below runs again and the
 * file can be deleted. Until then it falls back to the venue's first active
 * admin **and only outside production** — a fallback that hands out an admin
 * actor is exactly the kind of code that must not survive a deploy, so it
 * refuses with 401 rather than guessing when `NODE_ENV=production`.
 */
import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { eq, and, asc } from 'drizzle-orm'
import { schema } from '../database/client'
import { forbidden, unauthorized } from './errors'
import { currentVenueId } from './venue'
import { DEVICE_COOKIE } from '#shared/constants'
import type { Db } from '../services/types'
import type { Actor } from '#shared/types'

export function requestVenueId(event: H3Event, db: Db): string {
  const fromContext = event.context.venueId as string | undefined
  return fromContext ?? currentVenueId(db)
}

export function requestActor(event: H3Event, db: Db, venueId: string): Actor {
  const fromContext = event.context.actor as Actor | undefined
  if (fromContext) return fromContext

  if (process.env.NODE_ENV === 'production') {
    throw unauthorized('NO_SESSION', 'no session on this request')
  }

  const user = db.select().from(schema.users)
    .where(and(
      eq(schema.users.venueId, venueId),
      eq(schema.users.role, 'admin'),
      eq(schema.users.active, 1),
    ))
    .orderBy(asc(schema.users.name))
    .get()
  if (!user) throw unauthorized('NO_SESSION', 'no session, and no admin to stand in for one')

  return {
    venueId,
    userId: user.id,
    role: user.role,
    sessionId: 'dev',
    sessionKind: 'admin',
    deviceId: null,
    deviceBoundUserId: null,
    borrowed: false,
  }
}

/**
 * `ROUTE_ROLES` + `tenant.ts` are the real gate (deny by default). Until they
 * exist, the owner-only routes still say so themselves — belt and braces that
 * §2 asks for anyway, and the only thing standing between a waiter's phone and
 * the Dnevnik today.
 */
/**
 * Which phone is this? The heartbeat is the one route that needs it before the
 * actor does (§4.3).
 *
 * The real answer is the `sank_d` cookie: a 32-byte random token whose **sha256
 * is what the database stores**, so a stolen `devices` row cannot be turned back
 * into a working cookie. That lookup is six lines and correct today, so it is
 * here rather than waiting for WP1. The `?device=` escape hatch below it is
 * development scaffolding — it lets a curl verify the route before enrolment
 * exists — and WP1 deletes it with the rest of this file.
 */
export function requestDeviceId(event: H3Event, db: Db, venueId: string): string {
  const actor = event.context.actor as Actor | undefined
  if (actor?.deviceId) return actor.deviceId

  const token = getCookie(event, DEVICE_COOKIE)
  if (token) {
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const device = db.select({ id: schema.devices.id }).from(schema.devices)
      .where(and(eq(schema.devices.venueId, venueId), eq(schema.devices.tokenHash, tokenHash)))
      .get()
    if (device) return device.id
  }

  if (process.env.NODE_ENV !== 'production') {
    const fromQuery = getQuery(event).device
    if (typeof fromQuery === 'string' && fromQuery) return fromQuery
  }

  throw unauthorized('NO_DEVICE', 'no enrolled device on this request')
}

export function requireRole(actor: Actor, ...roles: Actor['role'][]): void {
  if (!roles.includes(actor.role)) {
    throw forbidden('FORBIDDEN', `role ${actor.role} may not do this`)
  }
}
