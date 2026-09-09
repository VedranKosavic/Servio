/**
 * `server/api/**` and `ROUTE_ROLES` are the same set — checked both ways.
 *
 * Deny-by-default is only as good as this test. `tenant.ts` 403s a route whose
 * key is absent, which means a route somebody forgot to declare is *dead* rather
 * than *open* — but a dead route is still a bug, and it is the kind that ships
 * because the screen that calls it has not been written yet. So one direction
 * fails when a file has no key, and the other fails when a key has no file.
 *
 * The second direction cannot be global until every work package has landed
 * (WP2–WP7 own most of §7's rows and their files do not exist yet), so it runs
 * over the prefixes that *are* implemented. **WP8 replaces `LANDED_PREFIXES`
 * with a plain global comparison** — by then every route exists, and a key with
 * no file is nothing but a typo.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ROUTE_ROLES } from '#shared/routeRoles'

const API_DIR = resolve(process.cwd(), 'server/api')

/**
 * The Korak 1 route WP3 deletes in the PR that lands `POST /api/payments`.
 *
 * `payTabBody` has no `client_id`, so there is nothing to replay a retried
 * payment against — the whole idempotency of a payment rests on
 * `payments_client_uq` (§5.7). It is deliberately absent from `ROUTE_ROLES`,
 * which means the middleware already 403s it; the file is only still on disk
 * because deleting it is WP3's line in the work-package table, not WP1's.
 */
const PENDING_DELETION = new Set(['POST /api/tabs/:id/pay'])

/**
 * The routes whose files exist today: Korak 1's, plus WP1's, WP5's and WP2's
 * rows of the work-package table. Everything else in `ROUTE_ROLES` belongs to a
 * package that has not merged — `/api/payments` and `/api/tabs/**` are WP3's,
 * `/api/stock/counts` is WP4's — which is why this is an explicit list and not a
 * prefix match.
 *
 * **WP8 deletes it** and compares the two sets outright.
 */
const LANDED = new Set([
  // Korak 1
  'GET /api/health', 'GET /api/bootstrap', 'GET /api/tables/state', 'GET /api/prep',
  'GET /api/stock', 'POST /api/orders', 'POST /api/prep/:id/done', 'POST /api/stock/deliveries',
  // WP1
  'POST /api/auth/admin/login', 'POST /api/auth/pin', 'GET /api/auth/users',
  'POST /api/auth/logout', 'POST /api/devices/enrol', 'GET /api/me', 'POST /api/dev/enrol',
  'GET /api/admin/devices', 'PATCH /api/admin/devices/:id', 'POST /api/admin/devices/:id/revoke',
  'POST /api/admin/devices/:id/unlock', 'POST /api/admin/enrol-codes',
  // WP5 — merged into `main` before this package; §12 gives it the heartbeat
  // *route* even though the device it writes is WP1's subject.
  'GET /api/changes', 'POST /api/devices/heartbeat',
  'GET /api/owner/log', 'GET /api/owner/log/:id', 'POST /api/owner/log/seen',
  // WP2 — the shift, the drawer, the envelope. §12 splits `api/me/**`: the
  // session envelope `GET /api/me` is WP1's above, the three shift reads here.
  'POST /api/shifts/open', 'POST /api/shifts/:id/closing', 'POST /api/shifts/:id/close',
  'POST /api/shifts/:id/force-close', 'POST /api/shifts/:id/review',
  'POST /api/shifts/:id/settle', 'POST /api/shifts/:id/settlements/:id/accept',
  'POST /api/shifts/:id/leave', 'POST /api/shifts/:id/float',
  'POST /api/shifts/:id/payout', 'POST /api/shifts/:id/pickup',
  'POST /api/shifts/:id/opening-float',
  'POST /api/cash-movements/:id/decide', 'POST /api/cash-movements/:id/ack',
  'GET /api/me/shift', 'GET /api/me/shift/lines', 'GET /api/me/shifts',
])

/** Every `.get.ts` / `.post.ts` / `.patch.ts` under `server/api/**`, as a key. */
function routeFiles(dir = API_DIR, prefix = '/api'): string[] {
  const keys: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // `[id]` is a route parameter; `routeKey()` normalises a live uuid to the
      // same `:id`, so the two sides can be compared at all.
      keys.push(...routeFiles(full, `${prefix}/${segment(entry)}`))
      continue
    }
    const match = entry.match(/^(.+)\.(get|post|patch|put|delete)\.ts$/)
    if (!match) continue

    const [, name, method] = match
    const path = name === 'index' ? prefix : `${prefix}/${segment(name!)}`
    keys.push(`${method!.toUpperCase()} ${path}`)
  }
  return keys
}

function segment(name: string): string {
  return /^\[.+\]$/.test(name) ? ':id' : name
}

describe('ROUTE_ROLES', () => {
  const files = routeFiles().sort()

  it('finds the routes on disk at all (a broken walker would pass vacuously)', () => {
    expect(files.length).toBeGreaterThan(10)
    expect(files).toContain('GET /api/health')
    expect(files).toContain('POST /api/auth/pin')
    expect(files).toContain('PATCH /api/admin/devices/:id')
  })

  it('declares every route file — a route nobody declared is a route nobody guarded', () => {
    const undeclared = files.filter(key => !(key in ROUTE_ROLES) && !PENDING_DELETION.has(key))
    expect(undeclared).toEqual([])
  })

  it('has no key without a file, among the packages that have landed', () => {
    const onDisk = new Set(files)
    const orphans = [...LANDED].filter(key => !onDisk.has(key)).sort()
    expect(orphans).toEqual([])
  })

  it('declares every route that has landed', () => {
    const undeclared = [...LANDED].filter(key => !(key in ROUTE_ROLES)).sort()
    expect(undeclared).toEqual([])
  })

  it('spells every key the same way: METHOD /api/..., hyphens, no trailing slash', () => {
    for (const key of Object.keys(ROUTE_ROLES)) {
      expect(key).toMatch(/^(GET|POST|PATCH|PUT|DELETE) \/api\/[a-z0-9\-/:]*$/)
      expect(key).not.toMatch(/_/) // `force-close`, not `force_close` (§14.15)
      expect(key).not.toMatch(/\/$/)
      expect(key).not.toMatch(/\/\//)
    }
  })

  it('gives every value a real role list', () => {
    for (const [key, value] of Object.entries(ROUTE_ROLES)) {
      if (value === 'public' || value === 'any') continue
      expect(Array.isArray(value), `${key} is neither public, any, nor a role list`).toBe(true)
      expect(value.length, `${key} has an empty role list`).toBeGreaterThan(0)
      for (const role of value) expect(['admin', 'waiter', 'bartender']).toContain(role)
    }
  })

  it('keeps `public` to the doors that must answer before a session exists', () => {
    const isPublic = Object.entries(ROUTE_ROLES)
      .filter(([, v]) => v === 'public').map(([k]) => k).sort()

    expect(isPublic).toEqual([
      'GET /api/auth/users',
      'GET /api/health',
      'POST /api/auth/admin/login',
      'POST /api/auth/pin',
      'POST /api/dev/enrol',
      'POST /api/devices/enrol',
    ])
  })

  it('leaves nothing under /api/owner or /api/admin open to staff', () => {
    for (const [key, value] of Object.entries(ROUTE_ROLES)) {
      const path = key.slice(key.indexOf(' ') + 1)
      if (!path.startsWith('/api/owner') && !path.startsWith('/api/admin')) continue
      expect(value, `${key} must be admin-only`).toEqual(['admin'])
    }
  })
})
