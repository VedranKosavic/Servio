/**
 * WP1's done-when, walked on a 390 px phone (docs/PHASE4 §3, WP1 and §5.2).
 *
 * What is proved here:
 *
 *   1. A text and a photo sent by Amar in *Svi* reach Emir's phone and Haris's
 *      `/a` — and the photo's `GET /api/uploads/:id` answers 200 for all three.
 *   2. *Konobari* is private: Haris's session gets **403** on the channel and
 *      **404** on a photo posted only there, and his `/a` draws no such row.
 *   3. "predao 612,50 KM" in *Svi* opens the money sheet; *Ipak pošalji* sends.
 *   4. A photo taken with the network down is queued, survives a reload, and
 *      appears **exactly once** after reconnecting.
 *   5. *Dodaj u "Za naručiti"* is two taps and the note lands on the pin bar.
 *   6. A chat message still queued does not block a cash settlement — chat is
 *      never in the money outbox.
 *
 * **Three sessions, three browser contexts, and two real devices** (§5.1): Amar
 * and Emir each enrol their *own* phone through `POST /api/admin/enrol-codes` +
 * `POST /api/devices/enrol`, because `POST /api/dev/enrol` reuses one device row
 * and rotates its token — the second call would log the first phone out. Haris
 * is an e-mail session with no device at all.
 *
 * Run it against a production build on port 3113, never 3002:
 *
 *   rm -f data/verify.db*
 *   DB_PATH=data/verify.db PIN_PEPPER=dev npm run db:seed
 *   npm run build
 *   DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
 *     UPLOAD_DIR=data/verify-uploads PORT=3113 node .output/server/index.mjs
 *   SANK_E2E_URL=http://localhost:3113 npx playwright test tests/e2e/phase4-razgovor.spec.ts
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const AMAR_PIN = '1111'
const EMIR_PIN = '123456'
const ADMIN = { email: 'haris@lounge.ba', password: 'lounge' }

interface LoginUser { id: string, name: string }

/**
 * One phone, enrolled once, with a code an admin minted for it.
 *
 * `POST /api/dev/enrol` is deliberately not used: it reuses a single device row
 * and hands out a fresh token every call, so the second context's enrolment
 * would silently revoke the first context's cookie halfway through the file.
 */
async function enrolOwnDevice(admin: BrowserContext, phone: BrowserContext, label: string) {
  const minted = await admin.request.post('/api/admin/enrol-codes', {
    data: { mode: 'shared', label },
  })
  expect(minted.ok()).toBe(true)
  const { code } = await minted.json() as { code: string }

  const joined = await phone.request.post('/api/devices/enrol', { data: { code, label } })
  expect(joined.ok()).toBe(true)
}

async function loginPin(phone: BrowserContext, who: string, pin: string) {
  const users = await (await phone.request.get('/api/auth/users')).json() as LoginUser[]
  const person = users.find(u => u.name === who)
  expect(person, `${who} is on the lock screen`).toBeTruthy()
  const ok = await phone.request.post('/api/auth/pin', { data: { user_id: person!.id, pin } })
  expect(ok.ok()).toBe(true)
  return person!
}

/** A real JPEG, made by the browser itself — the only decoder we can rely on. */
async function jpegBuffer(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 180
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#8a5a3b'
    ctx.fillRect(0, 0, 240, 180)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(20, 20, 120, 60)
    return canvas.toDataURL('image/jpeg', 0.8)
  })
  return Buffer.from(dataUrl.split(',')[1]!, 'base64')
}

async function sendText(page: Page, text: string) {
  await page.getByLabel('Poruka').fill(text)
  await page.getByRole('button', { name: 'Pošalji' }).click()
}

test.describe('Razgovor', () => {
  let amar: BrowserContext
  let emir: BrowserContext
  let haris: BrowserContext
  let photo: Buffer

  test.beforeAll(async ({ browser }) => {
    haris = await browser.newContext()
    const loggedIn = await haris.request.post('/api/auth/admin/login', { data: ADMIN })
    expect(loggedIn.ok()).toBe(true)

    amar = await browser.newContext()
    await enrolOwnDevice(haris, amar, 'Amar telefon')
    await loginPin(amar, 'Amar', AMAR_PIN)

    emir = await browser.newContext()
    await enrolOwnDevice(haris, emir, 'Sank tablet')
    await loginPin(emir, 'Emir', EMIR_PIN)

    const scratch = await amar.newPage()
    await scratch.goto('/k/razgovor/svi')
    photo = await jpegBuffer(scratch)
    await scratch.close()
  })

  test.afterAll(async () => {
    await Promise.all([amar?.close(), emir?.close(), haris?.close()])
  })

  test('1 · a message and a photo cross the room', async () => {
    const page = await amar.newPage()
    await page.goto('/k/razgovor/svi')
    await expect(page.getByLabel('Poruka')).toBeVisible()

    await sendText(page, 'nema leda')
    await expect(page.getByText('nema leda')).toBeVisible()
    await expect(page.getByText('čeka slanje')).toHaveCount(0, { timeout: 20_000 })

    await page.locator('input[capture]').setInputFiles({
      name: 'slika.jpg', mimeType: 'image/jpeg', buffer: photo,
    })
    // The bubble draws a local `blob:` URL until the server confirms the row;
    // the assertion waits for the real, access-checked URL.
    await expect(page.locator('img[src^="/api/uploads/"]')).toBeVisible({ timeout: 20_000 })

    // Emir's phone, on its own device cookie.
    const emirPage = await emir.newPage()
    await emirPage.goto('/k/razgovor/svi')
    await expect(emirPage.getByText('nema leda')).toBeVisible({ timeout: 20_000 })
    const src = await emirPage.locator('img[src^="/api/uploads/"]').first().getAttribute('src')
    expect(src).toContain('/api/uploads/')
    expect((await emir.request.get(src!)).status()).toBe(200)

    // And the owner's desk.
    const harisPage = await haris.newPage()
    await harisPage.goto('/a/razgovor')
    await harisPage.getByRole('button', { name: /^Svi/ }).click()
    // Scoped to the thread: the channel list carries the same line as a preview.
    await expect(harisPage.locator('.a-pane').getByText('nema leda').last())
      .toBeVisible({ timeout: 20_000 })
    expect((await haris.request.get(src!)).status()).toBe(200)

    await Promise.all([page.close(), emirPage.close(), harisPage.close()])
  })

  test('2 · Konobari is private, and a forward is the only way in', async () => {
    const emirPage = await emir.newPage()
    await emirPage.goto('/k/razgovor/konobari')
    await sendText(emirPage, 'fali sirup od nane')
    await expect(emirPage.getByText('čeka slanje')).toHaveCount(0, { timeout: 20_000 })
    await emirPage.locator('input[capture]').setInputFiles({
      name: 'slika.jpg', mimeType: 'image/jpeg', buffer: photo,
    })
    await expect(emirPage.locator('img[src^="/api/uploads/"]')).toBeVisible({ timeout: 20_000 })
    const src = (await emirPage.locator('img[src^="/api/uploads/"]').first().getAttribute('src'))!

    // A colleague reads it…
    const amarPage = await amar.newPage()
    await amarPage.goto('/k/razgovor/konobari')
    await expect(amarPage.getByText('fali sirup od nane')).toBeVisible({ timeout: 20_000 })

    // …and the owner cannot, by any door.
    expect((await haris.request.get('/api/chat/konobari/messages')).status()).toBe(403)
    expect((await haris.request.get(src)).status()).toBe(404)

    const harisPage = await haris.newPage()
    await harisPage.goto('/a/razgovor')
    await expect(harisPage.getByText('Konobari', { exact: true })).toHaveCount(0)

    // *Prijavi vlasniku* is the one staff → Admini path, and it takes the photo.
    await emirPage.getByText('fali sirup od nane').last().click()
    await emirPage.getByRole('button', { name: 'Prijavi vlasniku' }).click()
    await expect(emirPage.getByRole('button', { name: 'Prijavi vlasniku' })).toHaveCount(0)
    // The photo is the second message. Tapping it opens the viewer, whose
    // *Proslijedi* hands back the same sheet — a picture is never a dead end.
    await emirPage.locator('img[src^="/api/uploads/"]').first().click()
    await emirPage.getByRole('button', { name: 'Proslijedi' }).click()
    await emirPage.getByRole('button', { name: 'Prijavi vlasniku' }).click()
    await expect.poll(
      async () => (await haris.request.get(src)).status(),
      { timeout: 20_000 },
    ).toBe(200)

    await Promise.all([emirPage.close(), amarPage.close(), harisPage.close()])
  })

  test('3 · money-looking text opens the sheet', async () => {
    const page = await amar.newPage()
    await page.goto('/k/razgovor/svi')
    await page.getByLabel('Poruka').fill('predao 612,50 KM')
    await page.getByRole('button', { name: 'Pošalji' }).click()

    await expect(page.getByText('Iznosi kolega ne idu u Svi — pošalji u Admini?')).toBeVisible()
    await page.getByRole('button', { name: 'Ipak pošalji' }).click()
    await expect(page.getByText('predao 612,50 KM')).toBeVisible()

    // In *Admini* the question does not arise, and Amar has no *Admini* at all —
    // the sheet's only other exit is *Odustani*.
    await page.close()
  })

  test('4 · a photo taken with the network off appears exactly once', async () => {
    const page = await amar.newPage()
    await page.goto('/k/razgovor/svi')
    await expect(page.getByLabel('Poruka')).toBeVisible()

    await page.context().setOffline(true)
    await page.locator('input[capture]').setInputFiles({
      name: 'offline.jpg', mimeType: 'image/jpeg', buffer: photo,
    })
    await expect(page.getByText('čeka slanje')).toBeVisible({ timeout: 20_000 })

    // It survives the reload iOS does when the camera hands the phone back.
    await page.reload()
    await expect(page.getByText('čeka slanje')).toBeVisible({ timeout: 15_000 })

    await page.context().setOffline(false)
    await expect(page.getByText('čeka slanje')).toHaveCount(0, { timeout: 30_000 })

    // Exactly once: the replay key is what makes a retry harmless. Two photos
    // by now — check 1's and this one — and a reload must not make it three.
    const before = await page.locator('img[src^="/api/uploads/"]').count()
    expect(before).toBeGreaterThanOrEqual(2)
    await page.reload()
    await expect(page.locator('img[src^="/api/uploads/"]')).toHaveCount(before, { timeout: 20_000 })

    await page.close()
  })

  test('5 · Dodaj u "Za naručiti" is two taps', async () => {
    const page = await amar.newPage()
    await page.goto('/k/razgovor/svi')
    await sendText(page, 'treba ugalj')
    await expect(page.getByText('treba ugalj')).toBeVisible()
    // A queued bubble is a placeholder with no actions; wait for the real row.
    await expect(page.getByText('čeka slanje')).toHaveCount(0, { timeout: 20_000 })

    // Tap one: the bubble. Tap two: the row.
    await page.getByText('treba ugalj').last().click()
    await page.getByRole('button', { name: 'Dodaj u "Za naručiti"' }).click()

    await expect(page.getByText('Za naručiti')).toBeVisible({ timeout: 20_000 })
    await page.close()
  })

  test('6 · a queued message never blocks the money', async () => {
    const page = await amar.newPage()
    await page.goto('/k/razgovor/svi')
    await page.context().setOffline(true)
    await sendText(page, 'javi kad stigne pivo')
    await expect(page.getByText('čeka slanje')).toBeVisible({ timeout: 15_000 })
    await page.context().setOffline(false)

    // The logout gate counts money and stock, never chat.
    await page.goto('/k')
    await page.getByRole('button', { name: 'Korisnik' }).click()
    await expect(page.getByRole('button', { name: 'Razgovor' })).toBeVisible()
    const logout = page.getByRole('button', { name: 'Odjavi se' })
    await expect(logout).toBeEnabled()
    await page.keyboard.press('Escape')
    await page.close()
  })
})
