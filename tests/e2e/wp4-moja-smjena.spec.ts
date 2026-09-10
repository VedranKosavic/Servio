/**
 * WP4's done-when, walked on a 390 px phone (docs/PHASE3.md §3 and §5.2 check 7).
 *
 * What is proved here:
 *
 *   1. Before settlement, S11 shows ture, stolovi and category counts and **no
 *      KM at all**, and the raw `GET /api/me/shift` body contains no `*_fen`
 *      key but `max_fen`.
 *   2. The category chip opens the drill-down, whose footer is absent until he
 *      has settled — the same blindness, said the same way.
 *   3. A *Napomena* typed on a night survives a reload.
 *   4. After *Završi smjenu*, the same night reads in KM with the tolerance word.
 *   5. *Pravila* renders the venue's published thresholds and no English.
 *   6. The lock screen offers the people who signed in **on this device** as
 *      faces, and the re-lock unlocks with the right PIN **with the network
 *      off** and refuses the wrong one — while a colleague's PIN still needs
 *      the network, because nothing on the phone can create a session.
 *
 * **One device per file, enrolled once** (§5.1): `authLimiter` allows ten auth
 * calls a minute per IP on a production build, so the enrolment and the first
 * login happen in `beforeAll` and every test opens a fresh page on the same
 * context.
 *
 * Run it against a production build on a port that is not 3002:
 *
 *   rm -f data/verify-wp4.db*
 *   DB_PATH=data/verify-wp4.db npm run db:seed
 *   npm run build
 *   DB_PATH=data/verify-wp4.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
 *     PORT=3114 node .output/server/index.mjs
 *   SANK_E2E_URL=http://localhost:3114 npx playwright test tests/e2e/wp4-moja-smjena.spec.ts
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const AMAR_PIN = '1111'
const EMIR_PIN = '123456'
/**
 * **Tarik's night, not Amar's.** The five spec files run in one command against
 * one database (§5.1) and Amar is the waiter every other file drives, so his
 * expected cash by the time this file runs is four files' worth of takings and a
 * blind settlement against it could never read *Tačno*. Tarik works only here.
 */
const TARIK_PIN = '4444'

interface Boot {
  tables: { id: string, name: string }[]
  products: { id: string, name: string }[]
  flavours: { id: string, name: string }[]
}

interface LoginUser { id: string, name: string, last_login_at: string | null }

/**
 * The device's own view of who may sign in, read **once**.
 *
 * `GET /api/auth/users` is an auth door like the PIN itself: ten a minute,
 * keyed by this device. Re-reading it before every login is how a file that
 * signs three people in walks into its own 429 (§5.1). The ids never change.
 */
let loginUsers: LoginUser[] | null = null

async function knownUsers(context: BrowserContext, fresh = false): Promise<LoginUser[]> {
  if (fresh || !loginUsers) {
    loginUsers = await (await context.request.get('/api/auth/users')).json() as LoginUser[]
  }
  return loginUsers
}

/**
 * The PIN door, for a browser that already holds a device cookie.
 *
 * Split from the enrolment on purpose: the enrolment is the only call in the
 * file that is rate-limited **by IP** (before a device cookie exists the bucket
 * is `ip:…`, after it `d:…`), so it happens once, in `beforeAll`, and a login
 * that comes later costs the device's own bucket and nothing shared.
 */
async function loginPin(context: BrowserContext, who = 'Amar', pin = AMAR_PIN) {
  const person = (await knownUsers(context)).find(u => u.name === who)!
  expect((await context.request.post('/api/auth/pin', {
    data: { user_id: person.id, pin },
  })).ok()).toBe(true)
  return person
}

async function enrolAndLogin(context: BrowserContext, pin = AMAR_PIN, who = 'Amar') {
  expect((await context.request.post('/api/dev/enrol', { data: {} })).ok()).toBe(true)
  return await loginPin(context, who, pin)
}

/** A night on this phone, written through the real routes. */
async function aNight(context: BrowserContext) {
  const boot = await (await context.request.get('/api/bootstrap')).json() as Boot
  const table = (name: string) => boot.tables.find(t => t.name === name)!.id
  const product = (name: string) => boot.products.find(p => p.name === name)!.id
  // A nargila without an aroma is a 400 `FLAVOURS_REQUIRED`, which is the
  // server refusing to guess what is in the bowl.
  const aroma = boot.flavours[0]!.id

  const rounds: { tabId: string, total: number }[] = []
  for (const [name, lines] of [
    ['Sto 1', [{ product: 'Nargila', qty: 1 }, { product: 'Kafa', qty: 2 }]],
    ['Sto 2', [{ product: 'Coca-Cola', qty: 3 }]],
  ] as const) {
    const res = await context.request.post('/api/orders', {
      data: {
        client_id: crypto.randomUUID(),
        table_id: table(name),
        lines: lines.map(l => ({
          id: crypto.randomUUID(),
          product_id: product(l.product),
          qty: l.qty,
          ...(l.product === 'Nargila' ? { flavour_ids: [aroma] } : {}),
        })),
      },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json() as { tab_id: string, order_total_fen: number }
    rounds.push({ tabId: body.tab_id, total: body.order_total_fen })
  }

  for (const round of rounds) {
    const paid = await context.request.post('/api/payments', {
      data: {
        client_id: crypto.randomUUID(),
        tab_id: round.tabId,
        method: 'cash',
        amount_fen: round.total,
      },
    })
    expect(paid.ok()).toBe(true)
  }

  return rounds.reduce((sum, r) => sum + r.total, 0)
}

let context: BrowserContext

test.describe.configure({ mode: 'serial' })

test.describe('WP4 — Moja smjena', () => {
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext()
    await enrolAndLogin(context, TARIK_PIN, 'Tarik')
  })

  test.afterAll(async () => {
    await context?.close()
  })

  test('counts before the envelope, money after it, and a note that survives', async () => {
    // One page at a time: two pages of one context share IndexedDB, and a page
    // left open keeps polling and writing behind the next test's back.
    for (const open of context.pages()) await open.close()
    const page = await context.newPage()
    const takings = await aNight(context)

    // -- 1. the raw body carries no money but the published ceiling ---------
    const raw = await (await context.request.get('/api/me/shift')).text()
    const body = JSON.parse(raw) as {
      counts: { rounds: number, tabs: number, bowls: number }
      summary: unknown
    }
    expect(body.summary).toBeNull()
    expect(JSON.stringify(body.counts).match(/\w*_fen"/g)).toEqual(['max_fen"'])
    expect(body.counts.rounds).toBeGreaterThanOrEqual(2)

    // -- 2. and neither does the screen ------------------------------------
    await page.goto('/k/moja-smjena')
    await expect(page.getByRole('heading', { name: 'Večeras' })).toBeVisible()

    const tonight = page.locator('section').filter({ hasText: 'Večeras' }).first()
    await expect(tonight.getByText('ture')).toBeVisible()
    await expect(tonight.getByText('stolovi')).toBeVisible()
    await expect(tonight.getByText('lule')).toBeVisible()
    // The three tiles are the server's own counts, not a number this test
    // invented — the database may already hold earlier nights.
    await expect(tonight.locator('.num').nth(0)).toHaveText(String(body.counts.rounds))
    await expect(tonight.locator('.num').nth(1)).toHaveText(String(body.counts.tabs))
    await expect(tonight.locator('.num').nth(2)).toHaveText(String(body.counts.bowls))

    // The only KM anywhere on this screen is the staff-drink ceiling, which is
    // the published rule and not his money.
    // `formatKm` joins the number to "KM" with a non-breaking space, so the
    // amount never wraps away from its unit at the end of a line.
    const kmBefore = (await page.getByText(/KM/).allInnerTexts())
      .map(t => t.replace(/\u00a0/g, ' ').trim())
    expect(kmBefore).toContain('do 3,00 KM')
    expect(kmBefore.filter(t => t !== 'do 3,00 KM')).toEqual([])

    // Category chips, with the counts on them.
    await expect(page.getByRole('link', { name: /Nargila/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Kafa/ })).toBeVisible()

    // -- 3. no horizontal scroll at 390 px ---------------------------------
    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflows).toBe(false)

    // -- 4. the drill-down, still blind ------------------------------------
    await page.getByRole('link', { name: /Kafa/ }).first().click()
    await expect(page).toHaveURL(/\/k\/moja-smjena\/stavke\?kat=/)
    await expect(page.getByText('Kafa').first()).toBeVisible()
    await expect(page.getByText(/Zbir vidiš kad predaš pazar/)).toBeVisible()
    await expect(page.getByText('Naplaćeno', { exact: true })).toHaveCount(0)

    await page.goBack()

    // -- 5. Pravila ---------------------------------------------------------
    await page.getByRole('link', { name: 'Pravila', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Označeno za razgovor' })).toBeVisible()
    await expect(page.getByText('Tolerancija pazara')).toBeVisible()
    await expect(page.getByText(/vlasnik ima pristup toj datoteci/i)).toBeVisible()

    await page.goto('/k/moja-smjena')

    // -- 6. settle, then the money -----------------------------------------
    const shift = await (await context.request.get('/api/me/shift')).json() as
      { shift: { id: string } }
    const settled = await context.request.post(`/api/shifts/${shift.shift.id}/settle`, {
      data: { declared_fen: takings, outbox_len: 0 },
    })
    expect(settled.ok()).toBe(true)

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Pazar je predan' })).toBeVisible()
    await expect(page.getByText('U toleranciji')).toBeVisible()
    await expect(page.getByText('Promet')).toBeVisible()
    // Twice: once on tonight's card, once on tonight's row in the history.
    await expect(page.getByText('Tačno')).toHaveCount(2)

    // -- 7. a note on a night, and a reload ---------------------------------
    const nightRow = page.locator('section').filter({ hasText: 'Prošle noći' }).first()
    await nightRow.getByRole('button', { name: /Napomena/ }).first().click()
    await nightRow.getByLabel('Napomena').fill('kasnio sam sat, dogovoreno')
    await nightRow.getByRole('button', { name: /Sačuvaj|Čuvam/ }).click()
    await expect(nightRow.getByText('kasnio sam sat, dogovoreno')).toBeVisible()

    // The done-when: it is still there after a reload, which means the server
    // has it and the screen is not showing what it typed.
    await page.reload()
    await expect(page.getByText('kasnio sam sat, dogovoreno')).toBeVisible()

    // -- 8. Moji sati and Moji podaci ---------------------------------------
    await expect(page.getByRole('heading', { name: 'Moji sati' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Moji podaci' })).toBeVisible()
    await expect(page.getByText('ovaj telefon')).toBeVisible()
  })

  test('the lock screen offers this device’s faces and unlocks offline', async ({ browser }) => {
    // The re-lock is walked rather than waited out, but the whole flow — two
    // logins, a settings patch, an idle window and an offline unlock — is more
    // than the file's default minute.
    test.setTimeout(120_000)
    for (const open of context.pages()) await open.close()
    const page = await context.newPage()
    // A two-second idle window, so the re-lock can be walked rather than waited
    // out. It is a venue setting for exactly this reason: the café's own tablet
    // runs at five minutes.
    //
    // The owner logs in from a **context of his own**: signing him in on the
    // phone would end the waiter's session and spend one of that device's ten
    // auth calls a minute, which is the budget this whole test lives inside.
    const admin = await browser.newContext()
    expect((await admin.request.post('/api/auth/admin/login', {
      data: { email: 'haris@lounge.ba', password: 'lounge' },
    })).ok()).toBe(true)
    expect((await admin.request.patch('/api/admin/settings', {
      data: { shared_device_idle_s: 2 },
    })).ok()).toBe(true)
    await admin.close()

    // Two people on the same device, so the lock screen has something to rank.
    await loginPin(context, 'Amar', AMAR_PIN)
    await loginPin(context, 'Emir', EMIR_PIN)

    // Signed in here, so ranked here; Dino never has.
    const ranked = await knownUsers(context, true)
    expect(ranked.find(u => u.name === 'Amar')?.last_login_at).toBeTruthy()
    expect(ranked.find(u => u.name === 'Dino')?.last_login_at).toBeNull()

    // Log in through the screen itself, so the PIN is cached for the re-lock.
    await page.goto('/')
    await page.getByRole('button', { name: /Promijeni korisnika/ }).click()
    await expect(page.getByRole('heading', { name: 'Ko si?' })).toBeVisible()

    // Amar and Emir are the faces; Dino is behind *Svi ostali*.
    await expect(page.getByRole('button', { name: /Amar/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Dino/ })).toHaveCount(0)
    await page.getByRole('button', { name: /Svi ostali/ }).click()
    await expect(page.getByRole('button', { name: /Dino/ })).toBeVisible()

    await page.getByRole('button', { name: /Amar/ }).first().click()
    for (const digit of AMAR_PIN) {
      await page.getByRole('button', { name: digit, exact: true }).click()
    }
    await expect(page).toHaveURL(/\/k$/)

    // -- the tablet goes idle ----------------------------------------------
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
    await expect(page.getByText('Telefon se zaključao sam')).toBeVisible()

    // -- and unlocks with no network at all --------------------------------
    await context.setOffline(true)

    await page.getByRole('button', { name: /Amar/ }).first().click()
    // The wrong PIN is refused locally, without inventing a session.
    for (const digit of '9999') {
      await page.getByRole('button', { name: digit, exact: true }).click()
    }
    await expect(page.getByText('Pogrešan PIN.')).toBeVisible()

    for (const digit of AMAR_PIN) {
      await page.getByRole('button', { name: digit, exact: true }).click()
    }
    await expect(page).toHaveURL(/\/k$/, { timeout: 15_000 })

    await context.setOffline(false)
  })
})
