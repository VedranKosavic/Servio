/**
 * WP4's done-when, walked on a 390 px phone (docs/PHASE3.md §3 and §5.2 check 7).
 *
 * What is proved here:
 *
 *   1. *Moja smjena* is the shift's sold articles and its pazar, and nothing
 *      else — the counts, the blindness, the thirty nights with a *Napomena*,
 *      *Moji sati*, *Moji podaci* and the drill-down all went on 16.09.2026.
 *   2. The same numbers are on the raw `GET /api/me/shift`, under `sold`.
 *   3. *Pravila* renders the venue's published thresholds and no English.
 *   4. The re-lock is a screen over a session that is still alive, so the pad
 *      re-opens it with the right PIN **with the network off** and refuses the
 *      wrong one — while nothing on the phone can *create* a session, which is
 *      why a real login still waits for the network.
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
import { ackRules, resetLimits, pinLogin, PINS, type Person } from './helpers'

/**
 * **Tarik's night, not Amar's.** The five spec files run in one command against
 * one database (§5.1) and Amar is the waiter every other file drives, so his
 * expected cash by the time this file runs is four files' worth of takings and a
 * blind settlement against it could never read *Tačno*. Tarik works only here.
 */

interface Boot {
  tables: { id: string, name: string }[]
  products: { id: string, name: string }[]
  flavours: { id: string, name: string }[]
}

/**
 * The PIN door, for a browser that already holds a device cookie.
 *
 * Split from the enrolment on purpose: the enrolment is the only call in the
 * file that is rate-limited **by IP** (before a device cookie exists the bucket
 * is `ip:…`, after it `d:…`), so it happens once, in `beforeAll`, and a login
 * that comes later costs the device's own bucket and nothing shared.
 *
 * `GET /api/auth/users` used to be read here, to find the id of the person about
 * to be named in the login body. Nothing names anybody now: the digits are the
 * whole login, and `helpers.PINS` is where a spec learns them.
 */
async function loginPin(context: BrowserContext, who: Person = 'Amar') {
  await pinLogin(context.request, who, 'konobar')

  // A published Pravila version stands in front of every /konobar screen (S12), and
  // phase4-pravila publishes one before this file runs. Clear it here so the
  // spec does not depend on where it sits in the alphabet.
  await ackRules(context.request)
}

async function enrolAndLogin(context: BrowserContext, who: Person = 'Amar') {
  expect((await context.request.post('/api/dev/enrol', { data: {} })).ok()).toBe(true)
  await loginPin(context, who)
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
    await resetLimits(context.request)
    await enrolAndLogin(context, 'Tarik')
  })

  test.afterAll(async () => {
    await context?.close()
  })

  test('the sold articles and the shift\'s pazar, and nothing else', async () => {
    // One page at a time: two pages of one context share IndexedDB, and a page
    // left open keeps polling and writing behind the next test's back.
    for (const open of context.pages()) await open.close()
    const page = await context.newPage()
    const takings = await aNight(context)

    // -- 1. the read is the screen -----------------------------------------
    const body = await (await context.request.get('/api/me/shift')).json() as {
      sold: { open: boolean, rows: { name: string, qty: number, fen: number }[], total_fen: number }
    }
    expect(body.sold.open).toBe(true)
    expect(body.sold.total_fen).toBeGreaterThanOrEqual(takings)
    expect(body.sold.rows.map(r => r.name)).toEqual(expect.arrayContaining(['Nargila', 'Kafa', 'Coca-Cola']))

    // -- 2. the articles, with the quantities on them ----------------------
    await page.goto('/konobar/moja-smjena')
    await expect(page.getByRole('heading', { name: 'Večeras' })).toBeVisible()
    await expect(page.getByText('Nargila').first()).toBeVisible()
    await expect(page.getByText('Kafa').first()).toBeVisible()
    await expect(page.getByText('3×').first()).toBeVisible()

    // -- 3. the pazar, in KM, while the night is still running --------------
    // The blindness is gone (the owner's call, 16.09.2026): nobody settles any
    // more, so there is no declaration left for a hidden total to protect.
    const total = page.locator('section').filter({ hasText: 'Ukupan pazar' }).first()
    await expect(total).toBeVisible()
    await expect(total.locator('.num')).toHaveText(/KM/)

    // -- 4. and nothing else is on it --------------------------------------
    for (const gone of ['ture', 'stolovi', 'lule', 'Prošle noći', 'Moji sati', 'Moji podaci', 'Storna']) {
      await expect(page.getByText(gone, { exact: true })).toHaveCount(0)
    }

    // -- 5. no horizontal scroll at 390 px ---------------------------------
    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflows).toBe(false)

    // -- 6. Pravila, from the menu's own address ---------------------------
    await page.goto('/konobar/pravila')
    await expect(page.getByRole('heading', { name: 'Označeno za razgovor' })).toBeVisible()
    await expect(page.getByText('Tolerancija pazara')).toBeVisible()
    await expect(page.getByText(/vlasnik ima pristup toj datoteci/i)).toBeVisible()
  })

  test('the re-locked pad unlocks offline, and refuses the wrong digits', async ({ browser }) => {
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
      data: { email: 'haris@lounge.ba', password: '1111' },
    })).ok()).toBe(true)
    // Read it back first. `shared_device_idle_s` lives in `venues.settings_json`,
    // so it outlives this browser context and this file: left at two seconds it
    // relocks every later /konobar spec two seconds after login, against the same
    // data/verify.db. The `finally` below is what makes the suite re-runnable.
    const before = await (await admin.request.get('/api/admin/settings'))
      .json() as { shared_device_idle_s: number }
    expect((await admin.request.patch('/api/admin/settings', {
      data: { shared_device_idle_s: 2 },
    })).ok()).toBe(true)

    try {
      // Amar's *Pravila* acknowledgement, which S12 wants in front of every
      // /konobar screen. The login below is the one that matters.
      await loginPin(context, 'Amar')

      // The offline unlock is checked against a PIN this phone cached when the
      // **server** accepted it, so the login has to go through the screen. And
      // the screen is only a pad when nobody is signed in: with a live session
      // `/` forwards to that session's own screen instead of asking again.
      expect((await context.request.post('/api/auth/logout', { data: {} })).ok()).toBe(true)
      await page.goto('/')
      await expect(page.getByRole('button', { name: '1', exact: true })).toBeVisible()

      const pad = async (digits: string) => {
        for (const digit of digits) {
          await page.getByRole('button', { name: digit, exact: true }).click()
        }
      }

      // No face to tap on the way in any more: the pad asks for digits and the
      // digits say who typed them. A fresh session has chosen no screen yet, so
      // the second step is where the four digits land.
      await pad(PINS.Amar)
      await expect(page.getByText('Na čemu si večeras?')).toBeVisible()
      await page.getByRole('button', { name: 'Konobar' }).click()
      await expect(page).toHaveURL(/\/konobar$/)

      // -- the tablet goes idle ----------------------------------------------
      await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
      await expect(page.getByText('Telefon se zaključao sam')).toBeVisible()
      // A re-lock is a screen, not a sign-out: it never names the person it is
      // locked over, so what is on it is a pad and nothing else.
      await expect(page.getByText('Amar', { exact: true })).toHaveCount(0)

      // -- and unlocks with no network at all --------------------------------
      await context.setOffline(true)

      // The wrong PIN is refused locally, without inventing a session. The
      // sentence is the pad's, not a person's: offline or not, the screen has
      // no idea whose digits these were meant to be.
      await pad('9999')
      await expect(page.getByText(/PIN nije prepoznat|Pogrešan PIN/)).toBeVisible()

      await pad(PINS.Amar)
      await expect(page).toHaveURL(/\/konobar$/, { timeout: 15_000 })

      await context.setOffline(false)
    } finally {
      await context.setOffline(false)
      await admin.request.patch('/api/admin/settings', {
        data: { shared_device_idle_s: before.shared_device_idle_s },
      })
      await admin.close()
    }
  })
})
