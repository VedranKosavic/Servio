/**
 * `npm run db:dev-pins` — bring an existing dev database onto the three
 * accounts and the three PINs, **in place**, without deleting or reseeding it.
 *
 * It used to do the opposite. Until the PIN started identifying the person this
 * script read `SANK_DEV_PIN` and gave *every* active person the same number, so
 * a whole team could test with one PIN. That is now the one thing a database
 * must never contain: the pad asks only for digits, so six people on 1111 makes
 * a login that cannot say who is standing at the till — it resolves to nobody
 * and `resolvePinToUser` refuses with `PIN_AMBIGUOUS` rather than guessing.
 *
 * So the override is gone and the script is repointed. What it writes is what
 * the seed writes:
 *
 *   Haris  1111  admin  (and his `/admin/login` password)
 *   Amar   2222  radnik
 *   Emir   3333  radnik
 *
 * and it **deactivates everybody else** — Lejla, Dino, Tarik, the test rows —
 * rather than deleting them, so the rounds they served and the shifts they
 * worked stay readable while their PINs stop standing between the three above
 * and the pad. Pass `SANK_DEV_CAST=full` to give the extra names their own
 * distinct PINs (4444 / 5555 / 6666) and leave them active instead, which is
 * what a database driving the Playwright suite wants.
 *
 * Safe to run while the dev server is up: SQLite in WAL mode lets two processes
 * write. Runs with `.env` loaded (`node --env-file`) so the hash uses the same
 * `PIN_PEPPER` as the server — a different pepper makes every PIN fail. Never
 * run it against a real café's database.
 */
import { isAbsolute, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDatabase } from './client'
import * as schema from './schema'
import { hashSecret, verifySecret } from '../utils/password'
import { DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD, DEV_PINS } from './seed'

const full = process.env.SANK_DEV_CAST === 'full'
/** The three real accounts, plus the test cast when it is asked for. */
const wanted: Record<string, string> = full
  ? DEV_PINS
  : { Haris: DEV_PINS.Haris, Amar: DEV_PINS.Amar, Emir: DEV_PINS.Emir }

const configured = process.env.DB_PATH || 'data/sank.db'
const file = isAbsolute(configured) ? configured : resolve(process.cwd(), configured)

const { db, sqlite } = openDatabase(file)
const now = new Date().toISOString()

const people = db.select().from(schema.users).all()
const set: string[] = []
const off: string[] = []

for (const person of people) {
  const pin = wanted[person.name]

  if (!pin) {
    // Deactivated, never deleted: `active = 0` takes the row off the lock
    // screen and out of the pad's candidate list, and leaves every order,
    // settlement and shift membership pointing at a person who still exists.
    if (person.active === 1) off.push(person.name)
    db.update(schema.users).set({ active: 0 }).where(eq(schema.users.id, person.id)).run()
    continue
  }

  const isAdmin = person.role === 'admin'
  db.update(schema.users).set({
    pinHash: hashSecret(pin, person.id),
    pinLen: pin.length === 6 ? 6 : 4,
    pinSetAt: now,
    pinPepperV: 1,
    active: 1,
    ...(isAdmin
      ? { email: DEV_ADMIN_EMAIL, passwordHash: hashSecret(DEV_ADMIN_PASSWORD, person.id) }
      : {}),
  }).where(eq(schema.users.id, person.id)).run()
  set.push(`${person.name} ${pin}`)
}

// The invariant the login rests on, checked rather than assumed. A salted hash
// cannot be compared to another hash, so this is the same brute-force the pad
// itself does — and the same reason the app enforces uniqueness with a check
// inside the transaction and not with a unique index.
const active = db.select().from(schema.users).all().filter(u => u.active === 1 && u.pinHash)
for (const [name, pin] of Object.entries(wanted)) {
  const matches = active.filter(u => verifySecret(pin, u.id, u.pinHash!)).map(u => u.name)
  if (matches.length !== 1 || matches[0] !== name) {
    console.error(`[sank] PIN ${pin} resolves to ${matches.join(', ') || 'nobody'}, not ${name}`)
    sqlite.close()
    process.exit(1)
  }
}

console.info(`[sank] ${file}: ${set.join(', ')}; admin password ${DEV_ADMIN_PASSWORD}.`)
if (off.length) console.info(`[sank] deactivated (history kept): ${off.join(', ')}.`)
sqlite.close()
