/**
 * The gate in front of every `/api/` request.
 *
 * A Nitro *middleware* runs before the route handler on every request, so this
 * is the one place that has to be right: it resolves the cookies into an
 * `Actor`, refuses what `ROUTE_ROLES` does not allow, and puts the venue on
 * `event.context` so that no handler anywhere reads a venue id from a body.
 *
 * All the thinking lives in `authorizeRequest()` in `services/auth.ts`, which is
 * a pure function of the database and four strings — that is what lets
 * `tests/unit/tenant.test.ts` walk every branch without starting a server. What
 * is left here is the glue: h3 in, h3 out.
 */
import { getCookie, getRequestURL, setCookie, setResponseHeader } from 'h3'
import { useDb } from '../utils/db'
import { apiError } from '../utils/http'
import { clearDeviceCookie, clearSessionCookie, clientIp, cookieSecure, readAuthCookies } from '../utils/auth'
import { authorizeRequest, slideSession } from '../services/auth'
import { authLimiter, ordersLimiter } from '../utils/rate-limit'
import { nowIso } from '../utils/ids'
import { ADMIN_SESSION_S, SESSION_COOKIE } from '#shared/constants'
import { errorMessage } from '#shared/errors'
import { routeKey } from '#shared/routeRoles'

/** The doors a stranger can knock on. These get `authLimiter`. */
const AUTH_DOORS = new Set([
  'POST /api/auth/admin/login',
  'POST /api/auth/pin',
  'GET /api/auth/users',
  'POST /api/devices/enrol',
  'POST /api/dev/enrol',
])

/**
 * The Korak 1 routes, which have no session in front of them yet.
 *
 * The waiter screens under `app/pages/k/**` are **frozen** until WP9 rewires
 * them (`docs/PHASES.md` §2): they send no cookies, no PIN and a `user_id` in
 * the body. Enforcing the session on them today would leave Vedran with a dev
 * server whose every screen 401s, weeks before the screens that fix it exist.
 *
 * So there is one escape hatch and it is deliberately narrow:
 *
 * - it is **off by default**, so nothing changes on the VPS;
 * - it only ever runs when `import.meta.dev` is true, so a stray environment
 *   variable in production cannot open it;
 * - it names the eight legacy routes explicitly rather than matching a prefix.
 *
 * **WP8 deletes this block** when it wires `event.context.actor` into those
 * handlers, and WP9 deletes the screens that need it. Until then a developer
 * opts in with `SANK_LEGACY_OPEN=1` in `.env`.
 */
const KORAK1_ROUTES = new Set([
  'GET /api/bootstrap',
  'GET /api/tables/state',
  'GET /api/prep',
  'GET /api/stock',
  'POST /api/orders',
  'POST /api/prep/:id/done',
  'POST /api/stock/deliveries',
  'POST /api/tabs/:id/pay',
])

function legacyOpen(): boolean {
  return import.meta.dev && process.env.SANK_LEGACY_OPEN === '1'
}

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return

  const key = routeKey(event.method, path)

  // Every `/api/` answer is private to one person and must be revalidated before
  // it is reused. `no-cache` and not `no-store`: `no-store` would forbid the
  // browser from keeping the response at all, which leaves it with no validator
  // to put in `If-None-Match` — and the whole ETag design in §4.2 dead code.
  // `Vary: Cookie` is what keeps a shared bar tablet from showing Emir's numbers
  // to Haris after a *Promijeni korisnika*.
  setResponseHeader(event, 'Cache-Control', 'private, no-cache')
  setResponseHeader(event, 'Vary', 'Cookie')

  const db = useDb()
  const now = nowIso()
  const ip = clientIp(event)
  const cookies = readAuthCookies(event)

  // The auth doors are leashed before anything is looked up: the point of a
  // limiter on a login route is that it costs nothing to refuse.
  if (AUTH_DOORS.has(key)) {
    const bucket = cookies.d ? `d:${cookies.d}` : `ip:${ip}`
    if (authLimiter.take(bucket, 1) === 0) {
      setResponseHeader(event, 'Retry-After', 60)
      throw apiError(429, 'RATE_LIMITED', errorMessage('RATE_LIMITED'))
    }
  }

  if (legacyOpen() && KORAK1_ROUTES.has(key)) return

  const verdict = authorizeRequest(db, { path, method: event.method, cookies, ip, now })

  if (!verdict.ok) {
    if (verdict.clearCookies) {
      clearSessionCookie(event)
      if (verdict.code === 'DEVICE_REVOKED') clearDeviceCookie(event)
    }
    throw apiError(verdict.status, verdict.code, errorMessage(verdict.code))
  }

  if (verdict.device) event.context.device = verdict.device

  if (verdict.actor) {
    event.context.actor = verdict.actor
    event.context.venueId = verdict.actor.venueId

    // Locking rounds is the one hot path a runaway phone can hammer, and a
    // retry loop in an offline outbox is exactly the shape that does it.
    if (key === 'POST /api/orders') {
      const bucket = verdict.actor.deviceId ?? verdict.actor.sessionId
      if (ordersLimiter.take(bucket, 1) === 0) {
        setResponseHeader(event, 'Retry-After', 60)
        throw apiError(429, 'RATE_LIMITED', errorMessage('RATE_LIMITED'))
      }
    }

    // An admin's thirty days slide forward, at most once a day.
    if (verdict.slideTo) {
      slideSession(db, verdict.actor.sessionId, verdict.slideTo, now)
      const token = getCookie(event, SESSION_COOKIE)
      if (token) {
        setCookie(event, SESSION_COOKIE, token, {
          httpOnly: true, sameSite: 'lax', path: '/', secure: cookieSecure(), maxAge: ADMIN_SESSION_S,
        })
      }
    }
  }
})
