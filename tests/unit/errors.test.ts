/**
 * Every error code has a Bosnian sentence, and every sentence has a code.
 *
 * Without this test a code reaches the phone as raw `TAB_TABLE_MISMATCH`, which
 * is what a waiter sees at 23:40 on a Saturday. It greps `server/**` for every
 * literal thrown through the error helpers and checks both directions: no code
 * without a message, and no message nobody throws (`docs/BACKEND.md` §2).
 *
 * The one-way version of this test would let `ERROR_MESSAGES` fill up with
 * sentences for codes that were renamed years ago; the other way round is worse,
 * so both run.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  ADMIN_ERRORS, AUTH_ERRORS, CHAT_ERRORS, ERROR_MESSAGES, MONEY_ERRORS,
  ROSTER_ERRORS, RULES_ERRORS, SCAN_ERRORS, SHIFT_ERRORS,
  STOCK_ERRORS, SYNC_ERRORS, errorMessage,
} from '#shared/errors'
import { COMMON_ERRORS } from '#shared/errors/common'

const ROOTS = ['server/services', 'server/api', 'server/middleware', 'server/utils']

/**
 * Every `SankError(status, 'CODE'`, `conflict('CODE'`, … literal under `server/**`.
 *
 * A code built at runtime (`\`TAB_${x}\``) is invisible to a grep, which is why
 * the helpers all take a literal and why nothing in this codebase composes one.
 */
const THROWS = [
  /\bnew SankError\(\s*\d+\s*,\s*'([A-Z0-9_]+)'/g,
  /\b(?:conflict|forbidden|unauthorized|unprocessable|locked|notFound|badRequest|tooMany)\(\s*'([A-Z0-9_]+)'/g,
  /\bapiError\(\s*\d+\s*,\s*'([A-Z0-9_]+)'/g,
  // `authorizeRequest` does not throw — it *returns* `{ ok: false, status, code }`
  // and the middleware turns that into the response. A grep that only looked for
  // throws would miss `NO_SESSION`, `DEVICE_MISMATCH` and `FORBIDDEN`, which are
  // four of the five errors a waiter is most likely to see.
  /\bcode:\s*'([A-Z0-9_]+)'/g,
]

/**
 * The two codes nothing throws.
 *
 * `SERVER_ERROR` is `errorMessage()`'s own fallback. `NOT_IMPLEMENTED` is the
 * shared sentence for a `contracts.ts` stub whose work package has not landed —
 * WP3 was the last package to replace one, so today there is no thrower and the
 * sentence stays for the next branch that needs it (§12).
 */
const IMPLICIT = ['SERVER_ERROR', 'NOT_IMPLEMENTED']

function sources(): { path: string, text: string }[] {
  const out: { path: string, text: string }[] = []
  for (const root of ROOTS) {
    const dir = resolve(process.cwd(), root)
    walk(dir, out)
  }
  return out
}

function walk(dir: string, out: { path: string, text: string }[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, out)
      continue
    }
    if (entry.endsWith('.ts')) out.push({ path: full, text: readFileSync(full, 'utf8') })
  }
}

function thrownCodes(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const { path, text } of sources()) {
    for (const pattern of THROWS) {
      for (const match of text.matchAll(pattern)) {
        const code = match[1]!
        found.set(code, [...(found.get(code) ?? []), path])
      }
    }
  }
  return found
}

// ===========================================================================

describe('ERROR_MESSAGES', () => {
  const thrown = thrownCodes()

  it('finds codes at all — a broken grep would pass every assertion below', () => {
    expect(thrown.size).toBeGreaterThan(15)
    expect([...thrown.keys()]).toContain('INVALID_PIN')
    expect([...thrown.keys()]).toContain('DEVICE_ALREADY_REVOKED')
  })

  it('has a non-empty Bosnian sentence for every code thrown under server/**', () => {
    const missing = [...thrown.entries()]
      .filter(([code]) => !ERROR_MESSAGES[code]?.trim())
      .map(([code, where]) => `${code} (${where[0]})`)
    expect(missing).toEqual([])
  })

  it('has no orphaned sentence — every message belongs to a code somebody throws', () => {
    // WP2–WP7 have not landed, so their fragments are still empty; the check is
    // over the codes that exist today and grows on its own as they fill in.
    const orphans = Object.keys(ERROR_MESSAGES)
      .filter(code => !thrown.has(code) && !IMPLICIT.includes(code))
    expect(orphans).toEqual([])
  })

  /**
   * One code, one sentence — checked across the fragments, not just in the
   * merged object.
   *
   * `shared/errors.ts` spreads seven fragments into one `Record`, so a code
   * written in two of them does not collide, it *silently loses*: the later
   * spread wins and the earlier sentence becomes dead text that reads like it
   * ships. Two of these had already happened by WP8 — `PENDING_OUTBOX` in
   * `auth` and `shifts`, `USER_NOT_FOUND` in `auth` and `money` — and neither
   * was visible to any assertion above, because the merged object is perfectly
   * consistent either way. The only place the duplicate exists is here.
   */
  it('defines every code in exactly one fragment', () => {
    const fragments: Record<string, Record<string, string>> = {
      common: COMMON_ERRORS, auth: AUTH_ERRORS, money: MONEY_ERRORS,
      shifts: SHIFT_ERRORS, stock: STOCK_ERRORS, sync: SYNC_ERRORS,
      admin: ADMIN_ERRORS, chat: CHAT_ERRORS, roster: ROSTER_ERRORS,
      rules: RULES_ERRORS, scan: SCAN_ERRORS,
    }

    const homes = new Map<string, string[]>()
    for (const [fragment, codes] of Object.entries(fragments)) {
      for (const code of Object.keys(codes)) {
        homes.set(code, [...(homes.get(code) ?? []), fragment])
      }
    }

    const duplicated = [...homes.entries()]
      .filter(([, where]) => where.length > 1)
      .map(([code, where]) => `${code} is defined in ${where.join(' and ')}`)
      .sort()

    expect(duplicated).toEqual([])

    // …and the walker really did look at all seven fragments.
    expect(homes.size).toBe(Object.keys(ERROR_MESSAGES).length)
  })

  it('writes the sentences in Bosnian, not in English', () => {
    for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
      expect(message.length, `${code} has an empty message`).toBeGreaterThan(3)
      // The sentence is what the guest-facing screen shows; a stray English word
      // is the whole "no English on any screen" rule broken in one place.
      expect(message, `${code} looks English`).not.toMatch(
        /\b(the|and|please|error|invalid|failed|not found|try again)\b/i,
      )
    }
  })

  it('never leaks a secret through a message', () => {
    for (const message of Object.values(ERROR_MESSAGES)) {
      expect(message).not.toMatch(/hash|token|pepper|password|@/i)
    }
  })

  it('falls back rather than showing a raw code', () => {
    expect(errorMessage('SOMETHING_NOBODY_DEFINED')).toBe(COMMON_ERRORS.SERVER_ERROR)
    expect(errorMessage('INVALID_PIN')).toContain('PIN')
  })

  it('keeps the placeholders the client fills from `data`', () => {
    expect(ERROR_MESSAGES.LOCKED).toContain('{retry_after_s}')
    expect(ERROR_MESSAGES.INVALID_PIN).toContain('{fails_left}')
  })
})
