/**
 * Alerts v1 — the in-app attention list (`docs/BACKEND.md` §9). Nothing sends:
 * there is no drainer and no sender, so what is tested here is the queue, the
 * dedupe and the quiet-hours gate.
 *
 * The last describe block is the two-way assertion the contract asks for: §8's
 * ✔ column and `ALERT_RULE_KEYS` are one set. A kind marked ✔ with a key nobody
 * declared is a kind that throws at 03:10 on a shift close, which is the worst
 * possible time to find out.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { ALERT_RULE_KEYS, QUIET_HOURS_EXEMPT } from '#shared/constants'
import type { AlertRuleKey } from '#shared/constants'
import { LOG, LOG_KINDS } from '#shared/logTemplates'
import { localTime } from '#shared/dates'
import { queueAlert, sendAfter } from '../../server/services/alerts'
import { log } from '../../server/services/log'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

const queue = (a: Parameters<typeof queueAlert>[2]) =>
  f.db.transaction(tx => queueAlert(tx, f.venueId, a))

const rows = () => f.db.select().from(schema.alertEvents).all()

describe('queueAlert', () => {
  it('dedupes on (venue, rule, ref_type, ref_id)', () => {
    const shiftId = randomUUID()
    const first = queue({
      ruleKey: 'shift_closed', ref: { type: 'shift', id: shiftId },
      payload: { title_bs: 'Smjena zatvorena' },
    })
    // The same shift re-summarised after a late void: one item, not two.
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

    // Two Dnevnik entries — both things happened — and one attention item.
    expect(f.db.select().from(schema.logEntries).all()).toHaveLength(2)
    const alerts = rows()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.ruleKey).toBe('void_after_payment')
    expect(alerts[0]?.refId).toBe(adjustmentId)
  })

  it('an alert rule with a `when` that is false queues nothing', () => {
    f.db.transaction(tx => log(tx, f.venueId, {
      kind: 'comp_decided',
      body: {
        adjustment_id: randomUUID(), tab_id: randomUUID(), user_id: f.userId('Amar'),
        // Under `comp_large_fen` (2000): it stays in the Dnevnik and nowhere else.
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

  it('surfaces immediately outside the quiet window', () => {
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

// ---------------------------------------------------------------------------
// §8's ✔ column and §9's rule keys are one set — checked both ways.
// ---------------------------------------------------------------------------

describe('the rule keys and the log templates agree', () => {
  const fromTemplates = new Set<AlertRuleKey>(
    LOG_KINDS.map(k => LOG[k].alert?.rule).filter((r): r is AlertRuleKey => Boolean(r)),
  )

  /**
   * The keys no `LOG[kind].alert` produces, each with the caller that does.
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

  it.each(LOG_KINDS)('%s: its alert rule is a declared key', (kind) => {
    const rule = LOG[kind].alert?.rule
    if (!rule) return
    expect(ALERT_RULE_KEYS as readonly string[]).toContain(rule)
  })

  it.each(ALERT_RULE_KEYS)('%s: something can actually raise it', (key) => {
    const raised = fromTemplates.has(key) || key in NON_LOG_CALLERS
    expect(raised, `${key} has no LOG[kind].alert and no named non-log caller`).toBe(true)
  })

  it('the two sets have nothing left over on either side', () => {
    const declared = new Set<string>(ALERT_RULE_KEYS)
    expect([...fromTemplates].filter(r => !declared.has(r))).toEqual([])
    expect([...declared].filter(k => !fromTemplates.has(k as AlertRuleKey)
      && !(k in NON_LOG_CALLERS))).toEqual([])
  })

  it('shift_opened and payout_decided deliberately raise nothing', () => {
    // An attention item for every shift opening is noise, and telling the owner
    // about the decision he just made is noise (§9).
    expect(LOG.shift_opened.alert).toBeUndefined()
    expect(LOG.payout_decided.alert).toBeUndefined()
  })

  it('no template and no service tries to send anything', () => {
    // The sender, the drainer and its task are gone: the Dnevnik and this list
    // are the only two channels. `sent_at` is a column nothing writes.
    expect(rows().every(r => r.sentAt === null)).toBe(true)
  })
})
