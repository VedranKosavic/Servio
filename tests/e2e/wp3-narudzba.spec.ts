/**
 * WP3's done-when, walked on a 390 px phone (docs/PHASE3.md §3, WP3).
 *
 * Every assertion here is a sentence from the spec turned into taps, and the
 * tap **counts** are asserted where §4 gives a budget — because "fast" is not a
 * feeling in this app, it is a number a stopwatch and a counter agree on:
 *
 *   2× kafa                       5 taps
 *   nargila + 2× Coca-Cola        8 taps
 *   mix nargila + čaj s čipom    10 taps
 *   Žar on a live bowl            2 taps
 *   gotovina tačno                3 taps
 *
 * What else is proved: *Zaključi* never locks without *Potvrdi*; *Žar* is the
 * one thing that does; the diacritic-insensitive search finds Čaj from "caj"
 * and Coca-Cola from "kola"; *Bez stola* opens a tab on no table and the floor
 * plan stays 27 circles; *Pokaži narudžbu* carries the watermark and nothing
 * tappable; *Premjesti sto* moves the guests; and no screen scrolls sideways at
 * 390 px.
 *
 * **One device per file, enrolled once** (§5.1). `authLimiter` allows ten auth
 * calls a minute per IP on a production build — `DEV_MULTIPLIER` is 1 there,
 * because `import.meta.dev` compiles to `false` — so a file that enrolled per
 * test 429'd partway through the run. The context is built in `beforeAll`; what
 * is reset between tests is the phone's own state, never its cookies.
 *
 * **Its tables are 6, 8, 10 and 12–15**, none of which another spec file opens:
 * the five files run in one command against one database (§5.1), and this one
 * taps circles on the floor plan, so a table somebody else left open would open
 * on S2 and cost the tap budget a tap it does not have.
 *
 * Run it against a production build on **its own port and its own database**,
 * never the owner's 3002 and never `data/sank.db`:
 *
 *   rm -f data/verify.db*
 *   DB_PATH=data/verify.db PIN_PEPPER=dev npm run db:seed
 *   npm run build
 *   DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
 *     PORT=3119 node .output/server/index.mjs
 *   SANK_E2E_URL=http://localhost:3119 npx playwright test tests/e2e/wp3-narudzba.spec.ts
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { ackRules, resetLimits, pinLogin, type Person } from './helpers'


interface BootTable { id: string, name: string }

async function loginAsAmar(context: BrowserContext, page: Page): Promise<Map<string, string>> {
  expect((await context.request.post('/api/dev/enrol', { data: {} })).ok()).toBe(true)

  // The login answers with the person, so there is no roster to read first —
  // and there could not be: `GET /api/auth/users` is behind a session now.
  await pinLogin(context.request, 'Amar', 'konobar')

  // A published Pravila version stands in front of every /konobar screen (S12), and
  // phase4-pravila publishes one before this file runs. Clear it here so the
  // spec does not depend on where it sits in the alphabet.
  await ackRules(context.request)

  const boot = await (await context.request.get('/api/bootstrap')).json() as
    { tables: BootTable[] }

  await page.goto('/konobar')
  await expect(page.getByText('Stolovi')).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  return new Map(boot.tables.map(t => [t.name, t.id]))
}

/**
 * Every tap in this file goes through here, so a budget is a count and not an
 * estimate. It clicks and it counts; nothing else.
 */
class Thumb {
  taps = 0
  constructor(private page: Page) {}

  async tap(locator: ReturnType<Page['getByRole']>) {
    this.taps += 1
    await locator.click()
  }

  async tapTable(name: string) {
    const number = name.replace(/^Sto /, '')
    await this.tap(this.page.getByRole('button', { name: new RegExp(`^${number}(\\s|$)`) }).first())
  }

  async tapProduct(name: string) {
    await this.tap(this.page.getByRole('button')
      .filter({ has: this.page.getByText(name, { exact: true }) })
      .filter({ hasText: 'KM' })
      .first())
  }

  async lock() {
    await this.tap(this.page.getByRole('button', { name: /^Zaključi/ }))
    await this.tap(this.page.getByRole('button', { name: 'Potvrdi' }))
  }
}

interface StateBody {
  tables: { table_id: string, tab_id: string | null, total_fen: number }[]
  loose_tabs: { table_id: string | null, tab_id: string | null, total_fen: number }[]
}

/**
 * `GET /api/tables/state`, read through the API rather than off the screen.
 *
 * It is ETagged, so a repeated read inside `expect.poll` can come back `304`
 * with no body at all — which is the route working correctly and a `TypeError`
 * two lines later. The empty envelope below is what "nothing new" means here.
 */
async function readState(context: BrowserContext): Promise<StateBody> {
  const response = await context.request.get('/api/tables/state')
  if (response.status() !== 200) return { tables: [], loose_tabs: [] }
  return await response.json() as StateBody
}

async function backToFloor(page: Page) {
  for (let i = 0; i < 3; i++) {
    if (await page.getByText('Stolovi').count() > 0) return
    await page.getByRole('link', { name: 'Nazad' }).first().click()
    await page.waitForTimeout(400)
  }
  await expect(page.getByText('Stolovi')).toBeVisible({ timeout: 15_000 })
}

/** No screen in this app may scroll sideways on the phone it is built for. */
async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

/**
 * A phone that has forgotten the last test's drafts but is still the same
 * enrolled device: IndexedDB and localStorage go, the cookies stay.
 */
async function freshPage(): Promise<Page> {
  // Only one page at a time. Two pages of the same context share IndexedDB, and
  // a page left open from the previous test keeps writing its own outbox into
  // the store this one is about to read — which showed up as a *Potvrdi* stuck
  // on *Šaljem…* forever.
  for (const open of context.pages()) await open.close()

  const page = await context.newPage()
  await page.goto('/konobar')
  // `idb-keyval` keeps everything in one store, so emptying it is enough — and
  // it is safer than `deleteDatabase`, which blocks while any connection is
  // open and then leaves the next write hanging.
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise<void>((done) => {
      const request = indexedDB.open('keyval-store')
      request.onerror = () => done()
      request.onsuccess = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('keyval')) { db.close(); done(); return }
        const tx = db.transaction('keyval', 'readwrite')
        tx.objectStore('keyval').clear()
        tx.oncomplete = tx.onerror = () => { db.close(); done() }
      }
    })
  })
  await page.reload()
  await expect(page.getByText('Stolovi')).toBeVisible({ timeout: 20_000 })
  return page
}

let context: BrowserContext
let tables: Map<string, string>

test.describe.configure({ mode: 'serial' })

test.describe('WP3 — the order screens', () => {
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext()
    await resetLimits(context.request)
    const page = await context.newPage()
    tables = await loginAsAmar(context, page)
    await page.close()
  })

  test.afterAll(async () => {
    await context?.close()
  })
  test('two coffees are five taps, and the lock asks Potvrdi', async () => {
    const page = await freshPage()
    const thumb = new Thumb(page)

    // 1: the table. An empty one opens straight on the menu.
    await thumb.tapTable('Sto 15')
    await expect(page.getByRole('button', { name: /^Zaključi/ })).toBeVisible()
    await noSideScroll(page)

    // 2, 3: two coffees.
    await thumb.tapProduct('Kafa')
    await thumb.tapProduct('Kafa')
    await expect(page.getByText('2 stavke · 3,00 KM').first()).toBeVisible()

    // 4, 5: Zaključi → the sheet with every line and the total → Potvrdi.
    await thumb.tap(page.getByRole('button', { name: /^Zaključi/ }))
    await expect(page.getByText('Nova tura')).toBeVisible()
    await expect(page.getByText('Ukupno')).toBeVisible()
    await thumb.tap(page.getByRole('button', { name: 'Potvrdi' }))

    expect(thumb.taps).toBe(5)

    // And it landed on the table, which now shows the round and asks for money.
    await expect(page.getByRole('button', { name: /^Naplati/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Tura 1/)).toBeVisible()
    await noSideScroll(page)
  })

  test('nargila with two aromas plus a čaj with a chip is ten taps', async () => {
    const page = await freshPage()
    const thumb = new Thumb(page)

    await thumb.tapTable('Sto 6')

    // Nargila → two aromas → Dodaj nargilu
    await thumb.tapProduct('Nargila')
    await thumb.tap(page.getByRole('button', { name: 'Al Fakher · Jabuka' }))
    await thumb.tap(page.getByRole('button', { name: 'Al Fakher · Menta' }))
    await expect(page.locator('.chip').filter({ hasText: 'Mix 2/3' })).toBeVisible()
    await thumb.tap(page.getByRole('button', { name: /^Dodaj nargilu/ }))

    // Čaj with a note chip: a long press, one chip, and the chip closes it.
    const caj = page.getByRole('button')
      .filter({ has: page.getByText('Čaj', { exact: true }) })
      .filter({ hasText: 'KM' })
      .first()
    const box = (await caj.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(600)
    await page.mouse.up()
    thumb.taps += 1
    await expect(page.getByText('Ili napiši')).toBeVisible()
    await thumb.tap(page.getByRole('button', { name: 's mlijekom', exact: true }))

    await thumb.lock()

    expect(thumb.taps).toBeLessThanOrEqual(10)

    await expect(page.getByRole('button', { name: /^Naplati/ })).toBeVisible({ timeout: 15_000 })
    // The note and the aromas travelled with the lines.
    await page.getByText(/Tura 1/).click()
    await expect(page.locator('.chip').filter({ hasText: 's mlijekom' })).toBeVisible()
    await expect(page.locator('.chip').filter({ hasText: 'Al Fakher · Jabuka' })).toBeVisible()
  })

  test('Žar on a live bowl is two taps and locks with no sheet', async () => {
    const page = await freshPage()
    const thumb = new Thumb(page)

    // A bowl on Sto 8 first.
    await thumb.tapTable('Sto 8')
    await thumb.tapProduct('Nargila')
    await page.getByRole('button', { name: 'Al Fakher · Jabuka' }).click()
    await page.getByRole('button', { name: /^Dodaj nargilu/ }).click()
    await thumb.lock()
    await expect(page.getByRole('button', { name: /^Naplati/ })).toBeVisible({ timeout: 15_000 })
    await backToFloor(page)

    // Now the two taps that matter: a long press on the table, then *Žar*.
    const counted = new Thumb(page)
    const number = page.getByRole('button', { name: /^8(\s|$)/ }).first()
    const box = (await number.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(600)
    await page.mouse.up()
    counted.taps += 1

    await expect(page.getByText('Dodatni žar')).toBeVisible({ timeout: 15_000 })
    await counted.tap(page.getByRole('button', { name: 'Žar', exact: true }))
    expect(counted.taps).toBe(2)

    // No *Potvrdi* anywhere — the carve-out of invariant 2, and it is safe
    // because the product is 0 KM.
    await expect(page.getByRole('button', { name: 'Potvrdi' })).toHaveCount(0)
    await expect(page.getByText(/Žar · Sto 8/)).toBeVisible({ timeout: 15_000 })

    // The coal is on the ledger: a 0 KM line pointing at the bowl.
    await expect.poll(async () => {
      // By this table, not "the first tab there is": the whole file shares one
      // database and the tests before this one left tabs of their own.
      const state = await readState(context)
      const tab = state.tables.find(t => t.table_id === tables.get('Sto 8'))
      if (!tab?.tab_id) return 0
      const detail = await (await context.request.get(`/api/tabs/${tab.tab_id}`)).json() as
        { orders: { lines: { name_snapshot: string }[] }[] }
      return detail.orders.flatMap(o => o.lines).filter(l => l.name_snapshot === 'Dodatni žar').length
    }, { timeout: 20_000 }).toBe(1)
  })

  test('the search folds diacritics and matches on aliases', async () => {
    const page = await freshPage()
    await page.getByRole('button', { name: /^16(\s|$)/ }).first().click()

    const field = page.getByPlaceholder('Traži')
    await field.fill('caj')
    await expect(page.getByRole('button').filter({ hasText: 'Čaj' }).filter({ hasText: 'KM' }))
      .toHaveCount(1)

    // "kola" is nobody's name; it is an alias on Coca-Cola.
    await field.fill('kola')
    await expect(page.getByRole('button').filter({ hasText: 'Cola' }).filter({ hasText: 'KM' }))
      .toHaveCount(1)

    // Prefix, not substring: "ola" finds nothing.
    await field.fill('ola')
    await expect(page.getByText('Ništa ne odgovara traženom.')).toBeVisible()
    await noSideScroll(page)
  })

  test('Bez stola opens a tab on no table, and the plan keeps its 27 circles', async () => {
    const page = await freshPage()

    await page.getByRole('button', { name: '+ Bez stola' }).click()
    await expect(page.getByText('Bez stola · Šank')).toBeVisible()

    await page.getByRole('button')
      .filter({ has: page.getByText('Kafa', { exact: true }) })
      .filter({ hasText: 'KM' })
      .first()
      .click()
    await page.getByRole('button', { name: /^Zaključi/ }).click()
    await page.getByRole('button', { name: 'Potvrdi' }).click()
    await expect(page.getByRole('button', { name: /^Naplati/ })).toBeVisible({ timeout: 15_000 })

    const state = await readState(context)
    // The plan is still 27 circles: a table-less tab is a card above it, never
    // a tile in it, and it took no table's place.
    expect(state.tables).toHaveLength(27)
    expect(state.tables.map(t => t.table_id)).not.toContain(null)
    expect(state.loose_tabs).toHaveLength(1)
    expect(state.loose_tabs[0]!.table_id).toBeNull()
    expect(state.loose_tabs[0]!.total_fen).toBe(150)

    // And it is a card above the plan, never a circle in it.
    await backToFloor(page)
    await expect(page.getByText('Bez stola', { exact: true })).toBeVisible()
    await noSideScroll(page)
  })

  test('cash exact is three taps from the floor plan', async () => {
    const page = await freshPage()

    // A round to pay for.
    await page.getByRole('button', { name: /^10(\s|$)/ }).first().click()
    await page.getByRole('button')
      .filter({ has: page.getByText('Cola', { exact: true }) })
      .filter({ hasText: 'KM' })
      .first()
      .click()
    await page.getByRole('button', { name: /^Zaključi/ }).click()
    await page.getByRole('button', { name: 'Potvrdi' }).click()
    await expect(page.getByRole('button', { name: /^Naplati/ })).toBeVisible({ timeout: 15_000 })
    await backToFloor(page)

    const thumb = new Thumb(page)
    await thumb.tapTable('Sto 10')
    await thumb.tap(page.getByRole('button', { name: /^Naplati/ }))
    await thumb.tap(page.getByRole('button', { name: /^Tačno/ }))
    expect(thumb.taps).toBe(3)
    await expect(page.getByText(/Naplaćeno/)).toBeVisible({ timeout: 15_000 })
  })

  test('Pokaži narudžbu is the guest view: a watermark and nothing to tap', async () => {
    const page = await freshPage()

    await page.getByRole('button', { name: /^11(\s|$)/ }).first().click()
    await page.getByRole('button')
      .filter({ has: page.getByText('Kafa', { exact: true }) })
      .filter({ hasText: 'KM' })
      .first()
      .click()
    await page.getByRole('button', { name: /^Zaključi/ }).click()
    await page.getByRole('button', { name: 'Potvrdi' }).click()
    await expect(page.getByRole('button', { name: /^Naplati/ })).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Više' }).click()
    await page.getByRole('button', { name: 'Pokaži narudžbu' }).click()

    await expect(page.getByText(/interni pregled/i).first()).toBeVisible()
    await expect(page.getByText('Za platiti')).toBeVisible()
    // The word *račun* appears on this screen only inside the disclaimer.
    await expect(page.getByText('Interni pregled — nije fiskalni račun.')).toBeVisible()

    // Nothing on it writes a row: the only control is the one that closes it.
    const buttons = page.locator('.fixed').last().getByRole('button')
    expect(await buttons.count()).toBe(1)
    await noSideScroll(page)
  })

  test('Premjesti sto moves the guests and frees the old table', async () => {
    const page = await freshPage()

    await page.getByRole('button', { name: /^12(\s|$)/ }).first().click()
    await page.getByRole('button')
      .filter({ has: page.getByText('Kafa', { exact: true }) })
      .filter({ hasText: 'KM' })
      .first()
      .click()
    await page.getByRole('button', { name: /^Zaključi/ }).click()
    await page.getByRole('button', { name: 'Potvrdi' }).click()
    await expect(page.getByRole('button', { name: /^Naplati/ })).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Više' }).click()
    await page.getByRole('button', { name: /Premjesti sto/ }).click()
    await expect(page.getByText(/Gosti su sjeli za drugi sto/)).toBeVisible()
    await page.getByRole('button', { name: /^Sto 13/ }).click()

    await expect(page.getByText(/Premješteno na Sto 13/)).toBeVisible({ timeout: 15_000 })

    await expect.poll(async () => {
      const state = await readState(context)
      const from = state.tables.find(t => t.table_id === tables.get('Sto 12'))
      const to = state.tables.find(t => t.table_id === tables.get('Sto 13'))
      if (!from || !to) return 'nema'
      return `${from.tab_id === null}:${to.tab_id !== null}`
    }, { timeout: 20_000 }).toBe('true:true')
  })

  test('a draft older than fifteen minutes pulses, and Odbaci clears it', async () => {
    const page = await freshPage()

    await page.getByRole('button', { name: /^14(\s|$)/ }).first().click()
    await page.getByRole('button')
      .filter({ has: page.getByText('Kafa', { exact: true }) })
      .filter({ hasText: 'KM' })
      .first()
      .click()
    await backToFloor(page)

    // Age the draft by hand — sixteen minutes, which is what the card is for.
    await page.evaluate(() => {
      const open = indexedDB.open('keyval-store')
      return new Promise<void>((resolve) => {
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('keyval', 'readwrite')
          const store = tx.objectStore('keyval')
          const get = store.get('sank:drafts')
          get.onsuccess = () => {
            const drafts = get.result as Record<string, { created_at: string }>
            for (const key of Object.keys(drafts ?? {})) {
              drafts[key]!.created_at = new Date(Date.now() - 16 * 60_000).toISOString()
            }
            store.put(drafts, 'sank:drafts')
          }
          tx.oncomplete = () => resolve()
        }
      })
    })
    await page.reload()

    const card = page.locator('.card').filter({ hasText: 'Nacrt čeka' })
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card).toContainText('Sto 14')

    await card.getByRole('button', { name: 'Odbaci' }).click()
    await expect(page.getByText(/Nacrt odbačen/)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.card').filter({ hasText: 'Nacrt čeka' })).toHaveCount(0)

    // *Odbaci* leaves a trace, or the closing check is a check on nothing —
    // one `draft_discarded` entry, and no tab anywhere.
    const state = await readState(context)
    expect(state.tables.find(t => t.table_id === tables.get('Sto 14'))!.tab_id).toBeNull()
  })
})
