/**
 * The lock screen: the wordmark, the copy, and the one landing rule.
 *
 * What is proved here:
 *
 *   1. The screen carries the wordmark from `shared/brand.ts` and asks
 *      *Prijava · Odaberi svoj profil* — never *Ko si?*.
 *   2. **An owner who PINs in on a phone lands on `/admin`.** Until this file
 *      existed he was parked on a card saying the dashboard was not built yet;
 *      it has been built since Phase 2. The destination is the role's, through
 *      `homeFor()`, and `/admin/login` sends the same owner to the same screen.
 *   3. He can still cross over to `/konobar` from the dashboard, because the
 *      owner also serves tables — `/konobar` asks for a session, not a role.
 *   4. A waiter on the same door still lands on `/konobar`.
 *
 * **One device, enrolled once** (§5.1): `authLimiter` allows ten auth calls a
 * minute per device on a production build, so the enrolment happens in
 * `beforeAll` and each test opens a page on the same context.
 *
 * Run it against a production build on a port that is not 3002:
 *
 *   rm -f data/verify.db*
 *   DB_PATH=data/verify.db PIN_PEPPER=dev npm run db:seed
 *   npm run build
 *   DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
 *     PORT=3112 node .output/server/index.mjs
 *   npx playwright test tests/e2e/prijava.spec.ts
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { APP_NAME } from '../../shared/brand'
import { ackRules, resetLimits } from './helpers'

const HARIS_PIN = '123456'
const LEJLA_PIN = '2222'

let context: BrowserContext

interface LoginUser { id: string, name: string }

/** Read once: `GET /api/auth/users` is an auth door like the PIN itself. */
let loginUsers: LoginUser[] | null = null

async function knownUsers(): Promise<LoginUser[]> {
  loginUsers ??= await (await context.request.get('/api/auth/users')).json() as LoginUser[]
  return loginUsers
}

/**
 * Open the list of people, whatever state the device was left in.
 *
 * The whole screen is inside `<ClientOnly>`, so nothing exists until the page
 * has hydrated and `/api/me` has answered — and when somebody is still signed
 * in on this device it offers *Nastavi kao …* rather than the list. Waiting for
 * one of the shapes it can take is what makes the branch below meaningful.
 */
async function openPeopleList(page: Page) {
  await page.goto('/')

  const rest = page.getByRole('button', { name: /Ostali profili/ })
  const relock = page.getByRole('button', { name: /Promijeni korisnika/ })
  const anyFace = page.getByRole('heading', { name: 'Prijava' })

  await expect(relock.or(rest).or(anyFace).first()).toBeVisible()
  if (await relock.count() > 0) {
    await relock.click()
    await expect(anyFace).toBeVisible()
  }
}

/**
 * Sign in **through the screen**, which is the whole point of this file: the
 * API door would land nobody anywhere, and the redirect is what is on trial.
 */
async function pinInOnScreen(page: Page, who: string, pin: string) {
  await openPeopleList(page)

  // The screen offers three faces — the last three to sign in on this device —
  // and everybody else behind *Ostali profili*. Which three they are depends on
  // what the rest of the suite did to this database first, so open the list
  // when the name is not already on the front.
  const face = page.getByRole('button', { name: new RegExp(who) }).first()
  if (await face.count() === 0) {
    await page.getByRole('button', { name: /Ostali profili/ }).click()
  }

  await face.click()
  for (const digit of pin) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
}

test.describe('Prijava — the lock screen', () => {
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext()
    await resetLimits(context.request)
    // `SANK_DEV_ENROL=1` turns this browser into an enrolled device with no
    // six-character code. It is the only call here limited by IP rather than by
    // the device cookie, so it happens once.
    expect((await context.request.post('/api/dev/enrol', { data: {} })).ok()).toBe(true)
    const users = await knownUsers()

    // The *Pravila* gate (S12) stands in front of every `/konobar` screen from
    // the moment `phase4-pravila` publishes a version — which it does before
    // this file, because Playwright runs the directory alphabetically. The ack
    // is per person and outlives the session, so acknowledging once here for
    // each of the two people this file signs in keeps the landing assertions
    // about the landing rule rather than about the gate.
    for (const [who, pin] of [['Haris', HARIS_PIN], ['Lejla', LEJLA_PIN]] as const) {
      const person = users.find(u => u.name === who)!
      expect((await context.request.post('/api/auth/pin', {
        data: { user_id: person.id, pin },
      })).ok()).toBe(true)
      await ackRules(context.request)
    }
  })

  // Eight auth calls across this file, against a leash of ten a minute per
  // device. The dev door forgets the window between tests so the file never
  // races its own budget; on a server without that door it 404s and this is a
  // no-op (see `resetLimits`).
  test.beforeEach(async () => {
    await resetLimits(context.request)
  })

  test.afterAll(async () => {
    await context.close()
  })

  test('the wordmark and the copy', async () => {
    const page = await context.newPage()
    await openPeopleList(page)

    await expect(page.getByRole('heading', { level: 1, name: APP_NAME })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Prijava' })).toBeVisible()
    await expect(page.getByText('Odaberi svoj profil')).toBeVisible()

    // The old question, and the placeholder the owner used to land on.
    await expect(page.getByText('Ko si?')).toHaveCount(0)
    await expect(page.getByText('još nije spremna')).toHaveCount(0)
    await page.close()
  })

  test('an owner lands on the dashboard, and can cross to the tables', async () => {
    const page = await context.newPage()
    await pinInOnScreen(page, 'Haris', HARIS_PIN)

    // The fix: the role decides, and the admin's role says `/admin`.
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: 'Puls' })).toBeVisible()

    // The dashboard is responsive; on a 390 px phone the nav is the bottom tabs
    // and the cross-link lives on *Više*.
    await page.getByRole('link', { name: 'Više' }).click()
    await page.getByRole('link', { name: /Konobarski ekran/ }).click()
    await expect(page).toHaveURL(/\/konobar$/)

    await page.close()
  })

  test('a waiter lands on the tables', async () => {
    const page = await context.newPage()
    await pinInOnScreen(page, 'Lejla', LEJLA_PIN)

    await expect(page).toHaveURL(/\/konobar$/)

    await page.close()
  })
})
