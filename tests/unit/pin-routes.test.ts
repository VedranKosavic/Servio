/**
 * No route reads a PIN without going through the metered verifier.
 *
 * This is the test that makes `PIN_BEARING_ROUTES` self-maintaining rather than
 * a comment. It walks the schema fragments looking for every body with a
 * `pin`-shaped key and insists that the route using it is on the list — because
 * a route that reads a PIN and skips `verifyPinMetered` is a route on which any
 * logged-in waiter can loop `approver_user_id = <admin>` and walk the 6-digit
 * space in minutes (`docs/BACKEND.md` §5.2).
 *
 * It walks `shared/schemas/*.ts`, the fragments — not the barrel, which has no
 * bodies of its own since §12 split it.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import * as schemas from '#shared/schemas'
import { PIN_BEARING_ROUTES } from '#shared/constants'
import { ROUTE_ROLES } from '#shared/routeRoles'

const FRAGMENTS = resolve(process.cwd(), 'shared/schemas')
const API_DIR = resolve(process.cwd(), 'server/api')

const PIN_KEY = /(^|_)pin$/

/**
 * The bodies that carry a PIN and are deliberately **not** on
 * `PIN_BEARING_ROUTES`, each with the reason.
 *
 * The list is not a loophole: every one of these still goes through the same
 * `verifyMetered` and still leaves an `auth_attempts` row. What they are not is
 * *approval* routes — the ones where a PIN authorises somebody else's money and
 * where `pinLimiter` is keyed on `(deviceId, approverUserId)`.
 */
const NOT_AN_APPROVAL: Record<string, string> = {
  // The login door itself. It is metered by `verifyMetered` and leashed by
  // `authLimiter` (keyed on the device, not on an approver), because at the
  // moment it is called there is no approver and no session to key on.
  pinLoginBody: 'POST /api/auth/pin',

  // The two admin routes that **write** a PIN rather than verify one (WP6,
  // §6.10). Nothing here is checked against a stored secret, so there is no
  // guess to meter and no `(deviceId, approverUserId)` to key `pinLimiter` on:
  // the authority is the admin's own session, which `ROUTE_ROLES` already
  // restricts to `['admin']`. Both go through the same 4-or-6-digit rule and
  // `POST /api/admin/users/:id/pin` hands straight to WP1's `resetPin`, which is
  // the one function in the app that hashes a PIN with the pepper.
  createUserBody: 'POST /api/admin/users',
  resetUserPinBody: 'POST /api/admin/users/:id/pin',
}

/** Every exported Zod object in the fragments, by export name. */
function pinBearingSchemas(): { name: string, keys: string[] }[] {
  const found: { name: string, keys: string[] }[] = []

  for (const [name, value] of Object.entries(schemas)) {
    if (!(value instanceof z.ZodObject)) continue
    const keys = Object.keys(value.shape).filter(k => PIN_KEY.test(k))
    if (keys.length) found.push({ name, keys })
  }
  return found
}

/** Which route file imports this schema, as a `ROUTE_ROLES` key. */
function routeUsing(name: string): string | null {
  for (const file of walk(API_DIR, '/api')) {
    const source = readFileSync(file.path, 'utf8')
    // A word-boundary match, so `pinLoginBody` does not match `pinLoginBodyX`.
    if (new RegExp(`\\b${name}\\b`).test(source)) return file.key
  }
  return null
}

function walk(dir: string, prefix: string): { path: string, key: string }[] {
  const out: { path: string, key: string }[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, `${prefix}/${seg(entry)}`))
      continue
    }
    const match = entry.match(/^(.+)\.(get|post|patch|put|delete)\.ts$/)
    if (!match) continue
    const [, name, method] = match
    const path = name === 'index' ? prefix : `${prefix}/${seg(name!)}`
    out.push({ path: full, key: `${method!.toUpperCase()} ${path}` })
  }
  return out
}

const seg = (name: string) => (/^\[.+\]$/.test(name) ? ':id' : name)

// ===========================================================================

describe('PIN_BEARING_ROUTES', () => {
  it('every route on the list is a declared route', () => {
    // A PIN route missing from `ROUTE_ROLES` is 403 for everybody, which looks
    // like a permissions bug and is really a typo here.
    for (const route of PIN_BEARING_ROUTES) {
      expect(ROUTE_ROLES[route], `${route} is not in ROUTE_ROLES`).toBeDefined()
    }
  })

  it('is spelled the way `routeKey` spells things', () => {
    for (const route of PIN_BEARING_ROUTES) {
      expect(route).toMatch(/^(GET|POST|PATCH|PUT|DELETE) \/api\/[a-z0-9\-/:]*$/)
    }
  })

  it('covers every schema with a pin-shaped key, or names it an exception', () => {
    const bearing = pinBearingSchemas()

    // A sanity check on the walker itself: if this ever finds nothing, the test
    // below passes vacuously and the whole file is decoration.
    expect(bearing.map(b => b.name)).toContain('pinLoginBody')

    for (const { name, keys } of bearing) {
      const route = routeUsing(name)
      if (route === null) continue // the package that uses it has not landed yet

      const exempt = NOT_AN_APPROVAL[name]
      if (exempt) {
        expect(route, `${name} is exempted for ${exempt}, but is used by ${route}`).toBe(exempt)
        continue
      }

      expect(
        (PIN_BEARING_ROUTES as readonly string[]).includes(route),
        `${route} reads ${keys.join(', ')} but is not in PIN_BEARING_ROUTES`,
      ).toBe(true)
    }
  })

  it('the common `pin` primitive is a string, not an object anybody can post', () => {
    // `shared/schemas/common.ts` exports `pin` as the 4-or-6-digit regex every
    // body reuses. It is not a body, so it must not be picked up as one.
    expect(schemas.pin instanceof z.ZodObject).toBe(false)
    expect(schemas.pin.safeParse('1111').success).toBe(true)
    expect(schemas.pin.safeParse('12345').success).toBe(false)
    expect(schemas.pin.safeParse('abcd').success).toBe(false)
  })
})

describe('the fragments', () => {
  it('are all re-exported by the barrel', () => {
    const barrel = readFileSync(resolve(process.cwd(), 'shared/schemas.ts'), 'utf8')
    for (const file of readdirSync(FRAGMENTS)) {
      const name = file.replace(/\.ts$/, '')
      expect(barrel, `shared/schemas.ts does not re-export ${file}`)
        .toMatch(new RegExp(`from '\\./schemas/${name}'`))
    }
  })
})
