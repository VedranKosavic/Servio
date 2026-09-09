/**
 * The gate, tested as a pure function.
 *
 * `authorizeRequest` takes a database and four strings and returns a verdict —
 * no h3, no server, no HTTP — which is exactly why every branch of it can be
 * walked here in milliseconds. `server/middleware/tenant.ts` is the glue that
 * turns an `H3Event` into that argument, and the glue is fifteen lines because
 * everything worth testing lives below it.
 *
 * The assertion the whole design rests on: **a route missing from `ROUTE_ROLES`
 * is 403**. Forgetting to declare a route must fail closed
 * (`docs/BACKEND.md` §2, §5.5).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { adminLogin, authorizeRequest, loginWithPin, verifyPinMetered } from '../../server/services/auth'
import { enrolDevice, mintEnrolCode } from '../../server/services/devices'
import { clientIp, cookieSecure } from '../../server/utils/auth'
import { DEV_MULTIPLIER, pinLimiter, resetLimiters } from '../../server/utils/rate-limit'
import { ROUTE_ROLES, routeKey } from '#shared/routeRoles'
import { RATE_LIMITS } from '#shared/constants'

const IP = '10.0.0.7'

let f: Fixture
beforeEach(() => {
  resetLimiters()
  f = makeFixture()
  return () => f.close()
})

function enrolShared() {
  const code = mintEnrolCode(f.db, f.venueId, f.adminActor(), { mode: 'shared', label: 'Tablet' })
  const { result, token } = enrolDevice(f.db, { code: code.code }, { ip: IP })
  return { deviceId: result.device.id, token }
}

function pinIn(name: string, pin: string) {
  const device = enrolShared()
  const row = f.db.select().from(schema.devices).where(eq(schema.devices.id, device.deviceId)).get()!
  const { token } = loginWithPin(f.db, row, { user_id: f.userId(name), pin }, { ip: IP, now: f.clock.now() })
  return { session: token, device: device.token }
}

function ask(path: string, method: string, cookies: { s?: string, d?: string } = {}) {
  return authorizeRequest(f.db, { path, method, cookies, ip: IP, now: f.clock.now() })
}

// ===========================================================================

describe('deny by default', () => {
  it('lets a public route through with no cookies at all', () => {
    expect(ask('/api/health', 'GET').ok).toBe(true)
    expect(ask('/api/auth/admin/login', 'POST').ok).toBe(true)
    expect(ask('/api/devices/enrol', 'POST').ok).toBe(true)
  })

  it('is not ours to guard when the path is not /api/', () => {
    expect(ask('/k/sto/3', 'GET').ok).toBe(true)
    expect(ask('/', 'GET').ok).toBe(true)
  })

  it('refuses a real route with no cookies', () => {
    const verdict = ask('/api/tables/state', 'GET')
    expect(verdict).toMatchObject({ ok: false, status: 401, code: 'NO_SESSION' })
  })

  it('403s a route that is not in ROUTE_ROLES, even for an admin', () => {
    const admin = adminLogin(f.db, { email: 'haris@lounge.ba', password: 'lounge' }, { ip: IP })

    // Nothing declares this. A new route is dead until somebody declares it.
    expect(ROUTE_ROLES['POST /api/secret/backdoor']).toBeUndefined()
    expect(ask('/api/secret/backdoor', 'POST', { s: admin.token }))
      .toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' })
  })

  it('403s a waiter on an admin route and lets the admin through', () => {
    const amar = pinIn('Amar', '1111')
    expect(ask('/api/admin/devices', 'GET', { s: amar.session, d: amar.device }))
      .toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' })

    const admin = adminLogin(f.db, { email: 'haris@lounge.ba', password: 'lounge' }, { ip: IP })
    expect(ask('/api/admin/devices', 'GET', { s: admin.token }).ok).toBe(true)
  })

  it('403s a waiter on the owner dashboard reads', () => {
    const amar = pinIn('Amar', '1111')
    for (const path of ['/api/owner/live', '/api/owner/shifts', '/api/owner/log']) {
      expect(ask(path, 'GET', { s: amar.session, d: amar.device }))
        .toMatchObject({ ok: false, status: 403 })
    }
  })

  it('lets a bartender decide an adjustment and refuses a waiter', () => {
    const emir = pinIn('Emir', '123456')
    const id = '4f3c2b1a-0000-4000-8000-000000000001'
    expect(ask(`/api/adjustments/${id}/decide`, 'POST', { s: emir.session, d: emir.device }).ok).toBe(true)

    const lejla = pinIn('Lejla', '2222')
    expect(ask(`/api/adjustments/${id}/decide`, 'POST', { s: lejla.session, d: lejla.device }))
      .toMatchObject({ ok: false, status: 403 })
  })
})

// ===========================================================================

describe('the two public routes that still need a device', () => {
  it('401 NO_DEVICE without a device cookie', () => {
    expect(ask('/api/auth/pin', 'POST')).toMatchObject({ ok: false, status: 401, code: 'NO_DEVICE' })
    expect(ask('/api/auth/users', 'GET')).toMatchObject({ ok: false, status: 401, code: 'NO_DEVICE' })
  })

  it('passes with one, and hands the device to the handler', () => {
    const device = enrolShared()
    const verdict = ask('/api/auth/pin', 'POST', { d: device.token })
    expect(verdict.ok).toBe(true)
    expect(verdict.ok && verdict.device?.id).toBe(device.deviceId)
  })

  it('refuses a revoked device before any PIN is typed', () => {
    const device = enrolShared()
    f.db.update(schema.devices).set({ revokedAt: f.clock.now() })
      .where(eq(schema.devices.id, device.deviceId)).run()

    expect(ask('/api/auth/pin', 'POST', { d: device.token }))
      .toMatchObject({ ok: false, status: 401, code: 'NO_DEVICE' })
  })
})

// ===========================================================================

describe('routeKey', () => {
  it('turns uuid segments into :id and drops the query string', () => {
    expect(routeKey('post', '/api/tabs/4f3c2b1a-0000-4000-8000-000000000001/move'))
      .toBe('POST /api/tabs/:id/move')
    expect(routeKey('GET', '/api/owner/log?before=x&limit=50')).toBe('GET /api/owner/log')
    expect(routeKey('GET', '/api/me/')).toBe('GET /api/me')
  })
})

// ===========================================================================

describe('clientIp', () => {
  function fakeEvent(headers: Record<string, string>, remote = '203.0.113.9'): H3Event {
    return { node: { req: { headers, socket: { remoteAddress: remote } } } } as unknown as H3Event
  }

  it('ignores forwarded headers when TRUST_PROXY is not set', () => {
    delete process.env.TRUST_PROXY
    const event = fakeEvent({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' })
    // Otherwise every rate-limit bucket and every lockout subject is chosen by
    // the attacker with one line of curl.
    expect(clientIp(event)).toBe('203.0.113.9')
  })

  it('takes x-real-ip, then the last forwarded hop, when TRUST_PROXY=1', () => {
    process.env.TRUST_PROXY = '1'
    try {
      expect(clientIp(fakeEvent({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8')
      // The last element is the hop nginx added; everything before it is what
      // the client prepended.
      expect(clientIp(fakeEvent({ 'x-forwarded-for': '9.9.9.9, 1.2.3.4' }))).toBe('1.2.3.4')
      expect(clientIp(fakeEvent({}))).toBe('203.0.113.9')
    } finally {
      delete process.env.TRUST_PROXY
    }
  })
})

describe('cookieSecure', () => {
  it('is true with no environment at all, and off only by an explicit opt-out', () => {
    const before = process.env.COOKIE_SECURE
    delete process.env.COOKIE_SECURE
    try {
      // The VPS's systemd unit sets no NODE_ENV, so anything that defaults the
      // other way ships insecure cookies to the one place that needs them.
      expect(cookieSecure()).toBe(true)
      process.env.COOKIE_SECURE = '0'
      expect(cookieSecure()).toBe(false)
      process.env.COOKIE_SECURE = 'false'
      expect(cookieSecure()).toBe(true)
    } finally {
      if (before === undefined) delete process.env.COOKIE_SECURE
      else process.env.COOKIE_SECURE = before
    }
  })
})

// ===========================================================================

describe('the dev enrol route', () => {
  const file = resolve(process.cwd(), 'server/api/dev/enrol.post.ts')

  it('is a positive opt-in and 404s in every other environment', () => {
    const source = code(readFileSync(file, 'utf8'))

    // The guard has to be "unless it is switched on", not "unless it looks like
    // production": the systemd unit on the VPS sets no NODE_ENV, so an opt-out
    // would have handed an enrolled device cookie to the internet (§5.6).
    expect(source).toMatch(/process\.env\.SANK_DEV_ENROL !== '1'/)
    expect(source).toMatch(/apiError\(404, 'NOT_FOUND'/)
    expect(source).not.toMatch(/NODE_ENV/)
    expect(process.env.SANK_DEV_ENROL).not.toBe('1')
  })
})

/**
 * A source file with its comments removed.
 *
 * The three assertions below are about what the *code* does, and every one of
 * these files explains in a comment why it does not do the other thing — so a
 * naive grep would fail on the explanation rather than on the mistake.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// ===========================================================================

describe('the limiters', () => {
  /** What the limiter really allows here — the dev multiplier widens it (§5.4). */
  const PIN_LIMIT = RATE_LIMITS.pin.limit * DEV_MULTIPLIER

  it('a PIN-bearing route consumes pinLimiter for (deviceId, approverUserId)', () => {
    const device = enrolShared()
    const approver = f.userId('Emir')
    const bucket = `${device.deviceId}:${approver}`

    verifyPinMetered(f.db, f.venueId, approver, device.deviceId, '123456',
      { ip: IP, kind: 'approve', now: f.clock.now() })
    expect(pinLimiter.remaining(bucket)).toBe(PIN_LIMIT - 1)

    // Drain the rest of the window, then knock once more with the *correct* PIN:
    // the limiter, not the lockout, is what must refuse it.
    pinLimiter.take(bucket, PIN_LIMIT)
    expect(pinLimiter.remaining(bucket)).toBe(0)

    let refused: { status?: number, code?: string, data?: Record<string, unknown> } = {}
    try {
      verifyPinMetered(f.db, f.venueId, approver, device.deviceId, '123456',
        { ip: IP, kind: 'approve', now: f.clock.now() })
    } catch (err) {
      refused = err as typeof refused
    }
    expect(refused.status).toBe(429)
    expect(refused.code).toBe('RATE_LIMITED')
    expect(refused.data?.retry_after_s).toBe(60)
  })

  it('keys on the pair, so a second approver on the same device is unaffected', () => {
    const device = enrolShared()
    const emir = f.userId('Emir')
    pinLimiter.take(`${device.deviceId}:${emir}`, PIN_LIMIT)

    expect(pinLimiter.remaining(`${device.deviceId}:${emir}`)).toBe(0)
    expect(pinLimiter.remaining(`${device.deviceId}:${f.userId('Haris')}`)).toBe(PIN_LIMIT)

    // …and Haris can still approve on the same tablet.
    verifyPinMetered(f.db, f.venueId, f.userId('Haris'), device.deviceId, '123456',
      { ip: IP, kind: 'approve', now: f.clock.now() })
  })

  it('runs in dev and in vitest — widened, never skipped', () => {
    // The earlier design skipped the limiters when `import.meta.dev`, which made
    // the last line of defence the one thing that never ran here.
    expect(DEV_MULTIPLIER).toBeGreaterThan(1)
    expect(pinLimiter.remaining('anybody')).toBe(PIN_LIMIT)
    expect(pinLimiter.take('anybody', 1)).toBe(1)
  })
})

// ===========================================================================

describe('the middleware itself', () => {
  const file = resolve(process.cwd(), 'server/middleware/tenant.ts')

  it('sets the caching headers the ETag design needs', () => {
    const source = code(readFileSync(file, 'utf8'))
    // `no-store` would forbid the browser from keeping the response at all,
    // which leaves it with no validator for `If-None-Match` and makes every 304
    // in §4.2 dead code.
    expect(source).toMatch(/'Cache-Control', 'private, no-cache'/)
    expect(source).toMatch(/'Vary', 'Cookie'/)
    expect(source).not.toMatch(/no-store/)
  })

  it('opens the frozen Korak 1 routes only in dev and only on an explicit opt-in', () => {
    const source = code(readFileSync(file, 'utf8'))
    expect(source).toMatch(/import\.meta\.dev && process\.env\.SANK_LEGACY_OPEN === '1'/)
    expect(process.env.SANK_LEGACY_OPEN).not.toBe('1')
  })
})
