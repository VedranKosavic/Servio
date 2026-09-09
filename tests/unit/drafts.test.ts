/**
 * *Odbaci* — the one mutation that writes nothing but a sentence.
 *
 * It exists because F10 step 1 will not let a shift close while an unlocked cart
 * sits on somebody's phone: the waiter either locks it or discards it, and
 * discarding has to leave a trace or the closing check is a check on nothing.
 *
 * Two properties matter and both are asserted below. The **ledger** must not
 * move — no order, no line, no movement, and no `changes` bump, because nothing
 * on any screen changed. And `total_fen`, the one money field in this whole API
 * the server cannot check against anything it computed, must reach the log entry
 * and **no summary**: it describes a cart the server never saw, so it is
 * evidence, not money (§2).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { discardDraft } from '../../server/services/orders'
import { maxSeq } from '../../server/services/changes'
import { summarizeShift } from '../../server/services/summaries'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { refuses } from '../helpers/shifts'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

function ledgerRows() {
  return {
    orders: f.db.select().from(schema.orders).all().length,
    lines: f.db.select().from(schema.orderLines).all().length,
    movements: f.db.select().from(schema.stockMovements).all().length,
    tabs: f.db.select().from(schema.tabs).all().length,
  }
}

describe('POST /api/drafts/discard', () => {
  it('writes one quiet entry and moves no ledger row', () => {
    f.openShift({ members: ['Amar'] })
    const before = ledgerRows()

    const result = discardDraft(f.db, f.venueId, f.actor('Amar'), {
      table_id: f.tableId('Sto 7'), lines: 3, total_fen: 900,
    })

    expect(result).toEqual({ ok: true })
    expect(ledgerRows()).toEqual(before)

    const entries = f.db.select().from(schema.logEntries)
      .where(and(
        eq(schema.logEntries.venueId, f.venueId),
        eq(schema.logEntries.kind, 'draft_discarded'),
      ))
      .all()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.titleBs).toContain('Odbačena nezaključana narudžba')
    expect(entries[0]!.titleBs).toContain('Sto 7')
    expect(JSON.parse(entries[0]!.bodyJson).total_fen).toBe(900)
  })

  it('does not bump — nothing on any screen changed', () => {
    f.openShift({ members: ['Amar'] })
    // `log()` itself bumps the `log` entity for the Dnevnik badge, so the
    // comparison that means anything is the floor plan's: `table` must not move.
    const before = f.db.select().from(schema.changes).all().filter(c => c.entity === 'table').length

    discardDraft(f.db, f.venueId, f.actor('Amar'), {
      table_id: f.tableId('Sto 7'), lines: 1, total_fen: 150,
    })

    const after = f.db.select().from(schema.changes).all().filter(c => c.entity === 'table').length
    expect(after).toBe(before)
    expect(maxSeq(f.db, f.venueId)).toBeGreaterThanOrEqual(0)
  })

  it('keeps `total_fen` out of every number the shift reports', () => {
    const shiftId = f.openShift({ members: ['Amar'] })
    f.lock('Amar', 'Sto 7', [{ product: 'Kafa' }])

    const before = summarizeShift(f.db, f.venueId, shiftId, f.clock.now())
    discardDraft(f.db, f.venueId, f.actor('Amar'), {
      table_id: f.tableId('Sto 8'), lines: 4, total_fen: 4_000,
    })
    const after = summarizeShift(f.db, f.venueId, shiftId, f.clock.now())

    expect(after.promet_fen).toBe(before.promet_fen)
    expect(after.expected_cash_fen).toBe(before.expected_cash_fen)
    expect(after.comp_fen).toBe(before.comp_fen)
    expect(after.void_fen).toBe(before.void_fen)
  })

  it('discarding the same phantom cart twice is two honest entries', () => {
    f.openShift({ members: ['Amar'] })
    const body = { table_id: f.tableId('Sto 7'), lines: 2, total_fen: 300 }
    discardDraft(f.db, f.venueId, f.actor('Amar'), body)
    discardDraft(f.db, f.venueId, f.actor('Amar'), body)

    const entries = f.db.select().from(schema.logEntries)
      .where(eq(schema.logEntries.kind, 'draft_discarded')).all()
    expect(entries).toHaveLength(2)
  })

  it('refuses a table nobody has', () => {
    refuses(() => discardDraft(f.db, f.venueId, f.actor('Amar'), {
      table_id: randomUUID(), lines: 1, total_fen: 100,
    }), 'TABLE_NOT_FOUND', 404)
  })
})
