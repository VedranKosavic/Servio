/**
 * Screenshot harness for the bartender + stock redesign. Not a spec — run with
 * `node tests/e2e/shots-sanker.mjs <before|after>` against a server on
 * SANK_E2E_URL (defaults to http://localhost:3114) with its own DB_PATH.
 *
 * It seeds a realistic bar: three open tickets of different ages, a couple of
 * finished ones, and two waiting adjustments — then shoots the four screens at
 * 390 px.
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from '@playwright/test'

const BASE = process.env.SANK_E2E_URL ?? 'http://localhost:3114'
const phase = process.argv[2] ?? 'before'
const OUT = process.env.SHOT_DIR ?? 'docs/design-shots/sanker'
mkdirSync(OUT, { recursive: true })

const ADMIN = { email: 'haris@lounge.ba', password: '1111' }
const PINS = { Amar: '1111', Dino: '1111', Emir: '1111' }

const browser = await chromium.launch()

/** An admin API context, for enrol codes and the bootstrap catalogue. */
const adminCtx = await browser.newContext({ baseURL: BASE })
await adminCtx.request.post('/api/dev/reset-limits')
const login = await adminCtx.request.post('/api/auth/admin/login', { data: ADMIN })
if (!login.ok()) throw new Error(`admin login: ${await login.text()}`)
const boot = await (await adminCtx.request.get('/api/bootstrap')).json()

async function enrolAndLogin(context, who) {
  const user = boot.users.find(u => u.name === who)
  const code = await (await adminCtx.request.post('/api/admin/enrol-codes', {
    data: { mode: 'personal', bound_user_id: user.id, label: `${who}ov telefon` },
  })).json()
  const enrolled = await context.request.post('/api/devices/enrol', {
    data: { code: code.code, label: `${who}ov telefon` },
  })
  if (!enrolled.ok()) throw new Error(`enrol ${who}: ${await enrolled.text()}`)
  const res = await context.request.post('/api/auth/pin', { data: { user_id: user.id, pin: PINS[who] } })
  if (!res.ok()) throw new Error(`pin ${who}: ${await res.text()}`)
  const rules = await (await context.request.get('/api/rules')).json()
  if (rules.must_ack) await context.request.post('/api/me/rules/ack', { data: { version: rules.version } })
  return user
}

const phone = { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, isMobile: true, baseURL: BASE }
const amarCtx = await browser.newContext(phone)
const dinoCtx = await browser.newContext(phone)
const emirCtx = await browser.newContext(phone)
await enrolAndLogin(amarCtx, 'Amar')
await enrolAndLogin(dinoCtx, 'Dino')
await enrolAndLogin(emirCtx, 'Emir')

function flavour(name) {
  const f = boot.flavours.find(x => x.name.includes(name))
  if (!f) throw new Error(`no flavour ${name}`)
  return f
}

function product(name) {
  const p = boot.products.find(x => x.name === name)
  if (!p) throw new Error(`no product ${name}: ${boot.products.map(x => x.name).join(', ')}`)
  return p
}

async function lockRound(api, tableName, lines, note) {
  const table = boot.tables.find(t => t.name === tableName)
  const body = {
    client_id: crypto.randomUUID(),
    table_id: table.id,
    lines: lines.map(l => ({
      id: crypto.randomUUID(),
      product_id: product(l.name).id,
      qty: l.qty,
      ...(l.flavours ? { flavour_ids: l.flavours.map(n => flavour(n).id) } : {}),
      ...(l.note ? { note: l.note } : {}),
    })),
    ...(note ? { note } : {}),
  }
  const res = await api.post('/api/orders', { data: body })
  if (!res.ok()) throw new Error(`order ${tableName}: ${await res.text()}`)
  const order = await res.json()
  return { ...order, lineIds: body.lines.map(l => l.id) }
}

// Only seed once — a second run of the harness (the "after" pass) reuses what
// the first one wrote, so the two sets of shots show the same bar.
const already = await (await emirCtx.request.get('/api/prep')).json()
const openCount = Array.isArray(already?.open) ? already.open.length : 0

if (openCount === 0) {
  const done1 = await lockRound(amarCtx.request, 'Sto 3', [{ name: 'Kafa', qty: 2 }])
  await emirCtx.request.post(`/api/prep/${done1.order_id}/done`, { data: {} })
  const done2 = await lockRound(dinoCtx.request, 'Sto 5', [{ name: 'Coca-Cola', qty: 3 }])
  await emirCtx.request.post(`/api/prep/${done2.order_id}/done`, { data: {} })

  await lockRound(amarCtx.request, 'Sto 12', [
    { name: 'Nargila', qty: 1, flavours: ['Jabuka', 'Menta'], note: 'jača glava' },
    { name: 'Kafa', qty: 2 },
  ], 'Bez leda, gost žuri')
  await lockRound(dinoCtx.request, 'Sto 7', [{ name: 'Coca-Cola', qty: 2 }, { name: 'Kafa', qty: 1 }, { name: 'Voda 0,5 l', qty: 2 }])
  await lockRound(amarCtx.request, 'Sto 21', [{ name: 'Nargila', qty: 2, flavours: ['Grožđe'] }, { name: 'Dodatni žar', qty: 1 }])

  // Two things waiting on the bartender: a storno and a gratis.
  const r1 = await lockRound(amarCtx.request, 'Sto 18', [{ name: 'Kafa', qty: 1 }])
  await emirCtx.request.post(`/api/prep/${r1.order_id}/done`, { data: {} })
  const a1 = await amarCtx.request.post('/api/adjustments', {
    data: {
      client_id: crypto.randomUUID(),
      order_line_id: r1.lineIds[0],
      kind: 'void',
      reason: 'not_served',
      note: 'Gost je otišao prije nego je stiglo.',
    },
  })
  if (!a1.ok()) console.warn('adjustment 1:', await a1.text())

  const r2 = await lockRound(dinoCtx.request, 'Sto 19', [{ name: 'Coca-Cola', qty: 2 }])
  await emirCtx.request.post(`/api/prep/${r2.order_id}/done`, { data: {} })
  const a2 = await dinoCtx.request.post('/api/adjustments', {
    data: {
      client_id: crypto.randomUUID(),
      order_line_id: r2.lineIds[0],
      kind: 'comp',
      reason: 'complaint',
    },
  })
  if (!a2.ok()) console.warn('adjustment 2:', await a2.text())
}

// ---- the shots ------------------------------------------------------------

const page = await emirCtx.newPage()

/**
 * The viewport, not `fullPage`: both these screens have a sticky header and a
 * sticky tab bar, and a full-page capture renders them floating over the middle
 * of the list. What the owner is judging is the phone.
 */
async function shot(path, name, prep, scrollTo) {
  await page.goto(path)
  await page.waitForTimeout(2500)
  if (prep) await prep()
  if (scrollTo) {
    await page.evaluate(y => window.scrollTo(0, y), scrollTo)
    await page.waitForTimeout(400)
  }
  await page.screenshot({ path: `${OUT}/${name}-${phase}.png` })
  console.info(`${OUT}/${name}-${phase}.png`)
}

await shot('/sanker', 'narudzbe-390')
await shot('/sanker', 'narudzbe-gotovo-390', async () => {
  const toggle = page.getByRole('button', { name: /Gotov/ })
  if (await toggle.count()) await toggle.last().click()
  await page.waitForTimeout(400)
}, 1400)
await shot('/sanker/cekanje', 'cekanje-390')
await shot('/stanje', 'stanje-390')
await shot('/stanje', 'stanje-duhan-390', null, 900)
await shot('/stanje', 'stanje-prijem-390', async () => {
  const btn = page.getByRole('button', { name: /Prijem robe/ })
  if (await btn.count()) await btn.first().click()
  await page.waitForTimeout(600)
})

await browser.close()
