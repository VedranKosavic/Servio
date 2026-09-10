/**
 * The login screen: a PIN pad and nothing else, and the landing rule behind it.
 *
 * What is proved here:
 *
 *   1. The first screen carries the wordmark and a pad. It offers **no list of
 *      names and no role buttons** — the digits are the whole login, and a
 *      screen that drew the staff list would hand a stranger holding an
 *      enrolled phone the one thing the pad refuses to ask.
 *   2. **The PIN identifies the person.** The same pad, two different numbers,
 *      two different people — and nobody says who they are first.
 *   3. An owner lands on `/admin`, and can still cross to `/konobar`, because
 *      he also serves tables.
 *   4. A `radnik` gets the second step — *Na čemu si večeras?* — and lands on
 *      whichever screen he picks.
 *   5. He can switch from one to the other **without signing out**: the mode is
 *      a choice on his session, not a property of his account.
 *   6. Unknown digits are refused without naming anybody.
 *   7. **The door that closes is the phone's, not the person's.** Five wrong
 *      taps shut one device — even against a correct PIN — and leave every
 *      other device open, because the pad names nobody and the counter has no
 *      account to key on.
 *
 * **This file is the acceptance test for the new screen** (`app/pages/index.vue`
 * and the chooser). The API half of it — every assertion that goes through
 * `context.request` — passes against the server as it stands; the half that
 * drives the DOM is the contract the screen has to meet.
 *
 * **One device, enrolled once** (§5.1): `authLimiter` allows ten auth calls a
 * minute per device on a production build, so the enrolment happens in
 * `beforeAll` and each test opens a page on the same context.
 *
 * Run it against a production build on a port that is not 3002:
 *
 *   rm -f data/verify.db*
 *   DB_PATH=data/verify.db PIN_PEPPER=dev SANK_SEED_CAST=full npm run db:seed
 *   DB_PATH=data/verify.db npm run build
 *   DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
 *     PORT=3112 node .output/server/index.mjs
 *   npx playwright test tests/e2e/prijava.spec.ts
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { APP_NAME } from '../../shared/brand'
import { ackRules, enrolSecondDevice, pinLogin, resetLimits, PINS, type Person } from './helpers'

let context: BrowserContext

/**
 * Get the browser to the pad, whatever state the device was left in.
 *
 * `/` is a pad only when nobody is signed in: with a live session it forwards
 * to that session's own screen rather than asking a person who is already here
 * to prove it again, and the old *Nastavi kao …* card went with the name list.
 * So the session is ended first — every test in this file signs somebody in, and
 * they share one context.
 *
 * The screen is inside `<ClientOnly>`, so nothing exists until the page has
 * hydrated and `/api/me` has answered; waiting for the `1` key is waiting for
 * exactly that.
 */
async function openPad(page: Page) {
  expect((await page.request.post('/api/auth/logout', { data: {} })).ok()).toBe(true)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeVisible()
}

/**
 * Sign in **through the screen**, which is the whole point of this file: the API
 * door would land nobody anywhere, and the redirect is what is on trial.
 *
 * Note what is missing compared with the old version of this helper: there is
 * no face to tap first.
 */
async function padIn(page: Page, digits: string) {
  await openPad(page)
  for (const digit of digits) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
}

test.describe('Prijava — the PIN pad', () => {
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext()
    await resetLimits(context.request)
    // `SANK_DEV_ENROL=1` turns this browser into an enrolled device with no
    // six-character code. It is the only call here limited by IP rather than by
    // the device cookie, so it happens once.
    expect((await context.request.post('/api/dev/enrol', { data: {} })).ok()).toBe(true)

    // The *Pravila* gate (S12) stands in front of every `/konobar` screen from
    // the moment `phase4-pravila` publishes a version — which it does before
    // this file, because Playwright runs the directory alphabetically. The ack
    // is per person and outlives the session, so acknowledging once here for
    // each person this file signs in keeps the landing assertions about the
    // landing rule rather than about the gate.
    for (const who of ['Haris', 'Lejla', 'Amar'] as Person[]) {
      await pinLogin(context.request, who)
      await ackRules(context.request)
    }
  })

  test.beforeEach(async () => {
    await resetLimits(context.request)
  })

  test.afterAll(async () => {
    await context.close()
  })

  test('is a pad, and offers nobody', async () => {
    const page = await context.newPage()
    await openPad(page)

    await expect(page.getByRole('heading', { level: 1, name: APP_NAME })).toBeVisible()
    for (const digit of '0123456789') {
      await expect(page.getByRole('button', { name: digit, exact: true })).toBeVisible()
    }

    // The list of faces is gone, and so is the question it used to ask. This is
    // the assertion the owner's change is really about: a stranger holding this
    // phone learns no name from it.
    await expect(page.getByText('Odaberi svoj profil')).toHaveCount(0)
    await expect(page.getByText('Ostali profili')).toHaveCount(0)
    for (const name of ['Haris', 'Amar', 'Emir', 'Lejla']) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0)
    }
    // No role buttons either: `Konobar`/`Šanker` belong to the *second* step,
    // behind a PIN, and never in front of one.
    await expect(page.getByRole('button', { name: 'Konobar' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Šanker' })).toHaveCount(0)

    await page.close()
  })

  /** The API half: one door, two numbers, two people, and no name in either body. */
  test('the digits alone say who is typing', async () => {
    const amar = await pinLogin(context.request, 'Amar')
    expect(amar.user.role).toBe('radnik')
    // A fresh session has not chosen a screen: that is the chooser.
    expect(amar.session.mode).toBeNull()

    const haris = await pinLogin(context.request, 'Haris')
    expect(haris.user.role).toBe('admin')
    // An admin never has a mode — his landing is `/admin`.
    expect(haris.session.mode).toBeNull()

    // Digits that belong to nobody are refused, and the refusal names nobody.
    const nobody = await context.request.post('/api/auth/pin', { data: { pin: '9999' } })
    expect(nobody.status()).toBe(401)
    const body = await nobody.text()
    expect(body).not.toMatch(/Haris|Amar|Emir|Lejla/)
  })

  test('an owner lands on the dashboard, and can cross to the tables', async () => {
    const page = await context.newPage()
    await padIn(page, PINS.Haris)

    // No chooser for him: the owner's landing is the dashboard, full stop.
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: 'Puls' })).toBeVisible()

    // The dashboard is responsive; on a 390 px phone the nav is the bottom tabs
    // and the cross-link lives on *Više*. He also serves tables, so `/konobar`
    // stays open to him — it asks for a session, not for a mode.
    await page.getByRole('link', { name: 'Više' }).click()
    await page.getByRole('link', { name: /Konobarski ekran/ }).click()
    await expect(page).toHaveURL(/\/konobar$/)

    await page.close()
  })

  test('a radnik is asked which screen he is on tonight, and lands there', async () => {
    const page = await context.newPage()
    await padIn(page, PINS.Lejla)

    // The second step. Both choices stay open to every worker — the screen is
    // not a property of the account any more.
    await expect(page.getByText('Na čemu si večeras?')).toBeVisible()
    await page.getByRole('button', { name: 'Šanker' }).click()
    await expect(page).toHaveURL(/\/sanker$/)

    await page.close()
  })

  /**
   * The half that would be impossible if the screen were still an account
   * property: moving from the bar to the floor at midnight, without signing out
   * and without an admin touching anything.
   */
  test('and can switch to the other one without signing out', async () => {
    const page = await context.newPage()
    await padIn(page, PINS.Amar)

    await expect(page.getByText('Na čemu si večeras?')).toBeVisible()
    await page.getByRole('button', { name: 'Konobar' }).click()
    await expect(page).toHaveURL(/\/konobar$/)

    // Same session, other screen. `GET /api/me` is the proof: the mode moved and
    // the session id did not.
    const before = await (await page.request.get('/api/me')).json() as
      { session: { id: string, mode: string | null } }
    expect(before.session.mode).toBe('konobar')

    const switched = await page.request.post('/api/auth/mode', { data: { mode: 'sanker' } })
    expect(switched.ok(), await switched.text()).toBe(true)

    const after = await (await page.request.get('/api/me')).json() as
      { session: { id: string, mode: string | null } }
    expect(after.session.mode).toBe('sanker')
    expect(after.session.id).toBe(before.session.id)

    await page.close()
  })

  /**
   * The counter behind the pad, end to end.
   *
   * With no name in front of the digits there is no account to count failures
   * against, so the login door keys its lockout on `(device, ip)`. That trade
   * is worth one browser test, because it cuts both ways in a café: five wrong
   * guesses shut the phone for everybody standing at it, and they shut nothing
   * else. `enrolSecondDevice` is what makes the second half provable —
   * `browser.newContext()` alone would not, because `POST /api/dev/enrol` hands
   * back the venue's single `label='dev'` row and the lock with it.
   */
  test('the lockout is the phone\'s door, not the person\'s', async ({ browser }) => {
    const spare = await enrolSecondDevice(browser, 'Rezervni telefon')

    try {
      // Four refusals that still count down, then the fifth, which does not.
      for (let i = 1; i <= 4; i++) {
        const wrong = await spare.request.post('/api/auth/pin', { data: { pin: '9999' } })
        expect(wrong.status(), `attempt ${i}`).toBe(401)
      }
      const fifth = await spare.request.post('/api/auth/pin', { data: { pin: '9999' } })
      expect(fifth.status()).toBe(423)

      // Being right is not a way out: the lock is consulted before the compare,
      // so Emir's own PIN on this phone is refused with the same 423.
      const emir = await spare.request.post('/api/auth/pin', { data: { pin: PINS.Emir } })
      expect(emir.status()).toBe(423)

      // And the phone the rest of this file has been typing on never noticed.
      const amar = await pinLogin(context.request, 'Amar')
      expect(amar.user.name).toBe('Amar')
    } finally {
      await spare.close()
    }
  })
})
