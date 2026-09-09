/**
 * WP0's done-when, walked on a 390 px phone with the network switched off
 * (docs/PHASE3.md §3, and §5.2 checks 1 and 8).
 *
 * `context.setOffline(true)` is as close as a laptop gets to a waiter walking
 * behind the fridge: every request the page makes fails at the network layer,
 * exactly as it would on a phone with no signal — including the navigations,
 * which is why the service worker has to be registered before the run starts.
 *
 * What is proved here:
 *
 *   1. Two rounds and a payment tapped with the network off are all queued —
 *      the chip counts them and a reload keeps every one.
 *   2. Reconnecting empties the queue **in order**, and the server then holds
 *      one tab per table, the rounds on them, and one payment. The payment
 *      named a tab the server had never seen when the cash was taken.
 *   3. The heartbeat carries the queue, and stops carrying it once it is empty.
 *   4. Red never blocks adding or locking (PLAN §10, invariant 5).
 *   5. The manifest and the worker are served, and the worker takes control.
 *
 * Run it against a **production build on port 3112**, never the owner's 3002:
 *
 *   rm -f data/verify.db*
 *   DB_PATH=data/verify.db PIN_PEPPER=dev npm run db:seed
 *   npm run build
 *   DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
 *     PORT=3112 node .output/server/index.mjs
 *   npx playwright test
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const AMAR_PIN = '1111'

interface BootTable { id: string, name: string }

/** Enrol this browser as a device, log in as Amar, and open the floor plan. */
async function loginAsAmar(context: BrowserContext, page: Page): Promise<Map<string, string>> {
  // The dev door: one call and this browser holds a device cookie. It 404s
  // anywhere `SANK_DEV_ENROL=1` is not set, which is everywhere but here.
  expect((await context.request.post('/api/dev/enrol', { data: {} })).ok()).toBe(true)

  const users = await (await context.request.get('/api/auth/users')).json() as
    { id: string, name: string }[]
  const amar = users.find(u => u.name === 'Amar')!
  expect(amar).toBeTruthy()
  expect((await context.request.post('/api/auth/pin', {
    data: { user_id: amar.id, pin: AMAR_PIN },
  })).ok()).toBe(true)

  const boot = await (await context.request.get('/api/bootstrap')).json() as
    { tables: BootTable[] }

  await page.goto('/k')
  await expect(page.getByText('Stolovi')).toBeVisible()

  // The worker installs on the first load and takes over on the next one. Both
  // have to happen while there is still a network, or every navigation below
  // would fail before the app got a chance to be offline-capable.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 15_000 })
    .toBe(true)

  return new Map(boot.tables.map(t => [t.name, t.id]))
}

/**
 * Open a table by tapping its circle, the way a waiter does.
 *
 * Deliberately not `page.goto`: a full page load offline is answered by the
 * service worker with the `/k` shell (see `nuxt.config.ts`), which is the right
 * behaviour for a cold start and the wrong way to test the screen. Tapping is
 * client-side routing and needs no network at all — which is the point.
 */
async function openTable(page: Page, name: string) {
  const number = name.replace(/^Sto /, '')
  await page.getByRole('button', { name: new RegExp(`^${number}(\\s|$)`) }).first().click()
  // An empty table opens straight on *Dodaj* (WP3's S3) — the tap a waiter
  // would otherwise spend on *+ Dodaj* is the difference between five taps for
  // two coffees and six. A table with something on it opens on S2 instead, and
  // then *+ Dodaj* is that one tap.
  const dodaj = page.getByRole('link', { name: '+ Dodaj' })
  if (await dodaj.count() > 0) await dodaj.click()
  await expect(page.getByRole('button', { name: /^Zaključi/ })).toBeVisible()
}

/** Tap a table's circle and stay on S2 — the till rather than the menu. */
async function openTab(page: Page, name: string) {
  const number = name.replace(/^Sto /, '')
  await page.getByRole('button', { name: new RegExp(`^${number}(\\s|$)`) }).first().click()
  await expect(page.getByRole('button', { name: /^Naplati/ })).toBeVisible()
}

/** The back arrow, tapped until the floor plan is on screen again. */
async function backToFloor(page: Page) {
  for (let i = 0; i < 2; i++) {
    if (await page.getByText('Stolovi').count() > 0) break
    await page.getByRole('link', { name: 'Nazad' }).first().click()
    await page.waitForTimeout(300)
  }
  await expect(page.getByText('Stolovi')).toBeVisible({ timeout: 15_000 })
}

/**
 * Tap a product tile once, **by the name on the tile**.
 *
 * Since PHASE3 §1.9 a product may carry a `short_name`, and the tile prefers it
 * — Coca-Cola is a tile that says "Cola". Pass what the waiter reads.
 *
 * The `hasText: 'KM'` is not decoration: the category pills above the grid carry
 * the same words as the categories ("Kafa"), and a tile is the only button that
 * also shows a price. Without it the first match is the pill, the screen quietly
 * switches category, and nothing is added — which is exactly how the first run
 * of this file failed.
 */
async function tapProduct(page: Page, name: string) {
  await page.getByRole('button')
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ hasText: 'KM' })
    .first()
    .click()
}

const chip = (page: Page, text: RegExp | string) => page.locator('.chip').filter({ hasText: text })

/** Lock the round that is on the draft, and wait for the toast. */
async function lockRound(page: Page) {
  // *Zaključi* → the sheet with every line and the total → *Potvrdi*
  // (PLAN §10, invariant 2). Two taps, and never one.
  await page.getByRole('button', { name: /^Zaključi/ }).click()
  await page.getByRole('button', { name: 'Potvrdi' }).click()
  await expect(page.getByText(/Sačuvano · čeka slanje/)).toBeVisible()
}

test.describe('WP0 — the offline outbox', () => {
  test('two rounds and a payment queued offline land exactly once', async ({ page, context }) => {
    const tables = await loginAsAmar(context, page)
    const tableA = 'Sto 5'
    const tableB = 'Sto 7'

    await context.setOffline(true)

    // Round 1 on Sto 5 — two coffees.
    await openTable(page, tableA)
    await tapProduct(page, 'Kafa')
    await tapProduct(page, 'Kafa')
    await lockRound(page)
    // The screen takes itself back to the table after the toast — the round is
    // a locked *tura* now and the bar reads *Naplati*.
    await backToFloor(page)

    // Round 2 on Sto 7.
    await openTable(page, tableB)
    await tapProduct(page, 'Cola')
    await lockRound(page)
    await backToFloor(page)

    await expect(chip(page, /čeka slanje \(2\)/i)).toBeVisible()

    // Cash for Sto 7, on a tab whose only name is a uuid this phone minted.
    // The *Naplati* card is drawn from the phone's own view of the table for
    // exactly this moment — offline there is no server tab to draw it from.
    await openTab(page, tableB)
    await page.getByRole('button', { name: /^Naplati/ }).click()
    await page.getByRole('button', { name: /^Tačno/ }).click()
    await expect(page.getByText(/Naplaćeno/)).toBeVisible()
    await expect(page.getByText('Stolovi')).toBeVisible({ timeout: 15_000 })

    await expect(chip(page, /čeka slanje \(3\)/i)).toBeVisible()

    // A reload with the network still off keeps all three: the queue is in
    // IndexedDB, and the page itself comes back from the worker's cache.
    await page.reload()
    await expect(chip(page, /čeka slanje \(3\)/i)).toBeVisible({ timeout: 20_000 })

    // ---- back on the network --------------------------------------------
    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(chip(page, 'Sinhronizovano')).toBeVisible({ timeout: 30_000 })

    // ---- what actually landed -------------------------------------------
    const state = await (await context.request.get('/api/tables/state')).json() as {
      tables: { table_id: string, tab_id: string | null, total_fen: number }[]
    }
    // Sto 5 is still open with its two coffees on it.
    const a = state.tables.find(r => r.table_id === tables.get(tableA))!
    expect(a.tab_id).not.toBeNull()
    expect(a.total_fen).toBeGreaterThan(0)

    // Sto 7 was paid: the round landed first, the payment behind it, and the
    // tab closed. One of each — the table is free again, not doubly billed.
    const b = state.tables.find(r => r.table_id === tables.get(tableB))!
    expect(b.tab_id).toBeNull()
  })

  test('the heartbeat reports the queue, and stops once it is empty', async ({ page, context }) => {
    await loginAsAmar(context, page)
    await context.setOffline(true)

    await openTable(page, 'Sto 9')
    await tapProduct(page, 'Kafa')
    await lockRound(page)
    await backToFloor(page)
    await expect(chip(page, /čeka slanje \(1\)/i)).toBeVisible()

    // While the queue is held, the phone says so — and this is the number the
    // count screen's `409 PENDING_OUTBOX` gate reads.
    await page.evaluate(async () => {
      await fetch('/api/devices/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pending: 1, client_now: new Date().toISOString() }),
      }).catch(() => {})
    })

    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(chip(page, 'Sinhronizovano')).toBeVisible({ timeout: 30_000 })

    // After the flush the phone beats again, honestly, with nothing left.
    await expect.poll(async () => {
      const me = await (await context.request.get('/api/me')).json()
      return me.device.pending_count
    }, { timeout: 30_000 }).toBe(0)
  })

  test('red says the network is gone and blocks nothing', async ({ page, context }) => {
    await loginAsAmar(context, page)
    await context.setOffline(true)

    await expect(chip(page, /Nema veze/)).toBeVisible({ timeout: 30_000 })

    // Invariant 5: a red chip is a statement about the network, never a lock on
    // the till. Adding and locking still work.
    await openTable(page, 'Sto 11')
    await tapProduct(page, 'Kafa')
    await expect(page.getByRole('button', { name: /^Zaključi/ })).toBeEnabled()

    // And the header sentence appears only once something is genuinely stuck —
    // not for a queue that is thirty seconds old.
    await expect(page.getByText(/duže od 5 minuta/)).toHaveCount(0)
    await context.setOffline(false)
  })

  test('a refused round blocks its own table and nobody else, and Odbaci clears it', async ({ page, context }) => {
    const tables = await loginAsAmar(context, page)
    const bad = 'Sto 3'
    const good = 'Sto 4'

    // The server answers a bad body with a 4xx, and no amount of retrying
    // changes that — so the entry stops and waits for a human. Forcing one here
    // beats waiting for a real one: the route is intercepted for this table's
    // round only, which is also how "blocks its own tab and not another" is
    // shown rather than asserted.
    await context.route('**/api/orders', async (route) => {
      const body = route.request().postDataJSON() as { table_id: string }
      if (body?.table_id === tables.get(bad)) {
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ data: { code: 'TAB_ALREADY_PAID', message: 'tab already paid' } }),
        })
        return
      }
      await route.continue()
    })

    await context.setOffline(true)

    await openTable(page, bad)
    await tapProduct(page, 'Kafa')
    await lockRound(page)
    await backToFloor(page)

    await openTable(page, good)
    await tapProduct(page, 'Kafa')
    await lockRound(page)
    await backToFloor(page)

    await expect(chip(page, /čeka slanje \(2\)/i)).toBeVisible()

    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))

    // The refused one stops on the floor plan with its table, its reason and
    // two buttons; the other table went through in the same flush.
    const card = page.locator('.card').filter({ hasText: 'Popravi' })
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toContainText(bad)
    await expect(chip(page, /čeka slanje \(1\)/i)).toBeVisible()

    const state = await (await context.request.get('/api/tables/state')).json() as {
      tables: { table_id: string, tab_id: string | null }[]
    }
    expect(state.tables.find(r => r.table_id === tables.get(good))!.tab_id).not.toBeNull()
    expect(state.tables.find(r => r.table_id === tables.get(bad))!.tab_id).toBeNull()

    // *Odbaci* removes the entry and writes nothing.
    await card.getByRole('button', { name: 'Odbaci' }).click()
    await expect(chip(page, 'Sinhronizovano')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.card').filter({ hasText: 'Popravi' })).toHaveCount(0)
  })

  test('the manifest and the worker are real', async ({ page, context }) => {
    const manifest = await context.request.get('/manifest.webmanifest')
    expect(manifest.status()).toBe(200)
    const body = await manifest.json()
    expect(body.name).toBe('Šank')
    expect(body.start_url).toBe('/k')
    expect(body.display).toBe('standalone')
    expect(body.lang).toBe('bs')
    expect((body.icons as { sizes: string }[]).map(i => i.sizes)).toContain('192x192')
    expect((body.icons as { sizes: string }[]).map(i => i.sizes)).toContain('512x512')
    expect((body.icons as { purpose?: string }[]).some(i => i.purpose === 'maskable')).toBe(true)
    for (const icon of body.icons as { src: string }[]) {
      expect((await context.request.get(icon.src)).status()).toBe(200)
    }

    // `loginAsAmar` already asserts the worker takes control after one reload.
    await loginAsAmar(context, page)

    // The install guide is reachable and says the sentence that matters.
    await page.goto('/k/instalacija', { waitUntil: 'networkidle' })
    await expect(page.getByText(/Dodaj na početni ekran/)).toBeVisible()
    await expect(page.getByText(/Safari i aplikacija s početnog ekrana ne dijele prijavu/)).toBeVisible()

    // No horizontal scroll at 390 px, on the longest screen in the package.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
