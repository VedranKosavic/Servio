/**
 * Screenshot harness for the waiter redesign — not a spec, run by hand:
 *   node scripts/shots.mjs before      (or after)
 *
 * It drives a real Chromium at 390x844 against this worktree's own server and
 * its own database, never 3002 and never data/sank.db.
 *
 * One trap it works around: `POST /api/dev/enrol` reuses a single dev device row
 * and rotates its token, so a second enrolment silently kills the first
 * browser's session. Lejla therefore places her order and closes *before* Amar
 * enrols.
 */
import { chromium, devices } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const PHASE = process.argv[2] ?? 'before'
const BASE = process.env.SHOT_URL ?? 'http://localhost:3122'
const OUT = process.env.SHOT_DIR ?? 'docs/design-shots/konobar'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const phone = { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, isMobile: true, baseURL: BASE }

async function ok(p) {
  const r = await p
  if (!r.ok()) throw new Error(`${r.url()} ${r.status()} ${await r.text()}`)
  return r
}

async function ackRules(api) {
  const r = await (await ok(api.get('/api/rules'))).json()
  if (r.must_ack) await ok(api.post('/api/me/rules/ack', { data: { version: r.version } }))
}

const seedCtx = await browser.newContext({ baseURL: BASE })
await seedCtx.request.post('/api/dev/reset-limits').catch(() => {})
await ok(seedCtx.request.post('/api/dev/enrol', { data: {} }))
const users = await (await ok(seedCtx.request.get('/api/auth/users'))).json()
const byName = n => users.find(u => u.name === n)

function lines(boot, items) {
  return items.map(([name, qty]) => {
    const p = boot.products.find(p => p.name === name)
    if (!p) throw new Error(`no product ${name}`)
    return { id: crypto.randomUUID(), product_id: p.id, qty }
  })
}

/** Lejla's table, so the plan shows a colleague's circle as well as mine. */
{
  await ok(seedCtx.request.post('/api/auth/pin', { data: { user_id: byName('Lejla').id, pin: '1111' } }))
  await ackRules(seedCtx.request)
  const boot = await (await ok(seedCtx.request.get('/api/bootstrap'))).json()
  const t9 = boot.tables.find(t => t.name === 'Sto 9')
  const state = await (await seedCtx.request.get('/api/tables/state')).json()
  const busy = new Set((state.tables ?? []).filter(t => t.tab_id).map(t => t.table_id))
  if (!busy.has(t9.id)) {
    await ok(seedCtx.request.post('/api/orders', { data: {
      client_id: crypto.randomUUID(), table_id: t9.id, tab_client_id: crypto.randomUUID(),
      client_created_at: new Date().toISOString(), lines: lines(boot, [['Kafa', 4]]),
    } }))
  }
}
await seedCtx.close()

// -- Amar, and everything the shots are of ----------------------------------
const ctx = await browser.newContext({ ...phone, deviceScaleFactor: 2 })
const api = ctx.request
await api.post('/api/dev/reset-limits').catch(() => {})
await ok(api.post('/api/dev/enrol', { data: {} }))
await ok(api.post('/api/auth/pin', { data: { user_id: byName('Amar').id, pin: '1111' } }))
await ackRules(api)

const boot = await (await ok(api.get('/api/bootstrap'))).json()
const table = n => boot.tables.find(t => t.name === `Sto ${n}`)

const state = await (await ok(api.get('/api/tables/state'))).json()
const busy = new Set((state.tables ?? []).filter(t => t.tab_id).map(t => t.table_id))
async function order(tableName, items) {
  const t = tableName === null ? null : table(tableName)
  if (t && busy.has(t.id)) return
  await ok(api.post('/api/orders', { data: {
    client_id: crypto.randomUUID(), table_id: t ? t.id : null, tab_client_id: crypto.randomUUID(),
    client_created_at: new Date().toISOString(), lines: lines(boot, items),
  } }))
}
await order(3, [['Kafa', 2], ['Coca-Cola', 1]])
await order(7, [['Kafa', 1]])
await order(12, [['Coca-Cola', 3], ['Kafa', 2], ['Nargila', 1]])
if ((state.loose_tabs ?? []).length === 0) await order(null, [['Kafa', 1], ['Red Bull', 1]])

const page = await ctx.newPage()
/** The dev server's floating devtools pill is not part of the design. */
const KILL_DEVTOOLS = () => {
  document.querySelectorAll('[id*="devtools"], [class*="devtools"], nuxt-devtools-anchor')
    .forEach(el => el.remove())
}

async function shot(name, url, prep) {
  await page.goto(url)
  await page.waitForTimeout(2500)
  await page.evaluate(KILL_DEVTOOLS).catch(() => {})
  if (prep) {
    try { await prep(page) } catch (e) { console.log('  prep skipped:', String(e).split('\n')[0].slice(0, 90)) }
  }
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/${name}-${PHASE}-390.png`, fullPage: true })
  console.log('shot', name)
}

await shot('stolovi', '/konobar')
await shot('sto', `/konobar/sto/${table(12).id}`, async (p) => {
  await p.getByRole('button', { name: /^Tura 1/ }).click({ timeout: 6000 })
})
await shot('dodaj', `/konobar/dodaj/${table(12).id}`, async (p) => {
  const kafa = p.getByRole('button').filter({ has: p.getByText('Kafa', { exact: true }) }).filter({ hasText: 'KM' }).first()
  await kafa.click({ timeout: 10_000 })
  await kafa.click()
  await p.waitForTimeout(400)
})
await shot('naplata', `/konobar/sto/${table(3).id}`, async (p) => {
  await p.getByRole('button', { name: /^Naplati/ }).click({ timeout: 10_000 })
  await p.waitForTimeout(700)
})
await shot('moja-smjena', '/konobar/moja-smjena')
await shot('smjena', '/konobar/smjena')
await shot('popis', '/konobar/popis')
await shot('pravila', '/konobar/pravila')
await shot('otpis', '/konobar/otpis')
await shot('raspored', '/konobar/raspored')
await shot('razgovor', '/konobar/razgovor')
await shot('instalacija', '/konobar/instalacija')

await browser.close()
console.log('done', PHASE)
