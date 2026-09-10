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
 * S12 stands in front of every `/k` screen the moment a version is published,
 * and that is the product behaviour `phase4-pravila` asserts. But Playwright
 * runs files alphabetically, so `phase4-pravila` publishes v1 before every
 * other `/k` spec in the directory — and any file that navigates to `/k/...`
 * afterwards lands on the acknowledgement screen instead of the page it means
 * to test. Acknowledging in the login helper makes each file independent of
 * where it happens to sit in the alphabet.
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
