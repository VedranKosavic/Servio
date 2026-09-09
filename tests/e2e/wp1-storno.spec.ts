/**
 * WP1's done-when, walked on a 390 px phone (docs/PHASE3.md §3 and §5.2 check 2).
 *
 * Two contexts, two devices, because that is the shape of the thing being
 * tested: Amar asks from the floor and Emir answers from behind the bar. Each
 * enrols its **own** device through `POST /api/admin/enrol-codes` +
 * `POST /api/devices/enrol` rather than `/api/dev/enrol`, which reuses one
 * shared device row and rotates its token — the second context's enrol would
 * quietly invalidate the first's cookie (§5.1).
 *
 * Both are built **once**, in `beforeAll`, and shared by every test below. Not
 * tidiness: `authLimiter` allows ten auth calls a minute per IP on a production
 * build, and a login-per-test run walks into its own 429 before the third case.
 *
 * What is proved here:
 *
 *   1. A storno asked for without a PIN lands `pending`, and Emir's *Na čekanju*
 *      shows it with who, which table, which line, how much and what it does to
 *      the shelf — then one tap of *Odobri* clears it and the tab total drops by
 *      exactly the line.
 *   2. *Odbij* leaves the money on the tab, which is the honest outcome: the
 *      guest is still charged.
 *   3. A request on a round older than `bartender_approve_window_s` shows *Ide
 *      vlasniku* and offers no *Odobri* — the server's own `can_decide`, drawn.
 *   4. A void asked for 20 s after the lock and flushed ten minutes late is
 *      still `applied, auto` — the §1.2 window, end to end over HTTP.
 *   5. The screen holds at 390 px with no horizontal scroll, in Bosnian, with no
 *      emoji, and a decision with the network off fails honestly instead of
 *      queueing.
 *
 * Run it against a **production build on port 3112**, never the owner's 3002:
 *
 *   rm -f data/verify.db*
 *   DB_PATH=data/verify.db PIN_PEPPER=dev npm run db:seed
 *   npm run build
 *   DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 \
 *     PORT=3112 node .output/server/index.mjs
 *   npx playwright test tests/e2e/wp1-storno.spec.ts
 */
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'

const ADMIN = { email: 'haris@lounge.ba', password: 'lounge' }
const PINS: Record<string, string> = { Amar: '1111', Emir: '123456' }

interface Named { id: string, name: string }

let admin: APIRequestContext
let amarCtx: BrowserContext
let emirCtx: BrowserContext
let boot: { tables: Named[], products: (Named & { price_fen: number })[], users: Named[] }

/**
 * Give a browser its own enrolled device and log `who` into it.
 *
 * `bound_user_id` makes it a personal phone, which is what both of these are —
 * and it is what makes Emir's PIN on Amar's handset a `foreign_device` rather
 * than an ordinary login.
 */
async function enrolAndLogin(context: BrowserContext, who: string): Promise<void> {
  const user = boot.users.find(u => u.name === who)!
  const code = await (await admin.post('/api/admin/enrol-codes', {
    data: { mode: 'personal', bound_user_id: user.id, label: `${who}ov telefon` },
  })).json() as { code: string }

  const enrolled = await context.request.post('/api/devices/enrol', {
    data: { code: code.code, label: `${who}ov telefon` },
  })
  expect(enrolled.ok(), await enrolled.text()).toBe(true)

  const login = await context.request.post('/api/auth/pin', {
    data: { user_id: user.id, pin: PINS[who] },
  })
  expect(login.ok(), await login.text()).toBe(true)
}

/** Lock a round through the API — this file is about what happens *after* one. */
async function lockRound(
  api: APIRequestContext, tableName: string,
): Promise<{ orderId: string, tabId: string, lineId: string, totalFen: number }> {
  const table = boot.tables.find(t => t.name === tableName)!
  const kafa = boot.products.find(p => p.name === 'Kafa')!
  const lineId = crypto.randomUUID()
  const res = await api.post('/api/orders', {
    data: {
      client_id: crypto.randomUUID(),
      table_id: table.id,
      lines: [{ id: lineId, product_id: kafa.id, qty: 1 }],
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  const order = await res.json() as
    { order_id: string, tab_id: string, order_total_fen: number }
  return {
    orderId: order.order_id, tabId: order.tab_id, lineId, totalFen: order.order_total_fen,
  }
}

/**
 * Emir taps *Gotovo* on the ticket.
 *
 * This is what makes the storno below a *request* rather than a self-void: a
 * bowl that has been lit cannot go back in the jar, so a line the bartender has
 * already made falls off the first rung of the ladder and waits for a decision
 * (PLAN F6 step 3). It is also what actually happens in the café — the waiter
 * notices the mistake when the drink arrives.
 */
async function markPrepared(orderId: string): Promise<void> {
  const res = await emirCtx.request.post(`/api/prep/${orderId}/done`, { data: {} })
  expect(res.ok(), await res.text()).toBe(true)
}

async function requestVoid(
  api: APIRequestContext, lineId: string, extra: Record<string, unknown> = {},
) {
  const res = await api.post('/api/adjustments', {
    data: {
      client_id: crypto.randomUUID(),
      order_line_id: lineId,
      kind: 'void',
      reason: 'guest_changed_mind',
      ...extra,
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return await res.json() as {
    applied: boolean
    adjustment: { id: string, status: string, auto: boolean, seconds_since_lock: number }
  }
}

/** Open Emir's queue and wait for it to have painted. */
async function openQueue(page: Page) {
  await page.goto('/s/cekanje')
  await expect(page.getByRole('heading', { name: 'Na čekanju' })).toBeVisible()
}

const stornoCard = (page: Page) => page.locator('article').filter({ hasText: 'Storno · Amar' })

test.describe.configure({ mode: 'serial' })

test.describe('WP1 — storno, gratis and the approval queue', () => {
  test.beforeAll(async ({ browser }) => {
    const adminCtx = await browser.newContext()
    admin = adminCtx.request
    const login = await admin.post('/api/auth/admin/login', { data: ADMIN })
    expect(login.ok(), await login.text()).toBe(true)

    boot = await (await admin.get('/api/bootstrap')).json()

    amarCtx = await browser.newContext()
    emirCtx = await browser.newContext()
    await enrolAndLogin(amarCtx, 'Amar')
    await enrolAndLogin(emirCtx, 'Emir')
  })

  test.afterAll(async () => {
    await amarCtx?.close()
    await emirCtx?.close()
  })

  test('the bartender sees the whole card and decides it in one tap', async () => {
    const round = await lockRound(amarCtx.request, 'Sto 6')
    await markPrepared(round.orderId)
    await requestVoid(amarCtx.request, round.lineId, { reason: 'not_served' })

    const page = await emirCtx.newPage()
    await openQueue(page)

    const card = stornoCard(page)
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card).toContainText('Sto 6')
    await expect(card).toContainText('Kafa')
    await expect(card).toContainText('Nije posluženo')
    await expect(card).toContainText('vraća na stanje')

    await card.getByRole('button', { name: 'Odobri' }).click()
    await expect(page.getByText('Ništa ne čeka odobrenje.')).toBeVisible({ timeout: 20_000 })

    // The queue is empty on the server too, and the tab lost exactly the line.
    const pending = await (await emirCtx.request.get('/api/adjustments/pending')).json() as unknown[]
    expect(pending).toHaveLength(0)

    const tab = await (await amarCtx.request.get(`/api/tabs/${round.tabId}`)).json() as
      { money: { total_fen: number } }
    expect(tab.money.total_fen).toBe(0)
    await page.close()
  })

  test('a rejection leaves the money on the tab', async () => {
    const round = await lockRound(amarCtx.request, 'Sto 7')
    await markPrepared(round.orderId)
    await requestVoid(amarCtx.request, round.lineId)

    const page = await emirCtx.newPage()
    await openQueue(page)

    const card = stornoCard(page)
    await expect(card).toBeVisible({ timeout: 20_000 })
    await card.getByRole('button', { name: 'Odbij' }).click()
    await expect(page.getByText('Ništa ne čeka odobrenje.')).toBeVisible({ timeout: 20_000 })

    const tab = await (await amarCtx.request.get(`/api/tabs/${round.tabId}`)).json() as
      { money: { total_fen: number } }
    expect(tab.money.total_fen).toBe(round.totalFen)
    await page.close()
  })

  test('past the bartender window the card says Ide vlasniku and offers no button', async () => {
    // One second of window, so a round locked a moment ago is already the
    // owner's business. Changing the published rule is how this is tested
    // without a fake clock — and it is put back at the end.
    const before = await (await admin.get('/api/admin/settings')).json() as
      { bartender_approve_window_s: number }
    const patched = await admin.patch('/api/admin/settings', {
      data: { bartender_approve_window_s: 1 },
    })
    expect(patched.ok(), await patched.text()).toBe(true)
    expect((await patched.json()).bartender_approve_window_s).toBe(1)

    const page = await emirCtx.newPage()
    try {
      const round = await lockRound(amarCtx.request, 'Sto 8')
      await markPrepared(round.orderId)
      await new Promise(resolve => setTimeout(resolve, 2500))
      await requestVoid(amarCtx.request, round.lineId)

      await openQueue(page)
      const card = stornoCard(page)
      await expect(card).toBeVisible({ timeout: 20_000 })
      await expect(card).toContainText('Ide vlasniku')
      await expect(card.getByRole('button', { name: 'Odobri' })).toHaveCount(0)
      await expect(page.getByText('Čeka vlasnika')).toBeVisible()
    } finally {
      await admin.patch('/api/admin/settings', {
        data: { bartender_approve_window_s: before.bartender_approve_window_s },
      })
      // Clear it from the owner's side, so the next test's queue is its own.
      const left = await (await admin.get('/api/adjustments/pending')).json() as { id: string }[]
      for (const row of left) {
        await admin.post(`/api/adjustments/${row.id}/decide`, { data: { outcome: 'rejected' } })
      }
      await page.close()
    }
  })

  test('a void asked for 20 s after the lock is applied even when it lands ten minutes late', async () => {
    const table = boot.tables.find(t => t.name === 'Sto 9')!
    const kafa = boot.products.find(p => p.name === 'Kafa')!

    // The round happened ten minutes ago in the world; the storno twenty
    // seconds after it. Both bodies carry their own `client_created_at`, which
    // is exactly what a flush out of a dead spot looks like.
    const lineId = crypto.randomUUID()
    const locked = await amarCtx.request.post('/api/orders', {
      data: {
        client_id: crypto.randomUUID(),
        table_id: table.id,
        client_created_at: new Date(Date.now() - 600_000).toISOString(),
        lines: [{ id: lineId, product_id: kafa.id, qty: 1 }],
      },
    })
    expect(locked.ok(), await locked.text()).toBe(true)

    const asked = await requestVoid(amarCtx.request, lineId, {
      reason: 'wrong_entry',
      client_created_at: new Date(Date.now() - 580_000).toISOString(),
    })

    // `orders.created_at` is server-now, so the *claim* is what saves it: 20 s.
    expect(asked.adjustment.seconds_since_lock).toBeLessThanOrEqual(30)
    expect(asked.applied).toBe(true)
    expect(asked.adjustment.auto).toBe(true)
  })

  test('the queue holds at 390 px, in Bosnian, and a decision offline fails honestly', async () => {
    const round = await lockRound(amarCtx.request, 'Sto 10')
    await markPrepared(round.orderId)
    await requestVoid(amarCtx.request, round.lineId, {
      reason: 'other', note: 'gost je otisao ranije',
    })

    const page = await emirCtx.newPage()
    await openQueue(page)
    await expect(stornoCard(page)).toBeVisible({ timeout: 20_000 })

    // No horizontal scroll: every amount and every chip fits the phone.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    // Bosnian, and no emoji anywhere on the rendered screen.
    const text = await page.locator('body').innerText()
    expect(text).toMatch(/Na čekanju/)
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u)

    // A decision is not queueable: the bartender's authority is a window
    // measured now, so with no network the screen says so and nothing moves.
    await emirCtx.setOffline(true)
    await stornoCard(page).getByRole('button', { name: 'Odobri' }).click()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 })
    await emirCtx.setOffline(false)

    const stillPending = await (await amarCtx.request.get('/api/adjustments/pending'))
      .json() as { id: string }[]
    expect(stillPending.length).toBeGreaterThanOrEqual(1)
    await page.close()
  })
})
