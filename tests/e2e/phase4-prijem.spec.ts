/**
 * *Prijem robe* on `/admin/roba/prijem` — what is left of PHASE4 WP3's checks
 * after the owner removed *Sa slike* from the UI.
 *
 * The photo flow's screens are gone (the typed document is the only way to book
 * a delivery); the server's scan routes are untouched and covered by
 * `tests/unit/scan.test.ts`. What this spec still proves:
 *
 *   1. The page offers no *Sa slike* and draws the typed document.
 *   2. A waiter posting `kind='delivery'` to `POST /api/uploads` is 422 — the
 *      upload door is a server rule and did not move with the UI.
 *
 * Haris is an **admin session**: `haris@lounge.ba / 1111` at `/admin/login`, no
 * device and no PIN. Amar gets an enrolled phone for check 2.
 *
 * Run it against a **production build on port 3113**, never the owner's 3002:
 *
 *   rm -f data/verify.db*
 *   DB_PATH=data/verify.db PIN_PEPPER=dev npm run db:seed
 *   npm run build
 *   DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
 *     UPLOAD_DIR=data/verify-uploads PORT=3113 node .output/server/index.mjs
 *   SANK_E2E_URL=http://localhost:3113 npx playwright test tests/e2e/phase4-prijem.spec.ts
 */
import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'
import { ackRules, resetLimits, pinLogin } from './helpers'

const ADMIN = { email: 'haris@lounge.ba', password: '1111' }

interface Named { id: string, name: string }

let harisCtx: BrowserContext
let haris: APIRequestContext
let amar: APIRequestContext

test.beforeAll(async ({ browser }) => {
  harisCtx = await browser.newContext()
  haris = harisCtx.request
  await resetLimits(haris)

  const login = await haris.post('/api/auth/admin/login', { data: ADMIN })
  expect(login.ok(), await login.text()).toBe(true)

  const me = await (await haris.get('/api/bootstrap')).json() as { users: Named[] }

  // Amar's phone, for the one check that is about a waiter: an enrolled device
  // plus a PIN login, exactly as `docs/PHASE4.md` §5.1 prescribes.
  const amarCtx = await browser.newContext()
  amar = amarCtx.request
  const user = me.users.find(u => u.name === 'Amar')!
  const code = await (await haris.post('/api/admin/enrol-codes', {
    data: { mode: 'personal', bound_user_id: user.id, label: 'Amarov telefon' },
  })).json() as { code: string }
  const enrolled = await amar.post('/api/devices/enrol', {
    data: { code: code.code, label: 'Amarov telefon' },
  })
  expect(enrolled.ok(), await enrolled.text()).toBe(true)
  await pinLogin(amar, 'Amar', 'konobar')
  // S12 stands in front of every /konobar screen once phase4-pravila has published.
  await ackRules(amar)
})

test.afterAll(async () => {
  await harisCtx.close()
})

test('1 · prijem je samo ručni dokument, bez Sa slike', async () => {
  const page = await harisCtx.newPage()
  await page.goto('/admin/roba/prijem')

  await expect(page.getByRole('heading', { name: 'Novi prijem robe' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Proknjiži' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sa slike' })).toHaveCount(0)

  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(/gajb|paket|pakovanj/i)

  await page.close()
})

/**
 * A delivery photo is the owner's alone: a šanker reads Stanje šanka and never
 * receives goods, so `bartender_can_receive_goods` no longer opens the door.
 * The seed still turns that setting on, which is exactly the case worth proving.
 */
test('2 · otpremnicu šalje samo admin', async () => {
  const photo = () => ({
    multipart: {
      // Any bytes: the `kind` check is what answers, and it answers first.
      image: {
        name: 'otpremnica.jpg', mimeType: 'image/jpeg',
        buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]),
      },
      kind: 'delivery',
    },
  })

  const refused = await amar.post('/api/uploads', photo())
  expect(refused.status()).toBe(422)
  const body = await refused.json() as { data?: { code?: string } }
  expect(body.data?.code).toBe('KIND_FORBIDDEN')

  const allowed = await haris.post('/api/uploads', photo())
  expect(allowed.status(), await allowed.text()).not.toBe(422)
})
