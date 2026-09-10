/**
 * WP4's done-when, walked on a 390 px phone and a 1440 px laptop
 * (docs/PHASE4.md §3 WP4 and §5.2 check 5).
 *
 * What is proved here:
 *
 *   1. Haris writes *Pravila* on `/a/postavke/pravila`, the confirm sheet names
 *      the version, and publishing produces a version with an acknowledgement
 *      list on which nobody has confirmed anything yet.
 *   2. Amar's next login puts S12 in front of S1: every dark route lands on
 *      *Pravila*, and *Potvrđujem* is disabled until the text has been
 *      scrolled to the end. After confirming he reaches the floor plan.
 *   3. The acknowledgement shows up on `/a` with his name and the time.
 *   4. A threshold changed in *Podešavanja* changes the number inside the
 *      published text on the phone **without** a new version — the whole point
 *      of the `{{…}}` tokens.
 *   5. The honesty note about the database file is on the phone, word for word,
 *      and nothing on the screen is in English or scrolls sideways.
 *
 * **Why this file cleans up after itself.** The five spec files run in one
 * command against one database (§5.1) and this is the only one that publishes
 * rules. A published version gates *everybody's* next login, which is the
 * feature working — and would leave every later spec's waiter staring at
 * *Pravila* instead of his floor plan. So `afterAll` confirms the version for
 * the two other people those files sign in as, through the real route, exactly
 * as they would on their own phones.
 *
 * Run it against a production build on a port that is not 3002:
 *
 *   rm -f data/verify.db*
 *   DB_PATH=data/verify.db PIN_PEPPER=dev npm run db:seed
 *   npm run build
 *   DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
 *     PORT=3113 node .output/server/index.mjs
 *   SANK_E2E_URL=http://localhost:3113 npx playwright test tests/e2e/phase4-pravila.spec.ts
 */
import { expect, test, type BrowserContext } from '@playwright/test'

const AMAR_PIN = '1111'
/**
 * The other two people this database's later spec files sign in as.
 *
 * **Exactly these two, and nobody else.** A PIN login stamps `last_login_at`
 * and puts a face on the lock screen, and `wp4-moja-smjena.spec.ts` asserts
 * that Dino has never signed in on this device — so confirming the rules on his
 * behalf here would break a test about something else entirely. Amar confirms
 * through the screen, in the test below.
 */
const OTHERS: [string, string][] = [
  ['Tarik', '4444'],
  ['Emir', '123456'],
]

const DOC = [
  '# Pravila lokala',
  '',
  'Ovo su pravila po kojima radimo. Pišu ovdje zato što pravilo koje ne znaš',
  'unaprijed nije pravilo.',
  '',
  '## Pazar',
  '',
  '- Razlika do {{cash_tolerance_fen}} je u toleranciji.',
  '- Pazar se **predaje**, ne ostavlja.',
  '',
  '## Šank',
  '',
  '- Šanker sipa; konobar ne uzima flaše sa police.',
].join('\n')

let phone: BrowserContext
let laptop: BrowserContext

interface LoginUser { id: string, name: string }

let loginUsers: LoginUser[] | null = null

/** Read once: `GET /api/auth/users` is an auth door, ten a minute (§5.1). */
async function knownUsers(context: BrowserContext): Promise<LoginUser[]> {
  loginUsers ??= await (await context.request.get('/api/auth/users')).json() as LoginUser[]
  return loginUsers
}

async function loginPin(context: BrowserContext, who: string, pin: string) {
  const person = (await knownUsers(context)).find(u => u.name === who)!
  const res = await context.request.post('/api/auth/pin', { data: { user_id: person.id, pin } })
  expect(res.ok()).toBe(true)
  return person
}

test.describe.configure({ mode: 'serial' })

test.describe('Phase 4 — Pravila', () => {
  test.beforeAll(async ({ browser }) => {
    phone = await browser.newContext()
    expect((await phone.request.post('/api/dev/enrol', { data: {} })).ok()).toBe(true)
    await loginPin(phone, 'Amar', AMAR_PIN)

    laptop = await browser.newContext()
    const login = await laptop.request.post('/api/auth/admin/login', {
      data: { email: 'haris@lounge.ba', password: 'lounge' },
    })
    expect(login.ok()).toBe(true)
  })

  test.afterAll(async () => {
    // See the file header: the people who log in later confirm here, so the
    // next spec file's waiter meets his floor plan and not this file's gate.
    const version = await (await laptop.request.get('/api/rules')).json() as { version: number }
    for (const [who, pin] of OTHERS) {
      await loginPin(phone, who, pin)
      expect((await phone.request.post('/api/me/rules/ack', {
        data: { version: version.version },
      })).ok()).toBe(true)
    }
    await phone?.close()
    await laptop?.close()
  })

  test('Haris writes and publishes a version, on a laptop', async () => {
    const page = await laptop.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/a/postavke/pravila')

    await expect(page.getByRole('heading', { name: 'Pravila' })).toBeVisible()
    await expect(page.getByText('Nije objavljeno')).toBeVisible()

    await page.getByLabel('Tekst Pravila').fill(DOC)

    // The preview fills the threshold token from the venue's live settings.
    await page.getByRole('button', { name: 'Pregled' }).click()
    await expect(page.getByText(/Razlika do 5,00.KM je u toleranciji/)).toBeVisible()

    await page.getByRole('button', { name: 'Objavi novu verziju' }).click()
    // The sheet names the version out loud before anything is written.
    await expect(page.getByRole('dialog', { name: 'Objaviti Pravila v1?' })).toBeVisible()
    await page.getByRole('button', { name: 'Objavi', exact: true }).click()

    await expect(page.getByText('Objavljeno v1')).toBeVisible()

    // The acknowledgement list: everybody, nobody confirmed yet.
    const acks = page.locator('section').filter({ hasText: 'Potvrde · v1' }).first()
    await expect(acks.getByText('Amar')).toBeVisible()
    await expect(acks.getByText('nije potvrđeno').first()).toBeVisible()

    await page.close()
  })

  test('the gate stands in front of S1 until Amar has read to the end', async () => {
    for (const open of phone.pages()) await open.close()
    const page = await phone.newPage()

    // He is heading for the floor plan and lands on the rules instead.
    await page.goto('/k')
    await expect(page).toHaveURL(/\/k\/pravila$/)
    await expect(page.getByText('Nova verzija Pravila')).toBeVisible()
    await expect(page.getByText('Potvrdi da nastaviš')).toBeVisible()

    // The published text is here, with the threshold filled in.
    await expect(page.getByText(/Razlika do 5,00.KM je u toleranciji/)).toBeVisible()

    const button = page.getByRole('button', { name: /Potvrđujem Pravila v1/ })
    await expect(button).toBeDisabled()
    await expect(page.getByText('Pročitaj tekst do kraja.')).toBeVisible()
    // 56 px, reachable with a thumb.
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(56)

    // Nothing on this screen scrolls sideways on a 390 px phone.
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)

    // There is no way out but through: another dark route comes straight back.
    await page.goto('/k/moja-smjena')
    await expect(page).toHaveURL(/\/k\/pravila$/)

    // The honesty note about the database file, word for word (PLAN F12 a).
    await expect(page.getByText(/bazu mogu otvoriti vlasnik i Vedran/)).toBeVisible()
    await expect(page.getByText(/Kanal nije tajan — samo nije na vlasnikovom ekranu/)).toBeVisible()

    await page.mouse.wheel(0, 40_000)
    await expect(button).toBeEnabled()
    await button.click()

    // Straight to work, and the gate is gone for good.
    await expect(page).toHaveURL(/\/k$/)
    await page.goto('/k/pravila')
    await expect(page.getByText(/Potvrđena verzija v1/)).toBeVisible()

    await page.close()
  })

  test('the acknowledgement reaches the owner, with the time', async () => {
    const page = await laptop.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/a/postavke/pravila')

    const acks = page.locator('section').filter({ hasText: 'Potvrde · v1' }).first()
    const row = acks.locator('tr').filter({ hasText: 'Amar' }).first()
    await expect(row.getByText('potvrđeno', { exact: true })).toBeVisible()
    await expect(row.locator('td.r')).toHaveText(/\d{2}\.\d{2}\.\d{4}\. \d{2}:\d{2}/)

    await page.close()
  })

  test('a threshold changed in Podešavanja changes Pravila with no new version', async () => {
    expect((await laptop.request.patch('/api/admin/settings', {
      data: { cash_tolerance_fen: 250 },
    })).ok()).toBe(true)

    const page = await phone.newPage()
    await page.goto('/k/pravila')

    // The same version, a different number — which is why the rules are
    // published with tokens rather than typed as text.
    await expect(page.getByText('Pravila v1')).toBeVisible()
    await expect(page.getByText(/Razlika do 2,50.KM je u toleranciji/)).toBeVisible()
    await expect(page.getByText('Tolerancija pazara')).toBeVisible()

    // No English anywhere on the screen, and no emoji.
    const body = (await page.locator('main').innerText()).toLowerCase()
    for (const word of [' the ', 'rules', 'settings', 'version ', 'confirm', 'undefined', 'null']) {
      expect(body).not.toContain(word)
    }
    expect(/\p{Extended_Pictographic}/u.test(body)).toBe(false)

    await page.close()
  })
})
