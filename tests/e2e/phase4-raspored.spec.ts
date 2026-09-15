/**
 * *Raspored* as one weekly pattern, walked on a 1440 px laptop and a 390 px phone.
 *
 * The owner's rule (2026-09-15): "Ne trebaju nam datumi za raspored, samo nam
 * treba da dodamo po danima maksimalno 2 osobe po smjeni i taj raspored ostaje
 * zauvijek." What is proved here:
 *
 *   1. **The owner's screen has no dates and nothing to publish**: weekday
 *      headers, the one-line hint, no *Objavi raspored*, no week arrows.
 *   2. **Two per shift**: two people fill Friday's shift, the third is refused
 *      with `409 SHIFT_FULL`, and the full cell draws no `+`.
 *   3. **An edit reaches the phones at once**: the waiter's S17 shows the
 *      weekly pattern, with no sideways scroll.
 *
 * **One device per person, enrolled once** (PHASE4 §5.1), through
 * `POST /api/admin/enrol-codes` + `POST /api/devices/enrol`.
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
const PET = 5

interface Named { id: string, name: string }
interface Template { id: string, name: string, active: boolean }
interface Pattern { entries: { id: string, weekday: number, template_id: string, user_name: string }[] }

let admin: APIRequestContext
let amarCtx: BrowserContext
let users: Named[]
let shift: Template

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
  await ackRules(context.request)
}

/** Empty Friday's shift, so a re-run of this file starts from the same cell. */
async function clearFriday(): Promise<void> {
  const pattern = await (await admin.get('/api/roster/pattern')).json() as Pattern
  for (const e of pattern.entries.filter(e => e.weekday === PET && e.template_id === shift.id)) {
    await admin.delete(`/api/roster/pattern/${e.id}`)
  }
}

async function put(who: string) {
  return admin.post('/api/roster/pattern', {
    data: { weekday: PET, template_id: shift.id, user_id: users.find(u => u.name === who)!.id },
  })
}

async function adminLogin(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin/login')
  await page.locator('input[type="email"]').first().fill(ADMIN.email)
  await page.locator('input[type="password"]').first().fill(ADMIN.password)
  await page.getByRole('button', { name: 'Prijavi se' }).click()
  await page.waitForURL(/\/admin(\?|$)/)
}

test.beforeAll(async ({ playwright, browser }) => {
  const baseURL = process.env.SANK_E2E_URL ?? 'http://localhost:3112'
  admin = await playwright.request.newContext({ baseURL })
  await resetLimits(admin)
  expect((await admin.post('/api/auth/admin/login', { data: ADMIN })).ok()).toBe(true)

  users = await (await admin.get('/api/admin/users')).json() as Named[]
  const templates = await (await admin.get('/api/admin/shift-templates')).json() as Template[]
  shift = templates.find(t => t.active)!

  amarCtx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })
  await enrolAndLogin(amarCtx, 'Amar')
  await clearFriday()
})

test.afterAll(async () => {
  await clearFriday()
  await amarCtx?.close()
  await admin?.dispose()
})

// ===========================================================================

test('the owner\'s Raspored has weekdays, no dates and nothing to publish', async ({ page }) => {
  await adminLogin(page)
  await page.goto('/admin/raspored')

  await expect(page.getByText('Raspored važi svake sedmice dok ga ne promijeniš.', { exact: false })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Petak' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Objavi raspored' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sljedeća sedmica' })).toHaveCount(0)
  // No "14.09." anywhere in the grid's head.
  const head = await page.locator('thead').first().innerText()
  expect(head).not.toMatch(/\d{2}\.\d{2}\./)
})

test('two people fill a shift, the third is refused and the + is gone', async ({ page }) => {
  expect((await put('Amar')).ok()).toBe(true)
  expect((await put('Dino')).ok()).toBe(true)

  const third = await put('Lejla')
  expect(third.status()).toBe(409)
  const body = await third.json() as { data: { code: string } }
  expect(body.data.code).toBe('SHIFT_FULL')

  await adminLogin(page)
  await page.goto('/admin/raspored')
  await expect(page.getByRole('cell').getByText('Dino').first()).toBeVisible()
  await expect(page.getByRole('button', { name: `Dodaj u ${shift.name}, Petak` })).toHaveCount(0)
})

test('S17 shows the weekly pattern on a phone, with no sideways scroll', async () => {
  await expect.poll(async () => {
    const mine = await (await amarCtx.request.get('/api/me/roster')).json() as Pattern
    return mine.entries.filter(e => e.weekday === PET).map(e => e.user_name)
  }, { timeout: 15_000 }).toContain('Amar')

  const amar: Page = await amarCtx.newPage()
  await amar.goto('/konobar/raspored')
  await expect(amar.getByText('Petak')).toBeVisible()
  await expect(amar.getByText(/Moje smjene u sedmici/)).toBeVisible()
  await expect(amar.getByRole('button', { name: 'Sljedeća' })).toHaveCount(0)

  const overflow = await amar.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  await amar.close()
})
