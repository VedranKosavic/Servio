/**
 * `server/api/**` and `ROUTE_ROLES` are the same set — checked both ways,
 * globally.
 *
 * Deny-by-default is only as good as this test. `tenant.ts` 403s a route whose
 * key is absent, which means a route somebody forgot to declare is *dead* rather
 * than *open* — but a dead route is still a bug, and it is the kind that ships
 * because the screen that calls it has not been written yet. So one direction
 * fails when a file has no key, and the other fails when a key has no file.
 *
 * Until WP8 the second direction could only run over a hand-written list of the
 * packages that had landed: WP2–WP7 owned most of §7's rows and their files did
 * not exist yet, so a global comparison would have failed on every branch. **WP8
 * deleted that list.** Every route now exists, so a key with no file is nothing
 * but a typo and the comparison is a plain set equality in both directions —
 * which is what makes deny-by-default proven for the *whole* API rather than for
 * the part somebody remembered to enumerate.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ROUTE_ROLES } from '#shared/routeRoles'

const API_DIR = resolve(process.cwd(), 'server/api')

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
    const undeclared = files.filter(key => !(key in ROUTE_ROLES))
    expect(undeclared).toEqual([])
  })

  it('has no key without a file — an undeletable typo would 403 a live screen', () => {
    const onDisk = new Set(files)
    const orphans = Object.keys(ROUTE_ROLES).filter(key => !onDisk.has(key)).sort()
    expect(orphans).toEqual([])
  })

  /**
   * The same fact said once more, as an equality rather than two filters —
   * because this is the sentence §12 promised WP8 would be able to write, and a
   * failure here prints both sets side by side instead of one empty array.
   */
  it('is exactly the set of route files on disk, both directions at once', () => {
    expect(Object.keys(ROUTE_ROLES).sort()).toEqual(files)
    // Sixty-odd routes, so nobody can claim the two sets match because both are
    // small: the count itself is evidence the walker found the real tree.
    expect(files.length).toBeGreaterThan(60)
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
