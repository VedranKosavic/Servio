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
 * Nothing is waiting to be deleted any more.
 *
 * `POST /api/tabs/:id/pay` was the only entry, and WP3 has now deleted it
 * together with `payTabBody` — the body had no `client_id`, so there was nothing
 * to replay a retried payment against, and the whole idempotency of a payment
 * rests on `payments_client_uq` (§5.7). `POST /api/payments` replaced it.
 *
 * The set stays because the mechanism is worth keeping: a route on its way out
 * belongs here for exactly one PR, and an empty set is the honest state between
 * two of them.
 */
const PENDING_DELETION = new Set<string>()

/**
 * The routes whose files exist today: Korak 1's, plus WP1's, WP5's, WP2's,
 * WP6's and WP3's rows of the work-package table. Everything else in
 * `ROUTE_ROLES` belongs to a package that has not merged — `/api/stock/counts`
 * is WP4's, `/api/owner/live` is WP7's — which is why this is an explicit list
 * and not a prefix match.
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
  // WP6 — admin CRUD. `api/admin/users/**` is WP6's including `:id/pin`, which
  // calls WP1's `resetPin`; `api/admin/{enrol-codes,devices}` above stay WP1's
  // (§12's ownership table names both, so neither is claimed twice).
  'GET /api/admin/products', 'POST /api/admin/products',
  'PATCH /api/admin/products/:id', 'PUT /api/admin/products/:id/recipe',
  'GET /api/admin/categories', 'POST /api/admin/categories',
  'PATCH /api/admin/categories/:id',
  'GET /api/admin/tables', 'POST /api/admin/tables', 'PATCH /api/admin/tables/:id',
  'GET /api/admin/stock-items', 'POST /api/admin/stock-items',
  'PATCH /api/admin/stock-items/:id',
  'GET /api/admin/users', 'POST /api/admin/users',
  'PATCH /api/admin/users/:id', 'POST /api/admin/users/:id/pin',
  'GET /api/admin/settings', 'PATCH /api/admin/settings',
  // WP3 — the money core. `POST /api/tabs/:id/pay` is gone from disk and from
  // `ROUTE_ROLES`; every row of §7's *Orders, tabs, payments, adjustments*
  // block except the two prep reads is here.
  'GET /api/tabs/:id', 'POST /api/payments',
  'POST /api/tabs/unpaid', 'POST /api/tabs/:id/unpaid/decide',
  'POST /api/tabs/:id/move', 'POST /api/tabs/:id/assign', 'POST /api/tabs/:id/accept',
  'POST /api/adjustments', 'POST /api/adjustments/:id/decide', 'GET /api/adjustments/pending',
  'POST /api/drafts/discard',
  // WP4 — the shelf. `POST /api/stock/deliveries` is above with Korak 1's rows
  // because the key has existed since then; the file moved into a folder when
  // the GET and the reversal joined it, and the key did not change. §12 splits
  // `api/owner/**`: `stock`, `categories` and `nargila` are WP4's reports,
  // `live`, `shifts` and `shift/**` are WP7's.
  'POST /api/stock/opening', 'GET /api/stock/deliveries',
  'POST /api/stock/deliveries/:id/reverse',
  'POST /api/stock/waste', 'POST /api/stock/waste/:id/approve',
  'POST /api/stock/corrections',
  'POST /api/stock/counts', 'GET /api/stock/counts', 'GET /api/stock/counts/:id',
  'POST /api/stock/counts/:id/confirm',
  'GET /api/owner/stock', 'GET /api/owner/stock/:id/movements',
  'GET /api/owner/categories', 'GET /api/owner/nargila',
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
