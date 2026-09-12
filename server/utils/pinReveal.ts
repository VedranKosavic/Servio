/**
 * A worker's PIN, kept readable so the owner can look it up.
 *
 * **This is a deliberate weakening, asked for and understood.** The app's own
 * design is that a PIN cannot be read back: `pin_hash` is scrypt over a salt
 * and a pepper, so not even the server knows what anybody typed — it can only
 * confirm a guess. That is still how signing in works and nothing here changes
 * it. What this adds is a *second*, reversible copy, for one screen.
 *
 * The owner was told what it costs and chose it: with five admins and two
 * workers in a café, being able to remind Benza of his number is worth more to
 * him than the property that a stolen database is useless. Two things narrow
 * the blast radius, and both are on purpose:
 *
 * - **Only `radnik` accounts.** An admin's PIN opens the dashboard, the cash
 *   approvals and this screen; it is never sealed, so the five admin PINs are
 *   as unrecoverable as they were yesterday. Sealing the owner's own PIN would
 *   be the version of this that actually matters if the file ever leaks.
 * - **The database file alone is not enough.** The key is derived from
 *   `PIN_PEPPER`, which lives in `/opt/sank/.env` and is in no backup of the
 *   data (`deploy/README-DEPLOY.md` — "a backup file is a key to the till" is
 *   now one clause less true, and that is the honest way to put it). An
 *   attacker needs the file *and* the server's environment.
 *
 * AES-256-GCM, so a tampered ciphertext fails to open rather than decrypting to
 * something else. The key is derived through HKDF with its own `info` string,
 * so it is not the pepper and cannot be run backwards into it — the two uses of
 * one secret stay separate.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

/** Derived once per process; `PIN_PEPPER` cannot change under a running server. */
let cachedKey: Buffer | null = null

function key(): Buffer {
  if (cachedKey) return cachedKey
  const pepper = process.env.PIN_PEPPER
  if (!pepper) {
    // The same loud failure `peppered()` makes, and for the same reason: a
    // missing pepper must never quietly become an empty one.
    throw new Error(
      'PIN_PEPPER is not set — a PIN sealed now could not be read back later. '
      + 'Copy .env.example to .env, or pass PIN_PEPPER= on the command line.',
    )
  }
  cachedKey = Buffer.from(hkdfSync('sha256', Buffer.from(pepper, 'utf8'), Buffer.alloc(0),
    Buffer.from('sank:pin-reveal:v1', 'utf8'), KEY_BYTES))
  return cachedKey
}

/** `iv.ciphertext.tag`, all base64url. `null` in, `null` out. */
export function sealPin(plain: string | null): string | null {
  if (plain === null || plain === '') return null
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, body, cipher.getAuthTag()].map(b => b.toString('base64url')).join('.')
}

/**
 * The PIN back, or `null` when there is nothing to read.
 *
 * A ciphertext that will not open is **not** an error worth throwing: the
 * commonest cause is a database sealed under a different `PIN_PEPPER` — a dev
 * copy of production, say — and the screen's honest answer there is "nothing
 * stored", not a 500 on the staff list.
 */
export function openPin(sealed: string | null): string | null {
  if (!sealed) return null
  try {
    const [iv, body, tag] = sealed.split('.')
    if (!iv || !body || !tag) return null
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}
