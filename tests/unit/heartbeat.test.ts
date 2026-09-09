/**
 * The device heartbeat (`docs/BACKEND.md` §4.3).
 *
 * Every 60 s from every phone in the building — which is why the second
 * describe block matters as much as the first: a bump on this path would
 * invalidate every waiter's ETag once a minute and turn the cheap 304 poll the
 * whole sync design rests on back into a full floor-plan read.
 */
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeFixture, schema, type Fixture } from '../helpers/db'
import { businessDate } from '#shared/dates'
import { clockSkewS, heartbeat } from '../../server/services/heartbeat'
import { maxSeq } from '../../server/services/changes'

let f: Fixture

beforeEach(() => { f = makeFixture() })
afterEach(() => { f.close() })

/** Enrol a device the way WP1's `POST /api/devices/enrol` will. */
function enrol(label = 'Šank tablet', mode: 'personal' | 'shared' = 'shared'): string {
  const id = randomUUID()
  f.db.insert(schema.devices).values({
    id,
    venueId: f.venueId,
    label,
    tokenHash: randomUUID(),
    mode,
    enrolledAt: f.clock.now(),
  }).run()
  return id
}

const device = (id: string) =>
  f.db.select().from(schema.devices).where(eq(schema.devices.id, id)).get()!

const entries = () => f.db.select().from(schema.logEntries).all()

const beat = (deviceId: string, body: Partial<Parameters<typeof heartbeat>[3]> = {}, at?: string) =>
  heartbeat(f.db, f.venueId, deviceId, {
    pending: 0,
    client_now: at ?? f.clock.now(),
    ...body,
  }, at ?? f.clock.now())

describe('what the heartbeat stores', () => {
  it('records the outbox, the version and the last seen time', () => {
    const id = enrol()
    const at = f.clock.now()
    const oldest = new Date(Date.parse(at) - 600_000).toISOString()

    const result = beat(id, {
      pending: 3, oldest_pending_at: oldest, app_version: '2026.9.1', standalone: true,
    }, at)

    const row = device(id)
    expect(row.pendingCount).toBe(3)
    expect(row.oldestPendingAt).toBe(oldest)
    expect(row.lastSeenAt).toBe(at)
    expect(row.appVersion).toBe('2026.9.1')
    expect(row.standalone).toBe(1)
    expect(result.server_now).toBe(at)
    expect(result.revoked).toBe(false)
  })

  it('reports a closing shift so the phone stops taking rounds', () => {
    const id = enrol()
    const shiftId = f.openShift({ members: ['Amar'] })
    expect(beat(id).shift_closing).toBe(false)

    f.db.update(schema.shifts).set({ status: 'closing', closingStartedAt: f.clock.now() })
      .where(eq(schema.shifts.id, shiftId)).run()
    expect(beat(id).shift_closing).toBe(true)
  })

  it('refuses a device nobody enrolled', () => {
    expect(() => beat(randomUUID())).toThrow(/NO_DEVICE|not enrolled/)
  })
})

describe('clock skew', () => {
  it('is device minus server, so a phone that is behind is negative', () => {
    const server = '2026-09-09T21:00:00.000Z'
    // The phone thinks it is 20:53 — seven minutes behind, *kasni*.
    expect(clockSkewS('2026-09-09T20:53:00.000Z', server)).toBe(-420)
    expect(clockSkewS('2026-09-09T21:07:00.000Z', server)).toBe(420)
    expect(clockSkewS(server, server)).toBe(0)
  })

  it('clamps a broken clock to ±1 h', () => {
    const server = '2026-09-09T21:00:00.000Z'
    expect(clockSkewS('2019-01-01T00:00:00.000Z', server)).toBe(-3600)
    expect(clockSkewS('2030-01-01T00:00:00.000Z', server)).toBe(3600)
    expect(clockSkewS('rubbish', server)).toBe(0)
  })

  it('is stored on the device row and returned', () => {
    const id = enrol()
    const at = '2026-09-09T21:00:00.000Z'
    const result = beat(id, { client_now: '2026-09-09T20:53:00.000Z' }, at)

    expect(result.clock_skew_s).toBe(-420)
    expect(device(id).clockSkewS).toBe(-420)
  })

  it('writes one clock_skew entry per device per business date', () => {
    const id = enrol('Amarov telefon')
    // 23:00 and 23:10 local on the same night.
    const first = '2026-09-08T21:00:00.000Z'
    const second = '2026-09-08T21:10:00.000Z'
    // Default `clock_skew_alert_s` is 300 s.
    const skewed = (at: string) => new Date(Date.parse(at) - 420_000).toISOString()

    beat(id, { client_now: skewed(first) }, first)
    beat(id, { client_now: skewed(second) }, second)

    const skewEntries = entries().filter(e => e.kind === 'clock_skew')
    expect(skewEntries).toHaveLength(1)
    expect(skewEntries[0]?.refType).toBe('device')
    expect(skewEntries[0]?.refId)
      .toBe(`${id}:${businessDate(first, 'Europe/Sarajevo', 6)}`)
    expect(skewEntries[0]?.titleBs).toContain('Amarov telefon')
    expect(skewEntries[0]?.titleBs).toContain('kasni')

    // Tomorrow night is a new business date, and a phone still wrong is worth
    // saying again.
    const nextNight = '2026-09-09T21:00:00.000Z'
    beat(id, { client_now: skewed(nextNight) }, nextNight)
    expect(entries().filter(e => e.kind === 'clock_skew')).toHaveLength(2)
  })

  it('says nothing while the skew is inside the threshold', () => {
    const id = enrol()
    const at = '2026-09-08T21:00:00.000Z'
    beat(id, { client_now: new Date(Date.parse(at) - 60_000).toISOString() }, at)
    expect(entries().filter(e => e.kind === 'clock_skew')).toHaveLength(0)
  })

  it('a second device on the same night gets its own entry', () => {
    const a = enrol('Telefon A')
    const b = enrol('Telefon B')
    const at = '2026-09-08T21:00:00.000Z'
    const skewed = new Date(Date.parse(at) - 420_000).toISOString()

    beat(a, { client_now: skewed }, at)
    beat(b, { client_now: skewed }, at)
    expect(entries().filter(e => e.kind === 'clock_skew')).toHaveLength(2)
  })
})

describe('the heartbeat and the change feed', () => {
  it('a routine heartbeat bumps nothing at all', () => {
    const id = enrol()
    f.openShift({ members: ['Amar'] })
    const before = maxSeq(f.db, f.venueId)

    for (let i = 0; i < 10; i++) beat(id, { pending: i })

    // Ten minutes of polling from one phone, and every other phone's ETag is
    // still valid.
    expect(maxSeq(f.db, f.venueId)).toBe(before)
    expect(f.db.select().from(schema.changes).all()).toHaveLength(0)
  })

  it('only the once-a-night skew entry moves the sequence, and only for `log`', () => {
    const id = enrol()
    const at = '2026-09-08T21:00:00.000Z'
    const skewed = new Date(Date.parse(at) - 420_000).toISOString()

    beat(id, { client_now: skewed }, at)

    // A Dnevnik entry nobody is told about is a Dnevnik entry nobody reads, so
    // this one path does bump — exactly once per device per night, and only the
    // `log` entity, never `table` or `device`.
    const bumped = f.db.select().from(schema.changes).all()
    expect(bumped.map(r => r.entity)).toEqual(['log'])

    beat(id, { client_now: skewed }, '2026-09-08T21:05:00.000Z')
    expect(f.db.select().from(schema.changes).all()).toHaveLength(1)
  })

  it('reports the venue sequence back to the phone', () => {
    const id = enrol()
    f.db.transaction(() => {})
    const lockSeq = maxSeq(f.db, f.venueId)
    expect(beat(id).seq).toBe(lockSeq)
  })
})
