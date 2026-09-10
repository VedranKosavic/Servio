/**
 * The two things every spec file has to do before it can drive a phone.
 *
 * Not a spec: Playwright only collects `*.spec.ts`, so this file is imported,
 * never run.
 */
import { expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test'

/**
 * Forget the auth rate-limit window.
 *
 * Nine spec files run back-to-back from one IP against one server, and each
 * file's `beforeAll` spends about five auth calls (admin login, two enrolments,
 * two PIN logins). `authLimiter` allows ten a minute and, until a device cookie
 * exists, keys on the IP — so from roughly the fourth file on every `beforeAll`
 * dies with `RATE_LIMITED` and the rest of the suite never executes.
 *
 * The leash is correct and must not be widened: it is the last line of defence
 * in front of the PIN door and it has to behave identically in CI and on the
 * VPS. What the harness gets instead is a door of its own, `POST
 * /api/dev/reset-limits`, gated on `SANK_DEV_ENROL === '1'` exactly like
 * `/api/dev/enrol` — so on the server it 404s and does not exist.
 *
 * A 404 is therefore not a failure here: it means the run is against a server
 * without the dev door, and the file will simply spend its own window.
 */
export async function resetLimits(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/dev/reset-limits')
  expect([200, 404], await res.text()).toContain(res.status())
}

/**
 * The owner's laptop entrance, and the only place a spec should learn it.
 * Mirrors `DEV_ADMIN_EMAIL` / `DEV_ADMIN_PASSWORD` in `server/database/seed.ts`.
 */
export const ADMIN_LOGIN = { email: 'haris@lounge.ba', password: '1111' } as const

/**
 * A **second, genuinely separate device** — because `POST /api/dev/enrol` is not
 * one.
 *
 * The dev door finds-or-creates the venue's single `label='dev'` row and mints a
 * fresh token on it (`server/services/devices.ts`), so every context in a run is
 * the *same* device wearing a new cookie. `browser.newContext()` gives a new
 * cookie jar and nothing else. That was a documented trade (open decision 7)
 * while the login lockout was keyed on `(device, user)` and a device was mostly
 * a cookie — but the pad names nobody, so the door now counts failures on
 * `(device, ip)` and the device row is the *only* key there is. Five wrong taps
 * on one context therefore lock every other context in the file, and a spec that
 * opens a fresh context expecting a fresh door gets 423 with the same locked row
 * handed straight back. (For the same reason the dev door rotates the token, a
 * second `POST /api/dev/enrol` silently revokes the first context's cookie
 * halfway through a file.)
 *
 * So a spec that needs a second device mints one the way the café does: the
 * admin logs in on a laptop, reads out a six-character code, and the phone
 * spends it. Three calls, and this is them. The returned context holds its own
 * `sank_d` and no session — `pinLogin` it like any other phone.
 *
 * It costs two auth calls against `authLimiter`'s ten a minute per IP, so call
 * it from `beforeAll` beside the other enrolments and not per test.
 */
export async function enrolSecondDevice(browser: Browser, label: string): Promise<BrowserContext> {
  const laptop = await browser.newContext()
  const login = await laptop.request.post('/api/auth/admin/login', { data: ADMIN_LOGIN })
  expect(login.ok(), await login.text()).toBe(true)

  const minted = await laptop.request.post('/api/admin/enrol-codes', {
    data: { mode: 'shared', label },
  })
  expect(minted.ok(), await minted.text()).toBe(true)
  const { code } = await minted.json() as { code: string }
  await laptop.close()

  const phone = await browser.newContext()
  const joined = await phone.request.post('/api/devices/enrol', { data: { code, label } })
  expect(joined.ok(), await joined.text()).toBe(true)
  return phone
}

/**
 * Clear the *Pravila* gate for whoever just PIN-logged in on this context.
 *
 * S12 stands in front of every `/konobar` screen the moment a version is
 * published, and that is the product behaviour `phase4-pravila` asserts. But
 * Playwright runs files alphabetically, so `phase4-pravila` publishes v1 before
 * every other `/konobar` spec in the directory — and any file that navigates to
 * `/konobar/...` afterwards lands on the acknowledgement screen instead of the
 * page it means to test. Acknowledging in the login helper makes each file
 * independent of where it happens to sit in the alphabet.
 *
 * Call it **after** the PIN login: `must_ack` is answered for the session's
 * actor, and there is no actor before the login.
 */
export async function ackRules(request: APIRequestContext): Promise<void> {
  const res = await request.get('/api/rules')
  expect(res.ok(), await res.text()).toBe(true)
  const rules = await res.json() as { version: number, must_ack: boolean }
  if (!rules.must_ack) return

  const ack = await request.post('/api/me/rules/ack', { data: { version: rules.version } })
  expect(ack.ok(), await ack.text()).toBe(true)
}

/**
 * The seeded PINs, and the only place a spec should learn them.
 *
 * **The PIN identifies the person.** There is no `user_id` in the body of
 * `POST /api/auth/pin` any more and no list of names in front of the pad: the
 * digits are the whole login, so they have to be unique inside the venue and
 * a spec that hard-codes `'1111'` for whoever it happens to need breaks the day
 * the cast changes. These mirror `DEV_PINS` in `server/database/seed.ts`; the
 * three below Emir exist only under `SANK_SEED_CAST=full`, which is what the
 * harness seeds `data/verify.db` with.
 */
export const PINS = {
  Haris: '1111',
  Amar: '2222',
  Emir: '3333',
  Lejla: '4444',
  Dino: '5555',
  Tarik: '6666',
} as const

export type Person = keyof typeof PINS

/**
 * PIN in on an already-enrolled context, and assert it worked.
 *
 * Returns the `MeContext` the pad answers with — `session.mode` on it is what
 * decides whether the client shows *Na čemu si večeras?* or goes straight to a
 * screen. Pass `mode` to fold that choice into the login the way a worker who
 * already knows where he is tonight does.
 */
export async function pinLogin(
  request: APIRequestContext, who: Person, mode?: 'konobar' | 'sanker',
): Promise<{ user: { id: string, name: string, role: string }, session: { mode: string | null } }> {
  // A spec that goes on to drive a screen passes its `mode`, exactly as a
  // worker who already knows he is on the šank tonight folds the choice into
  // the pad rather than answering the chooser a moment later. Without one the
  // session lands on *Na čemu si večeras?*, which is right for a person and
  // wrong for a spec that meant to open the floor plan.
  const res = await request.post('/api/auth/pin', {
    data: { pin: PINS[who], ...(mode ? { mode } : {}) },
  })
  expect(res.ok(), await res.text()).toBe(true)
  const body = await res.json() as {
    user: { id: string, name: string, role: string }, session: { mode: string | null }
  }
  expect(body.user.name).toBe(who)
  return body
}
