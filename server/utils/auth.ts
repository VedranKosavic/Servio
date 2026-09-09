/**
 * Cookies and the caller's address — the only file in the app that touches
 * either (`docs/BACKEND.md` §5.4).
 *
 * Two cookies, both `httpOnly` so no script on the page can read them:
 *
 * - **`sank_d`** — the device. Minted once at enrolment, good for a year, and it
 *   is what makes "this is the bar tablet" a fact rather than a claim. Logging
 *   out does not clear it: the tablet stays enrolled, only the person changes.
 * - **`sank_s`** — the session. 30 days for an admin's laptop, 14 hours for a
 *   staff PIN, 2 hours when somebody borrowed a colleague's phone.
 *
 * What is stored in the database is the sha256 of each token, never the token
 * itself, so a copy of the database file is not a set of keys.
 */
import { deleteCookie, getCookie, setCookie, type H3Event } from 'h3'
import { DEVICE_COOKIE, DEVICE_COOKIE_S, SESSION_COOKIE } from '#shared/constants'
import type { Actor } from '#shared/types'
import type { schema } from '../database/client'

export { DEVICE_COOKIE, SESSION_COOKIE }

/**
 * What `server/middleware/tenant.ts` puts on the request, and every handler
 * reads instead of trusting a body. Declared here so that `event.context.actor`
 * is typed in all of them and `event.context.venueId` cannot silently be
 * `undefined` on a route somebody forgot to declare in `ROUTE_ROLES`.
 */
declare module 'h3' {
  interface H3EventContext {
    venueId: string
    actor: Actor
    /** The `sank_d` device, on the two `public` routes that need one. */
    device?: typeof schema.devices.$inferSelect
  }
}

/**
 * `secure` **defaults to true** and is turned off only by an explicit
 * `COOKIE_SECURE=0` in the dev `.env`.
 *
 * The previous design keyed this on `NODE_ENV === 'production'`, which the
 * systemd unit on the VPS does not set — so the one environment that needed
 * secure cookies was the one that would have shipped without them. Defaulting
 * the safe way round means a misconfigured production is merely inconvenient in
 * dev, instead of silently insecure in production.
 */
export function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE !== '0'
}

/**
 * Who is knocking.
 *
 * Forwarded headers are read **only** when `TRUST_PROXY=1`, because a header is
 * whatever the client wrote in it: without that gate, every rate-limit bucket
 * and every lockout subject is chosen by the attacker with one line of curl.
 * `deploy/nginx.conf` sets `X-Forwarded-For $remote_addr` (overwrite, not
 * append) and `X-Real-IP $remote_addr`, so on the VPS the header is the truth
 * and here it is not.
 *
 * The **last** element of `x-forwarded-for` is the hop nginx itself added — the
 * first elements are whatever the client prepended.
 */
export function clientIp(event: H3Event): string {
  if (process.env.TRUST_PROXY === '1') {
    const real = header(event, 'x-real-ip')
    if (real) return real

    const forwarded = header(event, 'x-forwarded-for')
    if (forwarded) {
      const hops = forwarded.split(',').map(h => h.trim()).filter(Boolean)
      const last = hops[hops.length - 1]
      if (last) return last
    }
  }
  return event.node?.req?.socket?.remoteAddress ?? '0.0.0.0'
}

function header(event: H3Event, name: string): string | undefined {
  const raw = event.node?.req?.headers?.[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return value?.trim() || undefined
}

/** Both cookies as `authorizeRequest` wants them. */
export function readAuthCookies(event: H3Event): { s?: string, d?: string } {
  return {
    s: getCookie(event, SESSION_COOKIE),
    d: getCookie(event, DEVICE_COOKIE),
  }
}

function base(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: cookieSecure(),
    maxAge,
  }
}

export function setSessionCookie(event: H3Event, token: string, maxAgeS: number): void {
  setCookie(event, SESSION_COOKIE, token, base(maxAgeS))
}

export function setDeviceCookie(event: H3Event, token: string): void {
  setCookie(event, DEVICE_COOKIE, token, base(DEVICE_COOKIE_S))
}

/** Logout clears this one and only this one — the device stays enrolled. */
export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE, { path: '/', secure: cookieSecure(), sameSite: 'lax' })
}

export function clearDeviceCookie(event: H3Event): void {
  deleteCookie(event, DEVICE_COOKIE, { path: '/', secure: cookieSecure(), sameSite: 'lax' })
}
