/**
 * `log_entries` (`docs/BACKEND.md` §6.9, §8).
 *
 * The first test is the reason `log()` takes a `Tx` and not a `Db`: an entry
 * exists if and only if the event it describes committed. The sweep after it is
 * the reason `LOG_KINDS` is frozen — every kind has to render a real Bosnian
 * sentence today, not the first time it fires at 03:10.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { LOG_KINDS, isQuiet } from '#shared/logTemplates'
import { formatKm } from '#shared/money'
import type { LogKind } from '#shared/types'
import { getLogEntry, listLog, log, markLogSeen } from '../../server/services/log'
import { maxSeq } from '../../server/services/changes'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

const write = (e: Parameters<typeof log>[2]) => f.db.transaction(tx => log(tx, f.venueId, e))

describe('log() and the transaction', () => {
  it('a log in a transaction that throws leaves zero entries and zero alerts', () => {
    expect(() => f.db.transaction((tx) => {
      log(tx, f.venueId, {
        kind: 'shift_closed',
        body: { shift_id: randomUUID(), promet_fen: 12_000, cash_fen: 9000, diff_fen: 0 },
      })
      throw new Error('close failed after the entry')
    })).toThrow('close failed')

    expect(f.db.select().from(schema.logEntries).all()).toHaveLength(0)
    // `shift_closed` is a ✔ kind, so the rollback has to take the alert too —
    // otherwise the owner gets a message about a close that never happened.
    expect(f.db.select().from(schema.alertEvents).all()).toHaveLength(0)
  })

  it('bumps the log entity so the Dnevnik poll notices', () => {
    const before = maxSeq(f.db, f.venueId)
    write({ kind: 'override', body: { what: 'test' } })
    expect(maxSeq(f.db, f.venueId)).toBeGreaterThan(before)
    expect(f.db.select().from(schema.changes).all().map(r => r.entity)).toContain('log')
  })

  it('renders names lazily, so a rename does not rewrite history', () => {
    const id = write({
      kind: 'price_changed',
      body: { product_id: f.productId('Kafa'), before: 150, after: 180 },
      actorId: f.userId('Haris'),
    })

    const entry = getLogEntry(f.db, f.venueId, id)
    expect(entry.title_bs).toContain('Kafa')
    // `formatKm`, not a literal: the space before "KM" is U+00A0 so the amount
    // never wraps away from its currency on a phone.
    expect(entry.title_bs).toContain(formatKm(150))
    expect(entry.title_bs).toContain(formatKm(180))
    expect(entry.actor_name).toBe('Haris')
    // The body stored ids, not the rendered names.
    expect(entry.body.product_id).toBe(f.productId('Kafa'))
  })

  it('a null actor is Sistem, in Bosnian', () => {
    const id = write({ kind: 'override', body: { what: 'nočni zadatak' }, actorId: null })
    expect(getLogEntry(f.db, f.venueId, id).actor_name).toBeNull()
  })

  it('throws LOG_TEMPLATE_MISSING on a kind nobody defined', () => {
    expect(() => write({ kind: 'ne_postoji' as LogKind, body: {} }))
      .toThrow(/LOG_TEMPLATE_MISSING|no log template/)
  })

  it('strips a secret a careless caller spread into the body', () => {
    const id = write({
      kind: 'user_changed',
      body: {
        user_id: f.userId('Amar'),
        what: 'pin_resetovan',
        pin_hash: 'scrypt$16384$8$1$deadbeef$cafebabe',
        email: 'amar@example.com',
      },
    })
    const entry = getLogEntry(f.db, f.venueId, id)
    expect(JSON.stringify(entry.body)).not.toMatch(/hash|token|email|chat_id/i)
  })
})

// ---------------------------------------------------------------------------
// One fixture body per kind — the sweep §11 asks for.
// ---------------------------------------------------------------------------

const uid = () => randomUUID()

function bodyFor(kind: LogKind, f: Fixture): Record<string, unknown> {
  const at = f.clock.now()
  const user = f.userId('Amar')
  const approver = f.userId('Emir')
  const table = f.tableId('Sto 7')
  const bodies: Record<LogKind, Record<string, unknown>> = {
    shift_opened: { shift_id: uid(), user_id: user, at, auto: true },
    shift_closed: {
      shift_id: uid(), promet_fen: 45_000, cash_fen: 32_000, diff_fen: -500,
      early_close: true, by_user: [{ user_id: user, declared_fen: 20_000, diff_fen: 0 }],
    },
    shift_forced: { shift_id: uid(), note: 'Amar nije predao', missing_user_ids: [user] },
    shift_reviewed: { shift_id: uid(), card_total_fen: 8000, card_diff_fen: 0 },
    waiter_finished: {
      settlement_id: uid(), shift_id: uid(), user_id: user, from: at, to: at,
      promet_fen: 20_000, declared_fen: 19_500, within_tolerance: false,
    },
    settlement_late: { settlement_id: uid(), shift_id: uid(), user_id: user, declared_fen: 5000 },
    settlement_accepted: {
      settlement_id: uid(), user_id: user, receiver_id: approver, declared_fen: 5000,
    },
    void_requested: {
      adjustment_id: uid(), tab_id: uid(), table_id: table, user_id: user,
      line: '2 × Kafa', amount_fen: 300,
    },
    void_decided: {
      adjustment_id: uid(), tab_id: uid(), table_id: table, user_id: user,
      approver_id: approver, line: '2 × Kafa', amount_fen: 300, outcome: 'applied',
      was_paid: true, foreign_device: false, restock: true, refund_kind: 'from_waiter',
    },
    self_void_capped: { user_id: user, count: 6, max: 5, fen: 300 },
    comp_requested: {
      adjustment_id: uid(), tab_id: uid(), user_id: user,
      line: '1 × Nargila', amount_fen: 1500, reason: 'gost čekao',
    },
    comp_decided: {
      adjustment_id: uid(), tab_id: uid(), user_id: user, approver_id: approver,
      line: '1 × Nargila', amount_fen: 2500, reason: 'gost čekao', outcome: 'applied',
    },
    unpaid_marked: {
      tab_id: uid(), table_id: table, user_id: user, remaining_fen: 2400, reason: 'otišli',
    },
    unpaid_decided: { tab_id: uid(), table_id: table, amount_fen: 2400, outcome: 'otpis' },
    payment_reversed: {
      payment_id: uid(), tab_id: uid(), table_id: table, amount_fen: -1500,
      method: 'cash', adjustment_id: uid(), refund_kind: 'from_drawer',
    },
    pay_duplicate_attempt: {
      tab_id: uid(), table_id: table, user_id: user, paid_by: f.userId('Lejla'),
    },
    pay_uncovered: { tab_id: uid(), table_id: table, user_id: user },
    tab_moved: {
      tab_id: uid(), user_id: user, from_table_id: table, to_table_id: f.tableId('Sto 8'),
    },
    tab_offered: { tab_id: uid(), table_id: table, user_id: user, to: f.userId('Lejla') },
    tab_handed: { tab_id: uid(), table_id: table, from: user, to: f.userId('Lejla') },
    cross_waiter_lock: {
      tab_id: uid(), order_id: uid(), table_id: table,
      assigned_to: f.userId('Lejla'), locked_by: user,
    },
    draft_discarded: { table_id: table, user_id: user, lines: 3, total_fen: 900 },
    late_after_settle: {
      order_id: uid(), tab_id: uid(), table_id: table, user_id: user,
      shift_seq: 42, amount_fen: 600,
    },
    late_after_close: {
      tab_id: uid(), order_id: uid(), shift_id: uid(), table_id: table,
      user_id: user, amount_fen: 600, count: 2,
    },
    float_moved: {
      movement_id: uid(), type: 'float_out', user_id: user,
      created_by: f.userId('Haris'), amount_fen: 5000,
    },
    float_override: { shift_id: uid(), before: 10_000, after: 12_000 },
    payout_requested: {
      movement_id: uid(), user_id: user, amount_fen: 6000, reason: 'led', note: null,
    },
    payout_decided: {
      movement_id: uid(), user_id: user, approver_id: f.userId('Haris'),
      amount_fen: 6000, outcome: 'approved',
    },
    pickup: { movement_id: uid(), amount_fen: 20_000, note: null },
    override: { what: 'zatvaranje bez popisa', ref_id: uid() },
    delivery_posted: {
      delivery_id: uid(), supplier: 'Coca-Cola HBC', total_fen: 24_000, lines: 4,
    },
    delivery_reversed: { delivery_id: uid(), note: 'pogrešna faktura' },
    count_submitted: { count_id: uid(), items: 19, out_of_tolerance: 3 },
    count_witnessed: { count_id: uid(), witness_id: approver, phase: 'close' },
    count_confirmed: { count_id: uid(), variance_fen: -1500, adjusted_items: 3 },
    waste_logged: {
      waste_id: uid(), stock_item_id: f.stockItemId('Coca-Cola 0,25 l'), user_id: user,
      qty: 2, cost_fen: 180, reason: 'razbijeno', needs_approval: true,
    },
    waste_capped: { waste_id: uid(), user_id: user, count: 4 },
    stock_corrected: {
      movement_id: uid(), stock_item_id: f.stockItemId('Šećer'),
      qty_delta: -120, note: 'prosuto',
    },
    opening_set: { n_items: 19, total_value_fen: 180_000 },
    price_changed: { product_id: f.productId('Kafa'), before: 150, after: 180 },
    product_changed: { product_id: f.productId('Kafa'), what: 'naziv' },
    category_changed: { category_id: uid(), what: 'sort' },
    table_changed: { table_id: table, what: 'zona' },
    stock_item_changed: { stock_item_id: f.stockItemId('Šećer'), what: 'tolerancija' },
    recipe_changed: { product_id: f.productId('Kafa'), what: '7 g → 8 g' },
    settings_changed: {
      key: 'cash_tolerance_fen', label: 'Tolerancija kase', before: 500, after: 300,
    },
    user_changed: { user_id: user, what: 'dodan' },
    device_enrolled: { device_id: uid(), label: 'Šank tablet' },
    device_revoked: { device_id: uid(), label: 'Šank tablet' },
    device_unlocked: { device_id: uid(), label: 'Šank tablet', via: 'unlock' },
    lockout: { device_id: uid(), user_id: user, fails: 10 },
    clock_skew: { device_id: uid(), skew_s: -420 },

    // -- Ekipa: Razgovor ----------------------------------------------------
    chat_money_warned: { user_id: user, channel: 'svi', money_ack: true },
    chat_muted: { user_id: user, until: at },
    chat_image_removed: { author_id: user, remover_id: approver, channel: 'konobari' },
    chat_deleted_by_admin: { author_id: user, channel: 'svi' },
    chat_cap_hit: { user_id: user, cap: 'user' },
    chat_pin_changed: { user_id: user, channel: 'svi', cleared: false },

    // -- Ekipa: Raspored ----------------------------------------------------
    roster_published: { week_start: '2026-09-14' },
    roster_changed: { work_date: '2026-09-18', what: 'dodan', user_id: user },
    roster_absent: { assignment_id: uid(), user_id: user, work_date: '2026-09-18' },
    roster_sick: { assignment_id: uid(), user_id: user, work_date: '2026-09-18' },
    swap_requested: {
      swap_request_id: uid(), assignment_id: uid(), user_id: user,
      to_user_id: null, reason: 'zamjena', work_date: '2026-09-18',
    },
    swap_accepted: {
      swap_request_id: uid(), assignment_id: uid(),
      from_user_id: user, to_user_id: approver, work_date: '2026-09-18',
    },
    swap_assigned: {
      swap_request_id: uid(), assignment_id: uid(),
      from_user_id: user, to_user_id: approver, work_date: '2026-09-18',
    },
    swap_declined: { swap_request_id: uid(), assignment_id: uid(), user_id: approver },
    swap_cancelled: {
      swap_request_id: uid(), assignment_id: uid(), user_id: user,
      note: 'vlasnik promijenio ćeliju',
    },
    template_changed: { template_id: uid(), what: 'promijenjen', name: 'Večernja' },

    // -- Ekipa: Pravila -----------------------------------------------------
    rules_published: { version: 3, chars: 4200 },
    rules_acked: { user_id: user, version: 3 },

    // -- Roba: prijem sa slike ----------------------------------------------
    delivery_scanned: { scan_id: uid(), upload_id: uid(), lines: 8, green: 6, error: false },
    delivery_discarded: { scan_id: uid(), reason: 'pogrešna slika' },
    alias_linked: {
      alias: 'coca cola 0 25', stock_item_id: f.stockItemId('Coca-Cola 0,25 l'),
      supplier: 'Coca-Cola HBC',
    },
  }
  return bodies[kind]
}

describe('every LOG_KINDS member', () => {
  it('has a fixture, so this sweep cannot silently skip a new kind', () => {
    for (const kind of LOG_KINDS) expect(bodyFor(kind, f), kind).toBeDefined()
    expect(LOG_KINDS.length).toBeGreaterThan(60)
  })

  it.each(LOG_KINDS)('%s parses its fixture and renders a Bosnian title', (kind) => {
    const id = write({ kind, body: bodyFor(kind, f), actorId: f.userId('Haris') })
    const entry = getLogEntry(f.db, f.venueId, id)

    expect(entry.title_bs.length).toBeGreaterThan(0)
    // No English leaked into a title, and no unrendered placeholder either.
    expect(entry.title_bs).not.toMatch(/\{|\}|undefined|NaN|\[object/)
    expect(entry.quiet).toBe(isQuiet(kind))
    expect(entry.kind).toBe(kind)
    // No ISO date in a Bosnian sentence. The owner reads `08.09.2026.` and
    // `sub 19.09.` everywhere else in the app — the Razgovor line for the very
    // same roster event already writes it that way — so a raw `2026-09-19`
    // here would date one event two different ways in two places.
    expect(entry.title_bs, kind).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('no rendered body carries a secret', () => {
    for (const kind of LOG_KINDS) {
      const id = write({ kind, body: bodyFor(kind, f) })
      const entry = getLogEntry(f.db, f.venueId, id)
      expect(JSON.stringify(entry.body), kind).not.toMatch(/hash|token|email|chat_id|password/i)
    }
  })
})

// ---------------------------------------------------------------------------
// The Dnevnik reads
// ---------------------------------------------------------------------------

describe('listLog', () => {
  function requestAndDecision() {
    const shared = {
      adjustment_id: uid(), tab_id: uid(), table_id: f.tableId('Sto 7'),
      user_id: f.userId('Amar'), line: '2 × Kafa', amount_fen: 300,
    }
    const requestId = write({ kind: 'void_requested', body: shared })
    f.clock.advance(30)
    const decisionId = write({
      kind: 'void_decided',
      body: { ...shared, approver_id: f.userId('Emir'), outcome: 'applied' },
      resolvesId: requestId,
      at: f.clock.now(),
    })
    return { requestId, decisionId }
  }

  it('important=1 hides the quiet request and shows the decision with it inline', () => {
    const { requestId, decisionId } = requestAndDecision()

    const all = listLog(f.db, f.venueId, {})
    expect(all.entries.map(e => e.id).sort()).toEqual([requestId, decisionId].sort())

    const important = listLog(f.db, f.venueId, { important: true })
    expect(important.entries.map(e => e.id)).toEqual([decisionId])
    expect(important.entries[0]?.request?.id).toBe(requestId)
    expect(important.entries[0]?.request?.title_bs).toContain('Traži storno')
  })

  it('links both ways from a single entry', () => {
    const { requestId, decisionId } = requestAndDecision()
    expect(getLogEntry(f.db, f.venueId, decisionId).request?.id).toBe(requestId)
    expect(getLogEntry(f.db, f.venueId, requestId).resolver?.id).toBe(decisionId)
  })

  it('pages with a keyset cursor, newest first, with no row seen twice', () => {
    const ids: string[] = []
    for (let i = 0; i < 7; i++) {
      f.clock.advance(60)
      ids.push(write({ kind: 'override', body: { what: `pravilo ${i}` }, at: f.clock.now() }))
    }

    const first = listLog(f.db, f.venueId, { limit: 3 })
    expect(first.entries).toHaveLength(3)
    expect(first.next_cursor).toBeTruthy()

    const second = listLog(f.db, f.venueId, { limit: 3, before: first.next_cursor })
    const seen = [...first.entries, ...second.entries].map(e => e.id)
    expect(new Set(seen).size).toBe(6)
    expect(seen).toEqual(ids.slice().reverse().slice(0, 6))
  })

  it('filters by kind, group, actor and after', () => {
    write({ kind: 'override', body: { what: 'a' }, actorId: f.userId('Haris') })
    f.clock.advance(60)
    const cursor = f.clock.now()
    f.clock.advance(60)
    const priceId = write({
      kind: 'price_changed',
      body: { product_id: f.productId('Kafa'), before: 150, after: 180 },
      actorId: f.userId('Haris'),
      at: f.clock.now(),
    })

    expect(listLog(f.db, f.venueId, { kind: 'price_changed' }).entries.map(e => e.id))
      .toEqual([priceId])
    expect(listLog(f.db, f.venueId, { group: 'postavke' }).entries.map(e => e.id))
      .toEqual([priceId])
    expect(listLog(f.db, f.venueId, { after: cursor }).entries.map(e => e.id)).toEqual([priceId])
    expect(listLog(f.db, f.venueId, { actor: f.userId('Amar') }).entries).toHaveLength(0)
    expect(listLog(f.db, f.venueId, { group: 'ne-postoji' }).entries).toHaveLength(0)
  })

  it('caps limit at 100 and reports max_at', () => {
    const id = write({ kind: 'override', body: { what: 'a' } })
    const result = listLog(f.db, f.venueId, { limit: 5000 })
    expect(result.entries).toHaveLength(1)
    expect(result.max_at).toBe(getLogEntry(f.db, f.venueId, id).at)
  })
})

describe('markLogSeen', () => {
  it('stamps the reader and nobody else', () => {
    const at = f.clock.now()
    expect(markLogSeen(f.db, f.venueId, f.userId('Haris'), at)).toEqual({ log_seen_at: at })

    const users = f.db.select().from(schema.users).all()
    expect(users.find(u => u.name === 'Haris')?.logSeenAt).toBe(at)
    expect(users.find(u => u.name === 'Amar')?.logSeenAt).toBeNull()
  })
})
