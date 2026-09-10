/**
 * Hashing PINs, passwords and tokens. `node:crypto` only — no dependency.
 *
 * Three ideas a junior must not lose, because each one closes a different hole:
 *
 * **Hash, not store.** A PIN is never written to the database. What is written
 * is `scrypt(pin)` — a one-way function that takes deliberate work to compute,
 * so an attacker who can try a million guesses a second against a plain SHA
 * gets a few thousand a second against this one.
 *
 * **Salt** — a random value per user, stored in plain sight inside the string.
 * Without it, two waiters with PIN 1111 have the same hash, and one precomputed
 * table ("rainbow table") of all 10 000 four-digit PINs breaks every account at
 * once. With it, the attacker has to start over for each person.
 *
 * **Pepper** — a secret that is *not* in the database. It lives only in
 * `/opt/sank/.env` as `PIN_PEPPER` and is mixed into the input before hashing.
 * Salt does not help against somebody who has the database file, because a
 * 4-digit PIN is 10 000 candidates and a laptop tries all of them per user in
 * seconds. The pepper does: without the .env, the file is useless.
 * `users.pin_pepper_v` records which pepper a stored hash was made with, so it
 * can be rotated by re-hashing at the next successful login.
 *
 * The stored string is self-describing — `scrypt$N$r$p$salt$hash` — so changing
 * the cost tomorrow does not invalidate what was hashed today.
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { ENROL_ALPHABET, ENROL_CODE_LEN } from '#shared/constants'

/**
 * scrypt's work factor. 2^14 is the sane production default (~50 ms).
 * `vitest.config.ts` sets `SANK_SCRYPT_LOG2N=10` so a 200-test suite does not
 * spend a minute in a deliberately slow function; `N` is part of the stored
 * string, so verification needs no flag to know which was used.
 */
function cost(): { N: number, r: number, p: number } {
  return { N: 2 ** Number(process.env.SANK_SCRYPT_LOG2N ?? 14), r: 8, p: 1 }
}

const KEY_LEN = 32

/**
 * The peppered input. `userId` is in it as well, so the same PIN belonging to
 * two people cannot produce the same hash even if their salts ever collided.
 *
 * **A missing pepper is an error, not an empty string.** It used to be
 * `?? ''`, which is not "no pepper" — it is a *different* pepper, and nothing
 * said so: `npm run db:seed` with the variable forgotten wrote hashes that no
 * server with `PIN_PEPPER=dev` can verify, so every PIN in the new database was
 * silently wrong and the only symptom was a login screen refusing everybody.
 * CLAUDE.md calls this the one variable the app cannot run without; this is
 * where that claim is enforced. Under vitest the fixture pepper comes from
 * `vitest.config.ts`, and the guard is skipped so a stray `env: {}` in a future
 * config fails as a test rather than as a crash inside scrypt.
 */
function peppered(plain: string, userId: string): string {
  const pepper = process.env.PIN_PEPPER
  if (!pepper && !process.env.VITEST) {
    throw new Error(
      'PIN_PEPPER is not set — every PIN hashed now would fail to verify later. '
      + 'Copy .env.example to .env, or pass PIN_PEPPER= on the command line.',
    )
  }
  return createHmac('sha256', pepper ?? '').update(`${userId}:${plain}`).digest('hex')
}

/** `scrypt$16384$8$1$<salt hex>$<hash hex>` */
export function hashSecret(plain: string, userId: string): string {
  const { N, r, p } = cost()
  const salt = randomBytes(16)
  const hash = scryptSync(peppered(plain, userId), salt, KEY_LEN, { N, r, p, maxmem: 256 * 1024 * 1024 })
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`
}

/**
 * Constant-time comparison: `timingSafeEqual` always looks at every byte, so an
 * attacker cannot learn how much of a guess was right from how fast it failed.
 * Returns false rather than throwing on a malformed stored string — a corrupt
 * row must not become a crash on the login screen.
 */
export function verifySecret(plain: string, userId: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  const salt = Buffer.from(parts[4]!, 'hex')
  const expected = Buffer.from(parts[5]!, 'hex')
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || expected.length === 0) {
    return false
  }

  // Outside the `try`, deliberately: the catch below is there so a corrupt
  // stored string is a refused login rather than a crash, and a missing pepper
  // is neither corrupt nor a refusal — it is a server that cannot verify
  // anybody. Swallowed here it would read as "wrong PIN" on every screen.
  const input = peppered(plain, userId)

  try {
    const actual = scryptSync(input, salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/**
 * A device or session token. The raw value goes into a cookie and nowhere else;
 * only this digest is stored, so the database file is not a set of keys.
 * A 32-byte random token needs no scrypt — there is nothing to guess.
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function newToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Six characters from a 32-letter alphabet with no I, O, 0 or 1 in it, because
 * somebody has to read this out loud across a bar. 32^6 is a billion
 * candidates — plenty, but only while `uses_left` and the enrol limiter are
 * counting the guesses.
 */
export function newEnrolCode(): string {
  const bytes = randomBytes(ENROL_CODE_LEN)
  let out = ''
  for (let i = 0; i < ENROL_CODE_LEN; i++) {
    out += ENROL_ALPHABET[bytes[i]! % ENROL_ALPHABET.length]
  }
  return out
}
