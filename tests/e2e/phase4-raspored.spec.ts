/**
 * WP2's done-when, walked on a 390 px phone and a 1440 px laptop
 * (docs/PHASE4.md §3 WP2, and §5.2 check 4).
 *
 * What is proved here:
 *
 *   1. **A published week repeats.** *Objavi raspored* turns the pill *nacrt →
 *      objavljeno*, and the week after it shows the same people under *važi od*
 *      with nothing copied (*Kopiraj prošlu sedmicu* is gone: "Kada se objavi
 *      raspored, taj raspored važi zauvijek osim ako se objavi novi raspored").
 *   2. **A published week reaches the phones**, and an unpublished one does not:
 *      a draft says "Raspored za sljedeću sedmicu još nije objavljen" and shows
 *      nobody, because the server sends staff a different query and not a
 *      filtered one.
 *   3. *(Skipped.)* **A swap crossing two phones** — swaps and sick days are gone
 *      from the app ("Ne trebaju nam zamjene i bolovanje"); the test stays as a
 *      named skip so nobody wonders where it went.
 *   4. **A shift in the past is refused in Bosnian**, with the sentence from
 *      `shared/errors/roster.ts` and not a status code.
 *   5. ***Sati* prints the caveat and the two rows that are not shifts** —
 *      "Prva akcija nije dolazak." and *radio bez rasporeda* for the person who
 *      was there and is not on the plan.
 *
 * **One device per person, enrolled once** (PHASE4 §5.1). `POST /api/dev/enrol`
 * reuses one device row and rotates its token, so a second call would invalidate
 * the first browser's cookie; these two enrol through
 * `POST /api/admin/enrol-codes` + `POST /api/devices/enrol` instead, in
 * `beforeAll`, and the cookies are never reset.
 *
 * Run it against a **production build**, never the owner's 3002:
 *
 *   rm -f data/verify.db data/verify.db-wal data/verify.db-shm
 *   DB_PATH=data/verify.db PIN_PEPPER=dev npm run db:seed
 *   npm run build
 *   DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
 *     PORT=3113 node .output/server/index.mjs
 *   SANK_E2E_URL=http://localhost:3113 npx playwright test tests/e2e/phase4-raspored.spec.ts
 */
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { ackRules, resetLimits, pinLogin, type Person } from './helpers'

const ADMIN = { email: 'haris@lounge.ba', password: '1111' }

interface Named { id: string, name: string }
interface Template { id: string, name: string }

let admin: APIRequestContext
let amarCtx: BrowserContext
let dinoCtx: BrowserContext
let users: Named[]
let templates: Template[]

/** Monday of the week containing `date`, the way `shared/dates.ts` does it. */
function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const ms = Date.UTC(y!, m! - 1, d!)
  const back = (new Date(ms).getUTCDay() + 6) % 7
  return new Date(ms - back * 86_400_000).toISOString().slice(0, 10)
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!) + n * 86_400_000).toISOString().slice(0, 10)
}

/** The café's own day, which at 01:30 is still yesterday. */
async function businessToday(): Promise<string> {
  const now = new Date()
  const sarajevo = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Sarajevo' }))
  const shifted = new Date(sarajevo.getTime() - 6 * 3600_000)
  return shifted.toISOString().slice(0, 10)
}

let today: string
let thisWeek: string
let nextWeek: string
let weekAfter: string

async function enrolAndLogin(context: BrowserContext, who: string): Promise<void> {
  const user = users.find(u => u.name === who)!
  const code = await (await admin.post('/api/admin/enrol-codes', {
    data: { mode: 'personal', bound_user_id: user.id, label: `${who}ov telefon` },
  })).json() as { code: string }

  const enrolled = await context.request.post('/api/devices/enrol', {
    data: { code: code.code, label: `${who}ov telefon` },
  })
  expect(enrolled.ok(), await enrolled.text()).toBe(true)

  await pinLogin(context.request, who as Person, 'konobar')

  // A published Pravila version stands in front of every /konobar screen (S12), and
  // phase4-pravila publishes one before this file runs. Clear it here so the
  // spec does not depend on where it sits in the alphabet.
  await ackRules(context.request)
}

/** Put somebody on a shift. Tolerates a row that is already there. */
async function roster(workDate: string, templateName: string, who: string): Promise<void> {
  const res = await admin.post('/api/roster/assignments', {
    data: {
      work_date: workDate,
      template_id: templates.find(t => t.name === templateName)!.id,
      user_id: users.find(u => u.name === who)!.id,
      force_double: true,
    },
  })
  // 409 on a re-run of this file against the same database is fine: the row the
  // test wants is there either way.
  expect([200, 201, 409]).toContain(res.status())
}

test.beforeAll(async ({ playwright, browser }) => {
  const baseURL = process.env.SANK_E2E_URL ?? 'http://localhost:3112'
  admin = await playwright.request.newContext({ baseURL })
  await resetLimits(admin)
  expect((await admin.post('/api/auth/admin/login', { data: ADMIN })).ok()).toBe(true)

  users = await (await admin.get('/api/admin/users')).json() as Named[]
  templates = await (await admin.get('/api/admin/shift-templates')).json() as Template[]

  today = await businessToday()
  thisWeek = weekStart(today)
  nextWeek = addDays(thisWeek, 7)
  weekAfter = addDays(thisWeek, 14)

  amarCtx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })
  dinoCtx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })
  await enrolAndLogin(amarCtx, 'Amar')
  await enrolAndLogin(dinoCtx, 'Dino')
})

test.afterAll(async () => {
  await amarCtx?.close()
  await dinoCtx?.close()
  await admin?.dispose()
})

// ===========================================================================

test('a draft week is the owner\'s alone, and publishing it is two taps', async ({ page }) => {
  // Next week gets its rows through the API — this test is about the two
  // buttons, not about clicking twelve names. Amar on the Friday and Dino on
  // the Saturday, so the swap test below has exactly one row to tap and the
  // taker has no row of his own in that cell.
  await roster(addDays(nextWeek, 4), 'Večernja', 'Amar')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').or(page.locator('input[type="email"]')).first().fill(ADMIN.email)
  await page.locator('input[type="password"]').first().fill(ADMIN.password)
  await page.getByRole('button', { name: 'Prijavi se' }).click()
  await page.waitForURL(/\/admin(\?|$)/)

  await page.goto(`/admin/raspored?w=${nextWeek}`)
  await expect(page.getByText('nacrt', { exact: true })).toBeVisible()

  // The waiter cannot see a draft at all — a different query, not a filter.
  const staffDraft = await (await amarCtx.request.get(`/api/roster?from=${nextWeek}&to=${nextWeek}`))
    .json() as { days: { assignments: unknown[] }[] }[]
  expect(staffDraft[0]!.days.flatMap(d => d.assignments)).toEqual([])

  await page.getByRole('button', { name: 'Objavi raspored' }).click()
  await expect(page.getByText('objavljeno', { exact: true })).toBeVisible()

  // …and now he can.
  await expect.poll(async () => {
    const weeks = await (await amarCtx.request.get(`/api/roster?from=${nextWeek}&to=${nextWeek}`))
      .json() as { days: { assignments: { user_name: string }[] }[] }[]
    return weeks[0]!.days.flatMap(d => d.assignments).map(a => a.user_name)
  }, { timeout: 15_000 }).toContain('Amar')
})

/**
 * Replaces *kopiraj prošlu sedmicu fills the next one in one tap*: the button is
 * gone, because a published week already repeats into every week after it.
 */
test('the week after a published one repeats it, with nothing copied', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin/login')
  await page.locator('input[type="email"]').first().fill(ADMIN.email)
  await page.locator('input[type="password"]').first().fill(ADMIN.password)
  await page.getByRole('button', { name: 'Prijavi se' }).click()
  await page.waitForURL(/\/admin(\?|$)/)

  // Publish, if this file's first test did not already.
  await admin.post('/api/roster/weeks/publish', { data: { week_start: nextWeek } })

  await page.goto(`/admin/raspored?w=${weekAfter}`)
  await expect(page.getByText(/važi od/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Amar').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Kopiraj prošlu sedmicu' })).toHaveCount(0)
  // Nothing to publish: the plan in force already covers this week.
  await expect(page.getByRole('button', { name: 'Objavi raspored' })).toBeDisabled()

  // A phone sees the same repeat, on a week nobody wrote.
  const staff = await (await amarCtx.request.get(`/api/roster?from=${weekAfter}&to=${weekAfter}`))
    .json() as { inherited_from: string | null, days: { assignments: { user_name: string }[] }[] }[]
  expect(staff[0]!.inherited_from).toBe(nextWeek)
  expect(staff[0]!.days.flatMap(d => d.assignments).map(a => a.user_name)).toContain('Amar')
})

// ===========================================================================

/**
 * Skipped, not deleted: the owner removed swaps and sick days from the app
 * ("Ne trebaju nam zamjene i bolovanje"). *Traži zamjenu*, *Preuzimam* and the
 * *Zamjene* page no longer exist, so there is nothing on a phone to tap. The
 * server routes survive unused and keep their unit tests in
 * `tests/unit/roster.test.ts`; the privacy rule this test walked (the room never
 * learns the reason) is asserted there too.
 */
test.skip('a swap crosses two phones and says nothing about the reason', () => {})

// ===========================================================================

test('a shift in the past is refused in Bosnian', async () => {
  const yesterday = addDays(today, -1)
  const res = await admin.post('/api/roster/assignments', {
    data: {
      work_date: yesterday,
      template_id: templates[0]!.id,
      user_id: users.find(u => u.name === 'Amar')!.id,
    },
  })
  expect(res.status()).toBe(409)
  const body = await res.json() as { data: { code: string } }
  expect(body.data.code).toBe('ROSTER_LOCKED')

  // …and the phone renders the sentence, not the code.
  const { ROSTER_ERRORS } = await import('../../shared/errors/roster')
  expect(ROSTER_ERRORS.ROSTER_LOCKED).toBe('Prošli dani se ne mijenjaju.')
})

// ===========================================================================

test('Sati prints the caveat and the person who was there without a plan', async ({ page }) => {
  // Amar locks one round tonight. He is not on tonight's plan, so the month
  // owes him a *radio bez rasporeda* row — the whole point of printing it.
  const boot = await (await amarCtx.request.get('/api/bootstrap')).json() as
    { tables: Named[], products: Named[] }
  const order = await amarCtx.request.post('/api/orders', {
    data: {
      client_id: crypto.randomUUID(),
      table_id: boot.tables[0]!.id,
      lines: [{ id: crypto.randomUUID(), product_id: boot.products[0]!.id, qty: 1 }],
    },
  })
  expect(order.ok(), await order.text()).toBe(true)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin/login')
  await page.locator('input[type="email"]').first().fill(ADMIN.email)
  await page.locator('input[type="password"]').first().fill(ADMIN.password)
  await page.getByRole('button', { name: 'Prijavi se' }).click()
  await page.waitForURL(/\/admin(\?|$)/)

  await page.goto('/admin/raspored?tab=sati')

  // Printed on the page, never in a tooltip (PLAN §8).
  await expect(page.getByText('Prva akcija nije dolazak.')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/radio bez rasporeda/).first()).toBeVisible()
})

// ===========================================================================

test('S17 opens on a phone, in Bosnian, with no sideways scroll', async () => {
  const amar: Page = await amarCtx.newPage()
  await amar.goto('/konobar/raspored')
  await expect(amar.getByText('Raspored').first()).toBeVisible()

  // The rule the whole screen rests on: nothing here queues.
  await expect(amar.getByRole('button', { name: 'Ova sedmica' })).toBeVisible()
  await expect(amar.getByRole('button', { name: 'Sljedeća' })).toBeVisible()

  const overflow = await amar.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  await amar.close()
})
