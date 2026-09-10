/**
 * The two things every spec file has to do before it can drive a phone.
 *
 * Not a spec: Playwright only collects `*.spec.ts`, so this file is imported,
 * never run.
 */
import { expect, type APIRequestContext } from '@playwright/test'

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
