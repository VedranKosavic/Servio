/**
 * Alerts v1 (`docs/BACKEND.md` §9).
 *
 * The last describe block is the two-way assertion the contract asks for: §8's
 * ✔ column and `ALERT_RULE_KEYS` are one set. A kind marked ✔ with a key nobody
 * declared is a kind that throws at 03:10 on a shift close, which is the worst
 * possible time to find out.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { ALERT_RULE_KEYS, QUIET_HOURS_EXEMPT } from '#shared/constants'
import type { AlertRuleKey } from '#shared/constants'
import { LOG, LOG_KINDS } from '#shared/logTemplates'
import { localTime } from '#shared/dates'
import {
  consoleSender, drainAlerts, queueAlert, renderMessage, resolveSender, sendAfter,
  telegramSender, type AlertSender,
} from '../../server/services/alerts'
import { log } from '../../server/services/log'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => {
  f.close()
  vi.unstubAllEnvs()
})

const queue = (a: Parameters<typeof queueAlert>[2]) =>
  f.db.transaction(tx => queueAlert(tx, f.venueId, a))

const rows = () => f.db.select().from(schema.alertEvents).all()

/** Give an admin a chat id, the way *Postavke* does. */
function withChatId(name: string, chatId: string) {
  f.db.update(schema.users).set({ telegramChatId: chatId })
    .where(eq(schema.users.id, f.userId(name))).run()
}

describe('queueAlert', () => {
  it('dedupes on (venue, rule, ref_type, ref_id)', () => {
    const shiftId = randomUUID()
    const first = queue({
      ruleKey: 'shift_closed', ref: { type: 'shift', id: shiftId },
      payload: { title_bs: 'Smjena zatvorena' },
    })
    // The same shift re-summarised after a late void: one message, not two.
    const second = queue({
      ruleKey: 'shift_closed', ref: { type: 'shift', id: shiftId },
      payload: { title_bs: 'Smjena zatvorena (v2)' },
    })

    expect(first).toBeTruthy()
    expect(second).toBeNull()
    expect(rows()).toHaveLength(1)
  })

  it('a different object under the same rule is a different alert', () => {
    queue({ ruleKey: 'shift_closed', ref: { type: 'shift', id: randomUUID() }, payload: {} })
    queue({ ruleKey: 'shift_closed', ref: { type: 'shift', id: randomUUID() }, payload: {} })
    expect(rows()).toHaveLength(2)
  })

  it('rolls back with the transaction that queued it', () => {
    expect(() => f.db.transaction((tx) => {
      queueAlert(tx, f.venueId, {
        ruleKey: 'shift_closed', ref: { type: 'shift', id: randomUUID() }, payload: {},
      })
      throw new Error('boom')
    })).toThrow('boom')
    expect(rows()).toHaveLength(0)
  })

  it('log() passes the caller ref through, so the dedupe has teeth', () => {
    const adjustmentId = randomUUID()
    const body = {
      adjustment_id: adjustmentId, tab_id: randomUUID(), table_id: f.tableId('Sto 7'),
      user_id: f.userId('Amar'), approver_id: f.userId('Emir'),
      line: '2 × Kafa', amount_fen: 300, outcome: 'applied' as const, was_paid: true,
    }
    f.db.transaction(tx => log(tx, f.venueId, {
      kind: 'void_decided', body, ref: { type: 'line_adjustment', id: adjustmentId },
    }))
    f.db.transaction(tx => log(tx, f.venueId, {
      kind: 'void_decided', body, ref: { type: 'line_adjustment', id: adjustmentId },
    }))

    // Two Dnevnik entries — both things happened — and one message.
    expect(f.db.select().from(schema.logEntries).all()).toHaveLength(2)
    const alerts = rows()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.ruleKey).toBe('void_after_payment')
    expect(alerts[0]?.refId).toBe(adjustmentId)
  })

  it('a telegram rule with a `when` that is false queues nothing', () => {
    f.db.transaction(tx => log(tx, f.venueId, {
      kind: 'comp_decided',
      body: {
        adjustment_id: randomUUID(), tab_id: randomUUID(), user_id: f.userId('Amar'),
        // Under `comp_large_fen` (2000): the owner does not need to hear about it.
        line: '1 × Kafa', amount_fen: 150, reason: 'gost čekao', outcome: 'applied',
      },
      ref: { type: 'line_adjustment', id: randomUUID() },
    }))
    expect(rows()).toHaveLength(0)
  })
})

describe('quiet hours', () => {
  /** 04:30 in Sarajevo, whatever the offset is that night. */
  const smallHours = '2026-09-09T02:30:00.000Z'
  const evening = '2026-09-08T21:00:00.000Z'

  it('the fixture instants really are 04:30 and 23:00 local', () => {
    expect(localTime(smallHours)).toBe('04:30')
    expect(localTime(evening)).toBe('23:00')
  })

  it('defers stock_variance to 10:00 local', () => {
    const at = sendAfter('stock_variance', smallHours, 'Europe/Sarajevo')
    expect(at).not.toBe(smallHours)
    expect(localTime(at)).toBe('10:00')
    expect(Date.parse(at)).toBeGreaterThan(Date.parse(smallHours))
  })

  it('does not defer the three exempt rules', () => {
    for (const rule of QUIET_HOURS_EXEMPT) {
      expect(sendAfter(rule, smallHours, 'Europe/Sarajevo'), rule).toBe(smallHours)
    }
    expect(QUIET_HOURS_EXEMPT).toEqual(['shift_closed', 'cash_variance', 'health'])
  })

  it('sends immediately outside the quiet window', () => {
    expect(sendAfter('stock_variance', evening, 'Europe/Sarajevo')).toBe(evening)
  })

  it('is applied by queueAlert itself', () => {
    queue({
      ruleKey: 'stock_variance', ref: { type: 'stock_count', id: randomUUID() },
      payload: {}, at: smallHours,
    })
    queue({
      ruleKey: 'shift_closed', ref: { type: 'shift', id: randomUUID() },
      payload: {}, at: smallHours,
    })

    const byRule = new Map(rows().map(r => [r.ruleKey, r.sendAfter]))
    expect(localTime(byRule.get('stock_variance')!)).toBe('10:00')
    expect(byRule.get('shift_closed')).toBe(smallHours)
  })
})

describe('drainAlerts', () => {
  function fakeSender() {
    const sent: Array<{ chatId: string, text: string }> = []
    const sender: AlertSender = {
      send: (chatId, text) => { sent.push({ chatId, text }); return Promise.resolve() },
    }
    return { sender, sent }
  }

  it('sends to admins with a chat id and to nobody else', async () => {
    withChatId('Haris', '111')
    // A waiter with a chat id is not an admin, and must never be mirrored to.
    withChatId('Amar', '222')

    const logId = randomUUID()
    queue({
      ruleKey: 'shift_closed', ref: { type: 'shift', id: randomUUID() },
      payload: { title_bs: 'Smjena zatvorena · pazar 450,00 KM', log_id: logId },
    })

    const { sender, sent } = fakeSender()
    await drainAlerts(f.db, sender)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.chatId).toBe('111')
    expect(sent[0]?.text).toContain('Smjena zatvorena')
    expect(sent[0]?.text).toContain(`/a/dnevnik/${logId}`)
    expect(rows()[0]?.sentAt).toBeTruthy()
  })

  it('leaves a row alone until send_after has passed', async () => {
    withChatId('Haris', '111')
    queue({
      ruleKey: 'stock_variance', ref: { type: 'stock_count', id: randomUUID() },
      payload: {}, at: '2026-09-09T02:30:00.000Z',
    })

    const { sender, sent } = fakeSender()
    await drainAlerts(f.db, sender, '2026-09-09T03:00:00.000Z')
    expect(sent).toHaveLength(0)
    expect(rows()[0]?.sentAt).toBeNull()

    await drainAlerts(f.db, sender, '2026-09-09T09:00:00.000Z')
    expect(sent).toHaveLength(1)
  })

  it('a throwing sender increments attempts and backs off', async () => {
    withChatId('Haris', '111')
    const at = '2026-09-08T21:00:00.000Z'
    queue({
      ruleKey: 'shift_closed', ref: { type: 'shift', id: randomUUID() }, payload: {}, at,
    })

    const failing: AlertSender = { send: () => Promise.reject(new Error('telegram 502')) }

    await drainAlerts(f.db, failing, at)
    let row = rows()[0]!
    expect(row.sentAt).toBeNull()
    expect(row.attempts).toBe(1)
    expect(row.lastError).toContain('502')
    expect(Date.parse(row.sendAfter)).toBe(Date.parse(at) + 60_000)

    await drainAlerts(f.db, failing, row.sendAfter)
    row = rows()[0]!
    expect(row.attempts).toBe(2)
    // 60 s, then 120 s: linear, because a Telegram outage is minutes long.
    expect(Date.parse(row.sendAfter)).toBe(Date.parse(row.createdAt) + 60_000 + 120_000)
  })

  it('gives up after eight attempts instead of hammering a bad token', async () => {
    withChatId('Haris', '111')
    const id = queue({
      ruleKey: 'shift_closed', ref: { type: 'shift', id: randomUUID() }, payload: {},
      at: '2026-09-08T21:00:00.000Z',
    })!
    f.db.update(schema.alertEvents).set({ attempts: 8 })
      .where(eq(schema.alertEvents.id, id)).run()

    const { sender, sent } = fakeSender()
    await drainAlerts(f.db, sender, '2026-09-09T20:00:00.000Z')
    expect(sent).toHaveLength(0)
  })

  it('marks an alert with no recipients as done rather than retrying forever', async () => {
    queue({ ruleKey: 'shift_closed', ref: { type: 'shift', id: randomUUID() }, payload: {} })
    const { sender, sent } = fakeSender()
    await drainAlerts(f.db, sender)
    expect(sent).toHaveLength(0)
    expect(rows()[0]?.sentAt).toBeTruthy()
    expect(rows()[0]?.attempts).toBe(0)
  })

  it('does not send a second venue\'s alert to this venue\'s admins', async () => {
    withChatId('Haris', '111')
    const otherId = randomUUID()
    f.db.insert(schema.venues).values({
      id: otherId, name: 'Druga', slug: 'druga', createdAt: f.clock.now(),
    }).run()
    f.db.transaction(tx => queueAlert(tx, otherId, {
      ruleKey: 'shift_closed', ref: { type: 'shift', id: randomUUID() },
      payload: { title_bs: 'tuđa smjena' },
    }))

    const { sender, sent } = fakeSender()
    await drainAlerts(f.db, sender)
    expect(sent).toHaveLength(0)
  })
})

describe('senders', () => {
  it('the console sender is the default, and Telegram only with a token', () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '')
    expect(resolveSender()).toBe(consoleSender)

    vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:abc')
    expect(resolveSender()).not.toBe(consoleSender)
  })

  it('the Telegram sender posts and never polls', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('{"ok":true}', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    await telegramSender('123:abc').send('111', 'zdravo')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage')
    expect(init.method).toBe('POST')
    // No getUpdates, no bot.start, no long poll — §9 and §14.4.
    expect(url).not.toContain('getUpdates')
    vi.unstubAllGlobals()
  })

  it('a non-2xx Telegram response throws, so the drainer backs off', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response('chat not found', { status: 400 }))))
    await expect(telegramSender('123:abc').send('111', 'zdravo')).rejects.toThrow(/400/)
    vi.unstubAllGlobals()
  })

  it('renders title then deep link', () => {
    vi.stubEnv('PUBLIC_URL', 'https://sank.example.com/')
    expect(renderMessage(JSON.stringify({ title_bs: 'Naslov', log_id: 'abc' })))
      .toBe('Naslov\nhttps://sank.example.com/a/dnevnik/abc')
    expect(renderMessage('not json')).toBe('Šank')
  })
})

// ---------------------------------------------------------------------------
// §8's ✔ column and §9's rule keys are one set — checked both ways.
// ---------------------------------------------------------------------------

describe('the rule keys and the log templates agree', () => {
  const fromTemplates = new Set<AlertRuleKey>(
    LOG_KINDS.map(k => LOG[k].telegram?.rule).filter((r): r is AlertRuleKey => Boolean(r)),
  )

  /**
   * The keys no `LOG[kind].telegram` produces, each with the caller that does.
   * A key that turns up here without a named caller is an alert nothing can
   * ever raise.
   */
  const NON_LOG_CALLERS: Partial<Record<AlertRuleKey, string>> = {
    health: 'server/tasks/{backup,nightly}.ts — a task that failed (§10)',
    // The only alert about something that did *not* happen, which is why there
    // is no log kind behind it: nobody closed the night. `log()` records events,
    // and an absence is not one.
    shift_not_closed: 'server/tasks/nightly.ts — still open past closing + 3 h (§10)',
  }

  it.each(LOG_KINDS)('%s: its telegram rule is a declared key', (kind) => {
    const rule = LOG[kind].telegram?.rule
    if (!rule) return
    expect(ALERT_RULE_KEYS as readonly string[]).toContain(rule)
  })

  it.each(ALERT_RULE_KEYS)('%s: something can actually raise it', (key) => {
    const raised = fromTemplates.has(key) || key in NON_LOG_CALLERS
    expect(raised, `${key} has no LOG[kind].telegram and no named non-log caller`).toBe(true)
  })

  it('the two sets have nothing left over on either side', () => {
    const declared = new Set<string>(ALERT_RULE_KEYS)
    expect([...fromTemplates].filter(r => !declared.has(r))).toEqual([])
    expect([...declared].filter(k => !fromTemplates.has(k as AlertRuleKey)
      && !(k in NON_LOG_CALLERS))).toEqual([])
  })

  it('shift_opened and payout_decided are deliberately not mirrored', () => {
    // A message for every shift opening is noise, and telling the owner about
    // the decision he just made is noise (§9).
    expect(LOG.shift_opened.telegram).toBeUndefined()
    expect(LOG.payout_decided.telegram).toBeUndefined()
  })
})
