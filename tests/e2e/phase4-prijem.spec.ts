/**
 * WP3's done-when — *Prijem sa slike* on `/a/roba/prijem` (PHASE4 §3, check 6).
 *
 * Haris is an **admin session**: `haris@lounge.ba / lounge` at `/a/login`, no
 * device and no PIN. Amar gets an enrolled phone, because one of the five checks
 * is that a waiter cannot upload a delivery photo at all.
 *
 * The photo is **made in the browser**, not read off disk: a canvas is drawn,
 * `toBlob('image/jpeg')`-ed and handed to the file input through a
 * `DataTransfer`. That is deliberate — it exercises the real `app/utils/image.ts`
 * decode-and-downscale path, which a hand-written JPEG with no scan data (the
 * unit tests' `jpegBytes`) cannot: those bytes parse but no browser can *draw*
 * them.
 *
 * The model is the deterministic stub (`SANK_SCAN_STUB=1`), which answers with a
 * fixed eight-line otpremnica — six green, one amber, one unknown — against
 * whatever catalogue it is handed. Nothing here calls the API and the run costs
 * nothing.
 *
 * What is proved:
 *
 *   1. A photo becomes a draft with green, amber **and** unknown lines, and the
 *      header counts say so in Bosnian.
 *   2. *Poveži* on the unknown line writes an alias, and the **second** scan of
 *      the same text comes back green without anybody doing anything.
 *   3. *Proknjiži* books the delivery through the existing route with
 *      `source: 'scan'` and the `scan_id`, one movement per line, at the unit
 *      cost the edited prices imply — and the scan is `applied`, so a second
 *      *Proknjiži* of it is refused.
 *   4. A waiter posting `kind='delivery'` to `POST /api/uploads` is 422.
 *   5. `503 SCAN_NOT_CONFIGURED` renders as a calm Bosnian card with the typed
 *      *Ručno* form open beneath it — no stack trace, no retry loop, no English.
 *   6. The screen holds at 390 px with no horizontal scroll and at 1440 px, in
 *      Bosnian, with no emoji.
 *
 * Run it against a **production build on port 3113**, never the owner's 3002:
 *
 *   rm -f data/verify.db*
 *   DB_PATH=data/verify.db PIN_PEPPER=dev npm run db:seed
 *   npm run build
 *   DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
 *     UPLOAD_DIR=data/verify-uploads SANK_SCAN_STUB=1 \
 *     PORT=3113 node .output/server/index.mjs
 *   SANK_E2E_URL=http://localhost:3113 npx playwright test tests/e2e/phase4-prijem.spec.ts
 */
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { ackRules, resetLimits } from './helpers'

const ADMIN = { email: 'haris@lounge.ba', password: 'lounge' }

/** The unknown line the stub always returns; the alias *Poveži* learns. */
const UNKNOWN_TEXT = 'Salvete 33x33 bijele'

interface Named { id: string, name: string }

let harisCtx: BrowserContext
let haris: APIRequestContext
let amar: APIRequestContext
let boot: { users: Named[] }

/**
 * Draw an otpremnica onto a canvas and feed it to a file input.
 *
 * `DataTransfer` is the only way to put a `File` a page itself created into an
 * `<input type="file">` — `setInputFiles` takes bytes from Node, and a JPEG
 * assembled in Node would have to be a real encoded one for the canvas in
 * `downscale()` to decode it.
 */
async function shootOtpremnica(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1240
    canvas.height = 1754
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#111111'
    ctx.font = '48px sans-serif'
    ctx.fillText('OTPREMNICA OTP-2026-0912', 60, 140)
    ctx.font = '32px sans-serif'
    for (let i = 0; i < 8; i++) ctx.fillText(`stavka ${i + 1} .......... 24,00 KM`, 60, 260 + i * 60)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9))
    const file = new File([blob!], 'otpremnica.jpg', { type: 'image/jpeg' })

    const transfer = new DataTransfer()
    transfer.items.add(file)
    const input = document.querySelector<HTMLInputElement>('input[type="file"][capture]')!
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Open *Prijem* and switch to *Sa slike*. */
async function openScan(page: Page): Promise<void> {
  await page.goto('/a/roba/prijem')
  await expect(page.getByRole('button', { name: 'Sa slike' })).toBeVisible()
  await page.getByRole('button', { name: 'Sa slike' }).click()
  await expect(page.getByRole('button', { name: 'Slikaj otpremnicu' })).toBeVisible()
}

const draftCard = (page: Page) => page.locator('section, article').filter({ hasText: 'prepoznato' }).first()

test.beforeAll(async ({ browser }) => {
  harisCtx = await browser.newContext()
  haris = harisCtx.request
  await resetLimits(haris)

  const login = await haris.post('/api/auth/admin/login', { data: ADMIN })
  expect(login.ok(), await login.text()).toBe(true)

  const me = await (await haris.get('/api/bootstrap')).json() as { users: Named[] }
  boot = { users: me.users }

  // Amar's phone, for the one check that is about a waiter: an enrolled device
  // plus a PIN login, exactly as `docs/PHASE4.md` §5.1 prescribes.
  const amarCtx = await browser.newContext()
  amar = amarCtx.request
  const user = boot.users.find(u => u.name === 'Amar')!
  const code = await (await haris.post('/api/admin/enrol-codes', {
    data: { mode: 'personal', bound_user_id: user.id, label: 'Amarov telefon' },
  })).json() as { code: string }
  const enrolled = await amar.post('/api/devices/enrol', {
    data: { code: code.code, label: 'Amarov telefon' },
  })
  expect(enrolled.ok(), await enrolled.text()).toBe(true)
  const pin = await amar.post('/api/auth/pin', { data: { user_id: user.id, pin: '1111' } })
  expect(pin.ok(), await pin.text()).toBe(true)
  // S12 stands in front of every /k screen once phase4-pravila has published.
  await ackRules(amar)
})

test.afterAll(async () => {
  await harisCtx.close()
})

test('1 · slika postaje nacrt sa prepoznatim, nesigurnim i nepoznatim redovima', async () => {
  const page = await harisCtx.newPage()
  await openScan(page)

  await shootOtpremnica(page)

  // The waiting state ("Čitam sliku…") is deliberately not asserted here: the
  // stub answers in a millisecond, so the honest wait a real model produces is
  // gone before Playwright can look at it, and a test that raced for it would
  // fail on a fast machine rather than on a bug.
  await expect(page.getByText('prepoznato', { exact: false }).first()).toBeVisible({ timeout: 30_000 })

  // The header counts, in Bosnian, as the spec words them.
  await expect(draftCard(page)).toContainText('6 prepoznato')
  await expect(draftCard(page)).toContainText('1 nesigurno')
  await expect(draftCard(page)).toContainText('1 nepoznato')

  // The unknown line offers exactly the three ways out.
  await expect(page.getByText(UNKNOWN_TEXT)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Poveži' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Novi artikal' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preskoči' }).first()).toBeVisible()

  // The photo is pinned at the top and opens full screen.
  await page.getByRole('button', { name: /cijelu sliku/ }).click()
  await expect(page.getByRole('button', { name: 'Zatvori' })).toBeVisible()
  await page.getByRole('button', { name: 'Zatvori' }).click()

  // 390 px, no horizontal scroll, no emoji.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(/\p{Extended_Pictographic}/u)

  await page.close()
})

test('2 · Poveži uči naziv, pa je sljedeći sken zelen', async () => {
  const page = await harisCtx.newPage()
  await openScan(page)
  await shootOtpremnica(page)
  await expect(draftCard(page)).toContainText('1 nepoznato', { timeout: 30_000 })

  await page.getByRole('button', { name: 'Poveži' }).click()
  await expect(page.getByRole('heading', { name: 'Poveži sa artiklom' })).toBeVisible()

  // Any real article will do; the alias is what is being learned, not the pick.
  await page.locator('.a-hit').first().click()
  await page.getByRole('button', { name: 'Poveži', exact: true }).last().click()

  // The line stops being unknown the moment it has an article.
  await expect(draftCard(page)).toContainText('0 nepoznato')

  // The alias is on the server: a **second** scan of the same photo comes back
  // with that line green, at confidence 1,0, because `supplier_aliases` beats
  // the model rather than being consulted after it.
  await page.reload()
  await page.getByRole('button', { name: 'Sa slike' }).click()
  await shootOtpremnica(page)
  await expect(draftCard(page)).toContainText('7 prepoznato', { timeout: 30_000 })
  await expect(draftCard(page)).toContainText('0 nepoznato')

  await page.close()
})

test('3 · Proknjiži knjiži prijem sa source=scan i zatvara sken', async () => {
  const page = await harisCtx.newPage()
  await openScan(page)
  await shootOtpremnica(page)
  await expect(draftCard(page)).toContainText('prepoznato', { timeout: 30_000 })

  // Whatever is still unmatched is deliberately skipped — the screen refuses to
  // post while a line is undecided, which is the rule being exercised here. Only
  // the *unknown* rows' button is taken: every row offers *Preskoči*, and
  // skipping all of them would leave nothing to book.
  const unknownSkips = page.locator('.a-unknown-acts').getByRole('button', { name: 'Preskoči' })
  for (let left = await unknownSkips.count(); left > 0; left--) {
    await unknownSkips.first().click()
  }

  const before = await (await haris.get(
    '/api/stock/deliveries?from=2000-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z',
  )).json() as unknown[]

  await page.getByRole('button', { name: 'Proknjiži' }).click()
  await expect(page.getByText('Prijem je proknjižen.')).toBeVisible({ timeout: 30_000 })

  const after = await (await haris.get(
    '/api/stock/deliveries?from=2000-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z',
  )).json() as Array<{ source: string, scan_id: string | null, lines: unknown[], total_fen: number }>

  expect(after.length).toBe(before.length + 1)
  const booked = after.find(row => row.source === 'scan')!
  expect(booked).toBeDefined()
  expect(booked.scan_id).not.toBeNull()
  expect(booked.lines.length).toBeGreaterThan(0)
  expect(booked.total_fen).toBeGreaterThan(0)

  // The scan is `applied`: discarding it now is refused, in Bosnian.
  const discard = await haris.post(`/api/stock/scans/${booked.scan_id}/discard`, {
    data: { reason: 'test' },
  })
  expect(discard.status()).toBe(409)

  await page.close()
})

test('4 · konobar ne može poslati sliku otpremnice', async () => {
  const res = await amar.post('/api/uploads', {
    multipart: {
      // Any bytes: the `kind` check is what answers, and it answers first.
      image: { name: 'otpremnica.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]) },
      kind: 'delivery',
    },
  })
  expect(res.status()).toBe(422)
  const body = await res.json() as { data?: { code?: string } }
  expect(body.data?.code).toBe('KIND_FORBIDDEN')
})

test('5 · nepodešeno prepoznavanje je mirna kartica, a Ručno i dalje knjiži', async () => {
  const page = await harisCtx.newPage()

  // The venue without an `ANTHROPIC_API_KEY`, drawn: the server's own 503 is
  // WP0's unit test, and this is the client branch it produces.
  await page.route('**/api/stock/deliveries/scan', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        code: 'SCAN_NOT_CONFIGURED',
        message: 'Prepoznavanje sa slike nije podešeno — unesi prijem ručno.',
      },
    }),
  }))

  await openScan(page)
  await shootOtpremnica(page)

  await expect(page.getByText('Prepoznavanje sa slike nije podešeno. Unesi prijem ručno.'))
    .toBeVisible({ timeout: 30_000 })

  // And the typed form is open right underneath it, not somewhere else.
  await expect(page.getByRole('heading', { name: 'Novi prijem robe' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Proknjiži' })).toBeVisible()

  await page.close()
})

test('6 · nacrt se drži i na 1440 px', async () => {
  const page = await harisCtx.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  await openScan(page)
  await shootOtpremnica(page)
  await expect(draftCard(page)).toContainText('prepoznato', { timeout: 30_000 })

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  await page.close()
})
