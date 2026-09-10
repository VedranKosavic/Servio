/**
 * WP1's done-when, walked on a 390 px phone (docs/PHASE3.md §3 and §5.2 check 2).
 *
 * **Its tables are the bašta ones, 18 upward**, and that is not cosmetic: the
 * five spec files run in one command against one database (§5.1), so a table
 * another file leaves open would change what this one finds on it. Nothing here
 * taps the floor plan — every screen is reached by id — so the zone costs
 * nothing.
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
 *   6. **From Amar's own phone**, not his `request`: a locked line opens the
 *      sheet, *Zatraži storno* asks for a reason, the reason says what it does
 *      to the shelf, and Emir's PIN typed on Amar's handset strikes the line.
 *   7. And the other half of *Na račun kuće*: the long press on a tile offers it,
 *      the counter reads the published rule, and a drink over the cap is refused
 *      in Bosnian rather than silently locked at zero.
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
import { ackRules, resetLimits } from './helpers'

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

  // A published Pravila version stands in front of every /k screen (S12), and
  // phase4-pravila publishes one before this file runs. Clear it here so the
  // spec does not depend on where it sits in the alphabet.
  await ackRules(context.request)
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

/** Amar's phone, on the floor plan, as a waiter actually holds it. */
async function amarsPhone(): Promise<Page> {
  const page = await amarCtx.newPage()
  await page.goto('/k')
  await expect(page.getByText('Stolovi')).toBeVisible({ timeout: 20_000 })
  return page
}

/** A long press, the only gesture in the app that is not a tap. */
async function longPress(page: Page, target: ReturnType<Page['getByRole']>) {
  const box = (await target.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(600)
  await page.mouse.up()
}

/** The tile for a product, by the name printed on it. */
function tile(page: Page, name: string) {
  return page.getByRole('button')
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ hasText: 'KM' })
    .first()
}

test.describe.configure({ mode: 'serial' })

test.describe('WP1 — storno, gratis and the approval queue', () => {
  test.beforeAll(async ({ browser }) => {
    const adminCtx = await browser.newContext()
    admin = adminCtx.request
    await resetLimits(admin)
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
    const round = await lockRound(amarCtx.request, 'Sto 18')
    await markPrepared(round.orderId)
    await requestVoid(amarCtx.request, round.lineId, { reason: 'not_served' })

    const page = await emirCtx.newPage()
    await openQueue(page)

    const card = stornoCard(page)
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card).toContainText('Sto 18')
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
    const round = await lockRound(amarCtx.request, 'Sto 19')
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
      const round = await lockRound(amarCtx.request, 'Sto 20')
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
    const table = boot.tables.find(t => t.name === 'Sto 21')!
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
    const round = await lockRound(amarCtx.request, 'Sto 22')
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

  /**
   * §5.2 check 2, walked on the **requester's** phone rather than through his
   * `request`. Everything above proves the bartender's half; this proves there
   * is a button at all — the two sheets shipped disabled once, and no test
   * noticed because every storno in this file was a POST.
   */
  test('Zatraži storno on Amar’s phone: a reason, the shelf, and Emir’s PIN', async () => {
    // One second of self-void window, so this is a *request* and the PIN sheet
    // is the path — not a line that strikes itself before Emir is offered.
    const before = await (await admin.get('/api/admin/settings')).json() as
      { void_self_window_s: number }
    expect((await admin.patch('/api/admin/settings', {
      data: { void_self_window_s: 1 },
    })).ok()).toBe(true)

    const page = await amarsPhone()
    try {
      const table = boot.tables.find(t => t.name === 'Sto 23')!
      const round = await lockRound(amarCtx.request, 'Sto 23')
      await new Promise(resolve => setTimeout(resolve, 1500))

      await page.goto(`/k/sto/${table.id}`)
      // The rounds are collapsed to their headers; open the one we just locked.
      await page.getByRole('button', { name: /^Tura 1/ }).click()
      await page.getByRole('button', { name: /Kafa/ }).first().click()

      await expect(page.getByText('Zaključene stavke se ne mijenjaju')).toBeVisible()
      await page.getByRole('button', { name: 'Zatraži storno' }).click()

      // The reason, and what it does to the shelf — before anything is sent.
      await expect(page.getByRole('dialog', { name: 'Zatraži storno' })).toBeVisible()
      await page.getByRole('button', { name: 'Gost se predomislio', exact: true }).click()
      const shelf = page.locator('p').filter({ hasText: 'Vraća robu na stanje:' })
      await expect(shelf).toBeVisible()
      await expect(shelf).toContainText('da')
      await expect(page.getByText(/ostaje u tvom pazaru/)).toBeVisible()

      // And the PIN, typed by the šanker on the requester's own handset.
      await page.getByRole('button', { name: 'Zatraži storno' }).click()
      await expect(page.getByRole('heading', { name: 'Odobri PIN-om' })).toBeVisible()
      await page.getByRole('button', { name: /Emir/ }).first().click()
      for (const digit of PINS.Emir!) {
        await page.getByRole('button', { name: digit, exact: true }).click()
      }

      await expect.poll(async () => {
        const tab = await (await amarCtx.request.get(`/api/tabs/${round.tabId}`)).json() as
          { money: { total_fen: number } }
        return tab.money.total_fen
      }, { timeout: 20_000 }).toBe(0)

      // Scoped to this line: an earlier test in this file deliberately leaves a
      // storno waiting, and asserting an empty queue would be asserting that.
      const pending = await (await admin.get('/api/adjustments/pending')).json() as
        { order_line_id: string }[]
      expect(pending.filter(row => row.order_line_id === round.lineId)).toHaveLength(0)
    } finally {
      await admin.patch('/api/admin/settings', {
        data: { void_self_window_s: before.void_self_window_s },
      })
      await page.close()
    }
  })

  /**
   * §5.2 check 3: *Na račun kuće* exists, and the published rule is on screen
   * before it refuses rather than only inside the refusal (PLAN F7).
   *
   * `formatKm` joins an amount to KM with a non-breaking space, which is why
   * every money regex below matches `[\s\u00a0]` and not a plain space.
   */
  test('Na račun kuće on a draft line: the counter, then the refusal', async () => {
    const page = await amarsPhone()
    try {
      const table = boot.tables.find(t => t.name === 'Sto 24')!

      /** Long-press a tile and open the comp sheet on it. */
      async function openComp(product: string) {
        await page.goto(`/k/dodaj/${table.id}`)
        await expect(page.getByText('Dodir = +1 · dugi dodir = napomena')).toBeVisible()
        await longPress(page, tile(page, product))
        await expect(page.getByRole('dialog', { name: 'Napomena' })).toBeVisible()
        await page.getByRole('button', { name: 'Na račun kuće' }).click()
        await expect(page.getByRole('dialog', { name: 'Na račun kuće' })).toBeVisible()
      }

      /** *Osoblje* → *Kuća časti* → lock the round it is on. */
      async function giveItAway() {
        await page.getByRole('button', { name: 'Osoblje', exact: true }).click()
        await expect(page.getByText(/U okviru dozvole/)).toBeVisible()
        await page.getByRole('button', { name: 'Kuća časti' }).click()
        await page.getByRole('button', { name: 'Pregled' }).click()
        await expect(page.getByRole('dialog', { name: 'Zaključi turu' })).toBeVisible()
        await page.getByRole('button', { name: 'Potvrdi' }).click()
        await expect(page.getByRole('button', { name: /^Naplati/ })).toBeVisible({ timeout: 20_000 })
      }

      // Nothing has been given away yet: the rule, with tonight's score in it.
      await openComp('Kafa')
      await expect(page.getByText(/Osoblje: 0\/2 \(do 3,00[\s\u00a0]KM\)/)).toBeVisible()
      await giveItAway()

      // …and now the score has moved. The second one is still inside the rule.
      await openComp('Kafa')
      await expect(page.getByText(/Osoblje: 1\/2 \(do 3,00[\s\u00a0]KM\)/))
        .toBeVisible({ timeout: 20_000 })
      await giveItAway()

      // The third is not refused — it is *explained*, and it goes to somebody
      // who can say yes. Nothing on this screen ever says no on its own.
      await openComp('Kafa')
      await expect(page.getByText(/Osoblje: 2\/2 \(do 3,00[\s\u00a0]KM\)/))
        .toBeVisible({ timeout: 20_000 })
      await page.getByRole('button', { name: 'Osoblje', exact: true }).click()
      await expect(page.getByText(/Iskoristio si 2 od 2 za ovu smjenu — ide na odobrenje/))
        .toBeVisible()
      await expect(page.getByText(/ostaje u tvom pazaru/)).toBeVisible()

      // And a drink that was never on the staff list says so in its own words.
      await openComp('Nargila')
      await page.getByRole('button', { name: 'Osoblje', exact: true }).click()
      await expect(page.getByText(/Ovo piće nije na listi za osoblje — ide na odobrenje/))
        .toBeVisible()
    } finally {
      await page.close()
    }
  })
})
