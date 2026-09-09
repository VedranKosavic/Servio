/**
 * WP2's done-when, walked on a 390 px phone (docs/PHASE3.md §3 and §5.2 checks
 * 4, 5 and 6).
 *
 * Two browser contexts, two enrolled phones, because half of what is proved
 * here is about *two people*: the šanker counts and the waiter witnesses, and
 * the count is refused while the waiter's phone still holds a round. Each
 * context enrols through `POST /api/admin/enrol-codes` + `POST /api/devices/enrol`
 * rather than the dev door, which reuses one device row and would rotate the
 * first context's cookie out from under it (§5.1).
 *
 * What is proved:
 *
 *   1. The spot count is one screen, the expected quantity is nowhere on it
 *      before *Predaj*, and one bottle counted short comes back as −1 kom.
 *   2. A line beyond tolerance is refused until it carries a note, and the
 *      refusal opens that line's note rather than a dialogue.
 *   3. *Potvrđujem stanje* records the witness, and the counter cannot witness
 *      his own count.
 *   4. A phone with an unsent round blocks the count by name, and the count
 *      goes through the moment it flushes.
 *   5. *Dopuni smjenu* hands a waiter change out of the drawer.
 *   6. An otpis of a 12 KM bottle asks for a PIN and one of 3 KM does not.
 *
 * Run it against a production build on port 3112, never the owner's 3002:
 *
 *   rm -f data/verify.db*
 *   DB_PATH=data/verify.db PIN_PEPPER=dev npm run db:seed
 *   npm run build
 *   DB_PATH=data/verify.db PIN_PEPPER=dev COOKIE_SECURE=0 SANK_DEV_ENROL=1 \
 *     PORT=3112 node .output/server/index.mjs
 *   npx playwright test tests/e2e/wp2-popis.spec.ts
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const PINS: Record<string, string> = { Amar: '1111', Emir: '123456' }

interface User { id: string, name: string, role: string }
interface StockRow { id: string, name: string, is_spot: boolean, base_unit: string }

/**
 * Every enrol code this run needs, minted in **one** admin session.
 *
 * The auth doors are rate-limited at ten knocks a minute per IP (BACKEND §2),
 * and a laptop running three tests is one IP — so logging in per test is how a
 * green suite turns into three 429s. One login, three codes, and each context
 * then spends its own.
 */
const LABELS = [
  'Šank tablet', 'Amarov telefon',
  'Šank tablet 2', 'Amarov telefon 2',
  'Šank tablet 3',
] as const

const codes = new Map<string, string>()

test.beforeAll(async ({ browser }) => {
  const admin = await browser.newContext()
  const login = await admin.request.post('/api/auth/admin/login', {
    data: { email: 'haris@lounge.ba', password: 'lounge' },
  })
  expect(login.ok(), await login.text()).toBe(true)

  for (const label of LABELS) {
    const minted = await admin.request.post('/api/admin/enrol-codes', {
      data: { mode: 'shared', label },
    })
    expect(minted.ok(), await minted.text()).toBe(true)
    codes.set(label, ((await minted.json()) as { code: string }).code)
  }
  await admin.close()
})

/** Enrol this browser as its own phone and PIN into it as `name`. */
async function loginAs(context: BrowserContext, name: string, label: string): Promise<User> {
  const enrol = await context.request.post('/api/devices/enrol', {
    data: { code: codes.get(label), label },
  })
  expect(enrol.ok(), await enrol.text()).toBe(true)

  const users = await (await context.request.get('/api/auth/users')).json() as User[]
  const user = users.find(u => u.name === name)!
  expect(user).toBeTruthy()

  const pin = await context.request.post('/api/auth/pin', {
    data: { user_id: user.id, pin: PINS[name] },
  })
  expect(pin.ok(), await pin.text()).toBe(true)
  return user
}

async function spotItems(context: BrowserContext): Promise<StockRow[]> {
  const stock = await (await context.request.get('/api/stock')).json() as { items: StockRow[] }
  return stock.items.filter(i => i.is_spot)
}

/**
 * Fill the count. Every spot item gets its number; `short` names the one item
 * counted one below what the shelf holds.
 */
async function fillCount(page: Page, items: StockRow[], onHand: Map<string, number>, short?: string) {
  for (const item of items) {
    const value = (onHand.get(item.id) ?? 0) - (item.name === short ? 1 : 0)
    await page.locator(`#popis-${item.id}-input`).fill(String(value))
  }
}

test.describe('WP2 — Brzi popis, Potvrđujem stanje, Otpis', () => {
  test('a spot count with one bottle short, witnessed by a colleague', async ({ browser }) => {
    const bar = await browser.newContext()
    const floor = await browser.newContext()
    const barPage = await bar.newPage()
    const floorPage = await floor.newPage()

    const emir = await loginAs(bar, 'Emir', 'Šank tablet')
    await loginAs(floor, 'Amar', 'Amarov telefon')

    const items = await spotItems(bar)
    const stock = await (await bar.request.get('/api/stock')).json() as
      { items: { id: string, on_hand: number }[] }
    const onHand = new Map(stock.items.map(i => [i.id, i.on_hand]))

    await barPage.goto('/s/popis')
    await expect(barPage.getByRole('heading', { name: 'Stavke za popis' })).toBeVisible()

    // The expected quantity is not on this screen. Coca-Cola's 79 bottles are in
    // the same payload the rows came from and must appear nowhere.
    const cola = items.find(i => i.name === 'Coca-Cola 0,25 l')!
    expect(onHand.get(cola.id)).toBe(79)
    await expect(barPage.getByText('79', { exact: true })).toHaveCount(0)

    await fillCount(barPage, items, onHand, 'Coca-Cola 0,25 l')

    // One short, and tolerance is zero on the seed — so the server sends the
    // line back asking what happened, and the screen opens that note.
    await barPage.getByRole('button', { name: 'Predaj popis' }).click()
    const noteField = barPage.locator(`#popis-${cola.id} input[placeholder="Obavezna napomena"]`)
    await expect(noteField).toBeVisible()
    await noteField.fill('fali jedna flaša')

    await barPage.getByRole('button', { name: 'Predaj popis' }).click()
    await expect(barPage.getByRole('heading', { name: 'Popis predan' })).toBeVisible()
    await expect(barPage.getByText('1 van tolerancije')).toBeVisible()
    await expect(barPage.getByText('−1 kom')).toBeVisible()

    // The counter cannot witness himself, and the screen says why.
    await expect(barPage.getByText('Ti si popisivao')).toBeVisible()

    const submitted = await (await bar.request.get('/api/stock/counts?status=submitted')).json() as
      { id: string, counted_by: string, witnessed_by: string | null }[]
    expect(submitted[0]!.counted_by).toBe(emir.id)
    expect(submitted[0]!.witnessed_by).toBeNull()

    // Amar takes the bar over and confirms the same shelf, from his own phone.
    const witness = await floor.request.post(`/api/stock/counts/${submitted[0]!.id}/witness`, {
      data: {},
    })
    expect(witness.ok(), await witness.text()).toBe(true)
    const after = await witness.json() as { witnessed_by_name: string }
    expect(after.witnessed_by_name).toBe('Amar')

    await bar.close()
    await floor.close()
  })

  test('a phone still holding a round blocks the count, by name', async ({ browser }) => {
    const bar = await browser.newContext()
    const floor = await browser.newContext()
    const barPage = await bar.newPage()
    const floorPage = await floor.newPage()

    await loginAs(bar, 'Emir', 'Šank tablet 2')
    await loginAs(floor, 'Amar', 'Amarov telefon 2')

    // Amar locks a round, then his phone reports two things it has not sent.
    const boot = await (await floor.request.get('/api/bootstrap')).json() as
      { tables: { id: string, name: string }[], products: { id: string, name: string }[] }
    const table = boot.tables.find(t => t.name === 'Sto 5')!
    const kafa = boot.products.find(p => p.name === 'Kafa')!
    const order = await floor.request.post('/api/orders', {
      data: {
        client_id: crypto.randomUUID(),
        table_id: table.id,
        lines: [{ id: crypto.randomUUID(), product_id: kafa.id, qty: 1 }],
      },
    })
    expect(order.ok(), await order.text()).toBe(true)

    await floor.request.post('/api/devices/heartbeat', {
      data: { pending: 2, client_now: new Date().toISOString(), app_version: '0.9.0' },
    })

    const items = await spotItems(bar)
    const stock = await (await bar.request.get('/api/stock')).json() as
      { items: { id: string, on_hand: number }[] }
    const onHand = new Map(stock.items.map(i => [i.id, i.on_hand]))

    await barPage.goto('/s/popis')
    await expect(barPage.getByRole('heading', { name: 'Stavke za popis' })).toBeVisible()

    // *Dopuni smjenu*: change out of the drawer and into Amar's hands, which is
    // the other half of opening a night (F1 step 3).
    await barPage.getByRole('textbox', { name: 'Sitno za Amar' }).fill('20,00')
    await barPage.getByRole('button', { name: 'Daj' }).first().click()
    await expect(barPage.getByText(/Predano · Amar · 20,00/)).toBeVisible()

    await fillCount(barPage, items, onHand)
    await barPage.getByRole('button', { name: 'Predaj popis' }).click()

    await expect(barPage.getByText('Popis još ne može')).toBeVisible()
    await expect(barPage.getByText(/Amarov telefon 2 · javio se prije .*2 neposlane/).first())
      .toBeVisible()

    // Amar's phone flushes; the same tap now goes through.
    await floor.request.post('/api/devices/heartbeat', {
      data: { pending: 0, client_now: new Date().toISOString(), app_version: '0.9.0' },
    })
    await barPage.getByRole('button', { name: 'Pokušaj ponovo' }).click()
    await expect(barPage.getByRole('heading', { name: 'Popis predan' })).toBeVisible()

    await bar.close()
    await floor.close()
  })

  test('a 12 KM bottle asks for a PIN, a 3 KM one does not', async ({ browser }) => {
    const bar = await browser.newContext()
    const page = await bar.newPage()
    await loginAs(bar, 'Emir', 'Šank tablet 3')

    await page.goto('/k/otpis')
    await expect(page.getByRole('heading', { name: 'Šta se otpisuje' })).toBeVisible()

    // Red Bull costs 2,00 KM on the seed — under the 10 KM threshold.
    await page.getByRole('button', { name: /^Red Bull/ }).click()
    await page.getByRole('button', { name: 'razbijeno' }).click()
    await expect(page.getByText('Ovaj otpis traži odobrenje')).toHaveCount(0)
    await page.getByRole('button', { name: 'Sačuvaj' }).click()
    await expect(page.getByText(/Otpisano · Red Bull/)).toBeVisible()

    // Six of them is 12 KM, and that one wants a witness.
    await page.getByRole('button', { name: /^Red Bull/ }).click()
    await page.getByRole('button', { name: 'Više' }).click({ clickCount: 5 })
    await page.getByRole('button', { name: 'razbijeno' }).click()
    await expect(page.getByText('Ovaj otpis traži odobrenje')).toBeVisible()
    await page.getByRole('button', { name: 'Sačuvaj', exact: true }).click()

    await expect(page.getByRole('dialog', { name: 'Odobrenje otpisa' })).toBeVisible()
    await page.getByRole('button', { name: 'Emir', exact: true }).click()
    for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
    await page.getByRole('button', { name: 'Odobri i sačuvaj' }).click()

    await expect(page.getByText(/Otpisano · Red Bull/)).toBeVisible()
    await expect(page.getByText('čeka odobrenje')).toHaveCount(0)

    await bar.close()
  })
})
