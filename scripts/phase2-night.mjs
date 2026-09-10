/**
 * The simulated night behind `docs/PHASE2.md` §5 — one evening's worth of real
 * rows, written through the API rather than into the database, so every screen
 * on `/admin` has something true to show.
 *
 * Plain `fetch` and one cookie jar per actor. No test framework: this is not a
 * test, it is the fixture a person walks the dashboard against.
 *
 *   rm -f data/sank.db*                  # a fresh, seeded venue
 *   npm run dev -- --port 3100           # terminal 1
 *   node scripts/phase2-night.mjs        # terminal 2
 *
 * Three things that are easy to get wrong here, all learned the hard way:
 *
 * - **Enrol codes, not `POST /api/dev/enrol`.** The dev door reuses one shared
 *   device row and rotates its token on every call, so the second actor's enrol
 *   invalidates the first actor's cookie and the third request comes back
 *   `401 DEVICE_MISMATCH`. A real code per actor is also closer to what four
 *   phones actually do.
 * - **The seed venue takes cash only**, so the card payment needs
 *   `PATCH /api/admin/settings { payment_methods: ['cash', 'card'] }` first or
 *   step 4 is a `400 METHOD_NOT_ALLOWED`.
 * - **A count line outside tolerance needs a `note`**, or the whole post is the
 *   documented `422 NOTE_REQUIRED` naming the item ids.
 *
 * It deliberately does **not** close the shift: closing is one of the things
 * the walkthrough verifies by hand.
 */
const BASE = process.env.SANK_BASE ?? 'http://localhost:3100'
const uuid = () => crypto.randomUUID()
const log = (...a) => console.log(...a)

/** One person on one phone: their cookies, and the requests they make. */
class Actor {
  constructor(name) { this.name = name; this.cookies = new Map() }

  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }

  take(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';')
      const i = pair.indexOf('=')
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1))
    }
  }

  async req(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.header() },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    this.take(res)
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = text }
    if (!res.ok) {
      throw new Error(`${this.name} ${method} ${path} → ${res.status} ${text.slice(0, 400)}`)
    }
    return json
  }

  get(p) { return this.req('GET', p) }
  post(p, b = {}) { return this.req('POST', p, b) }
}

// The seed's people, by the ids `server/database/seed.ts` writes.
const IDS = {
  Amar: '11111111-1111-4111-8111-111111111111',
  Lejla: '22222222-2222-4222-8222-222222222222',
  Dino: '33333333-3333-4333-8333-333333333333',
  Emir: '55555555-5555-4555-8555-555555555555',
}
const PINS = { Amar: '1111', Lejla: '2222', Dino: '3333', Emir: '123456' }

const out = {}

// --- 1. the actors ---------------------------------------------------------

const admin = new Actor('Haris')
await admin.post('/api/auth/admin/login', { email: 'haris@lounge.ba', password: '1111' })
log('1. admin signed in')

/** Mint a personal enrol code, enrol a phone with it, then PIN in on it. */
async function actor(name) {
  const a = new Actor(name)
  const code = await admin.post('/api/admin/enrol-codes', {
    mode: 'personal', bound_user_id: IDS[name], label: `Telefon ${name}`,
  })
  await a.post('/api/devices/enrol', {
    code: code.code ?? code.enrol_code ?? code.value,
    label: `Telefon ${name}`,
    app_version: '2.0.0',
  })
  await a.post('/api/auth/pin', { user_id: IDS[name], pin: PINS[name] })
  log(`   ${name} enrolled and signed in`)
  return a
}

const amar = await actor('Amar')
const lejla = await actor('Lejla')
const dino = await actor('Dino')
const emir = await actor('Emir')

await admin.req('PATCH', '/api/admin/settings', { payment_methods: ['cash', 'card'] })
log('   card payments enabled')

const tables = await admin.get('/api/admin/tables')
const products = await admin.get('/api/admin/products')
const stockItems = await admin.get('/api/admin/stock-items')
const T = n => tables.find(t => t.name === `Sto ${n}`).id
const P = n => products.find(p => p.name === n).id
const S = n => stockItems.find(s => s.name === n).id

// --- 3. the orders (2 opens the shift on its own) --------------------------

const now = Date.now()
let tick = 0
/** Spread the rounds over the last forty minutes, so *Zadnje stavke* has a night. */
const at = () => new Date(now - (40 - tick++) * 60_000).toISOString()

const orders = []
async function order(who, table, lines) {
  const clientId = uuid()
  const r = await who.post('/api/orders', {
    client_id: clientId, table_id: T(table), client_created_at: at(), lines,
  })
  r.__client_id = clientId
  orders.push({ who: who.name, table, client_id: clientId, res: r })
  return r
}
const line = (name, qty = 1, extra = {}) => ({ id: uuid(), product_id: P(name), qty, ...extra })

log('3. rounds')
const o1 = await order(amar, 7, [line('Kafa', 2), line('Coca-Cola', 1)])
await order(amar, 8, [
  line('Nargila', 1, { flavour_ids: [S('Al Fakher · Jabuka'), S('Al Fakher · Menta')] }),
  line('Voda 0,5 l', 2),
])
const o3 = await order(amar, 9, [line('Red Bull', 2)])
await order(amar, 10, [line('Kafa', 1), line('Čaj', 1)])
await order(lejla, 12, [line('Limunada', 2), line('Kafa', 1)])
await order(lejla, 13, [line('Nargila', 1, { flavour_ids: [S('Al Fakher · Grožđe')] })])
const o7 = await order(lejla, 14, [line('Coca-Cola', 3)])
await order(lejla, 15, [line('Nes', 2)])
await order(dino, 18, [line('Kafa', 2), line('Fanta', 1)])
await order(dino, 19, [
  line('Nargila', 1, { flavour_ids: [S('Al Fakher · Lubenica')] }),
  line('Nova lula', 1, { flavour_ids: [S('Al Fakher · Menta')] }),
])
// One gratis, so *Gratis · storna* is not two zeros.
await order(dino, 20, [line('Cedevita', 2), line('Kafa', 1, { comp_reason: 'staff_drink' })])
await order(amar, 21, [line('Sok od narandže', 2)])
log(`   ${orders.length} rounds`)

const shift = await amar.get('/api/me/shift')
out.shift_id = shift.shift?.id ?? shift.id
log(`2. shift auto-opened on the first lock: ${out.shift_id}`)

// --- 4. one cash payment with change, one card -----------------------------

log('4. payments')
await amar.post('/api/payments', {
  client_id: uuid(), tab_id: o1.tab_id, method: 'cash',
  amount_fen: o1.tab_total_fen, received_fen: 1000,
  covers_order_client_ids: [o1.__client_id],
})
await amar.post('/api/payments', {
  client_id: uuid(), tab_id: o3.tab_id, method: 'card',
  amount_fen: o3.tab_total_fen, covers_order_client_ids: [o3.__client_id],
})

// --- 5. a pending void on a line that was already paid ---------------------

log('5. void requested on a paid line')
const paidTab = await amar.get(`/api/tabs/${o1.tab_id}`)
const paidLine = paidTab.orders[0].lines[0]
const voidReq = await dino.post('/api/adjustments', {
  client_id: uuid(), order_line_id: paidLine.id, kind: 'void',
  reason: 'wrong_entry', note: 'kucao pogrešno',
})
out.void_id = voidReq.id ?? voidReq.adjustment?.id

// --- 6. an unpaid tab, left for the owner ----------------------------------

log('6. unpaid tab')
const unpaid = await lejla.post('/api/tabs/unpaid', {
  client_id: uuid(), tab_client_id: o7.tab_client_id,
  reason: 'walked_out', note: 'gosti otišli',
})
out.unpaid_tab_id = unpaid.tab?.id ?? unpaid.id

// --- 7. a payout over the owner's threshold --------------------------------

log('7. 60,00 KM payout')
const payout = await emir.post(`/api/shifts/${out.shift_id}/payout`, {
  amount_fen: 6000, reason: 'dobavljac', note: 'plaćen ugalj',
})
out.payout_id = payout.id ?? payout.movement?.id

// --- 8. a blind settlement, 4,00 KM short ----------------------------------

log('8. Amar settles 4,00 KM short')
// Blind: the phone never learns what is expected, so this counts his pocket the
// way he would — the one cash payment he took — and declares 4,00 KM less.
out.expected_amar_fen = o1.tab_total_fen
const settle = await amar.post(`/api/shifts/${out.shift_id}/settle`, {
  declared_fen: Math.max(0, o1.tab_total_fen - 400), outbox_len: 0,
})
out.settlement_id = settle.id ?? settle.settlement?.id

// --- 9. a submitted count, left for *Primijeni* ----------------------------

log('9. count submitted')
const countLines = [
  { stock_item_id: S('Coca-Cola 0,25 l'), packs: 3, loose: 1 },
  { stock_item_id: S('Fanta 0,25 l'), packs: 0, loose: 70 },
  { stock_item_id: S('Cedevita'), packs: 0, loose: 26 },
  { stock_item_id: S('Red Bull'), packs: 0, loose: 24 },
  { stock_item_id: S('Voda 0,5 l'), packs: 0, loose: 68 },
  { stock_item_id: S('Sok od narandže'), packs: 0, loose: 22 },
  { stock_item_id: S('Al Fakher · Jabuka'), weighed_g: 600 },
  { stock_item_id: S('Al Fakher · Menta'), weighed_g: 450 },
  { stock_item_id: S('Ugalj (kocke)'), packs: 0, loose: 88 },
  { stock_item_id: S('Kafa (mljevena)'), weighed_g: 2300 },
]
// Every line carries a note: a line outside tolerance without one makes the
// whole post a 422 NOTE_REQUIRED naming the item ids.
const count = await emir.post('/api/stock/counts', {
  kind: 'full', phase: 'close', note: 'večernji popis',
  lines: countLines.map(l => ({ ...l, note: 'prebrojano' })),
})
out.count_id = count.id ?? count.count?.id

// --- 10. a delivery, so Roba has a movement --------------------------------

log('10. delivery')
const delivery = await emir.post('/api/stock/deliveries', {
  client_id: uuid(), supplier_name: 'Distributer d.o.o.', invoice_no: '2026-0912',
  lines: [
    { stock_item_id: S('Coca-Cola 0,25 l'), packs: 2, loose: 0, line_cost_fen: 4320 },
    { stock_item_id: S('Ugalj (kocke)'), packs: 0, loose: 100, line_cost_fen: 2500 },
  ],
})
out.delivery_id = delivery.id ?? delivery.delivery?.id

// --- what the owner should now see -----------------------------------------

const live = await admin.get('/api/owner/live')
out.live = {
  promet_danas_fen: live.promet_danas_fen,
  open: live.open,
  expected_cash_fen: live.expected_cash_fen,
  storna: live.storna,
  gratis: live.gratis,
  attention: live.attention?.map(a => ({ kind: a.kind, title: a.title_bs, amount_fen: a.amount_fen })),
  flags: live.flags?.map(f => f.title_bs ?? f.kind),
  who: live.who?.map(w => `${w.name}${w.settled ? ' (settled)' : ''}`),
  last_lines: live.last_lines?.length,
}

log('\n=== ids and the Puls read ===')
log(JSON.stringify(out, null, 2))
