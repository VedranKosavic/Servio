/**
 * The business day, and the clamp on the three timestamps a phone may send.
 *
 * The dates below are real Europe/Sarajevo instants, including both 2026 DST
 * nights — 29 March, when 02:00 becomes 03:00, and 25 October, when 03:00
 * becomes 02:00 and the hour between them happens twice. Those are the two
 * nights a `getHours()` somewhere quietly puts a shift's pazar on the wrong day.
 */
import { describe, expect, it } from 'vitest'
import {
  businessDate, clampEventAt, cutoffIso, localDate, localTime, nextBusinessDate, syncLagS,
} from '#shared/dates'

const TZ = 'Europe/Sarajevo'

describe('businessDate — the night starts at 06:00', () => {
  it('puts 05:59 on the previous day and 06:00 on this one, in winter', () => {
    // CET, UTC+1.
    expect(businessDate('2026-01-15T04:59:00Z', TZ, 6)).toBe('2026-01-14')
    expect(businessDate('2026-01-15T05:00:00Z', TZ, 6)).toBe('2026-01-15')
  })

  it('does the same in summer, an hour further from UTC', () => {
    // CEST, UTC+2. The rule is about the local clock, not about the offset.
    expect(businessDate('2026-07-15T03:59:00Z', TZ, 6)).toBe('2026-07-14')
    expect(businessDate('2026-07-15T04:00:00Z', TZ, 6)).toBe('2026-07-15')
  })

  it('holds on the night the clocks go forward', () => {
    // 01:30 local on 29 March is still CET; the night belongs to the 28th.
    expect(businessDate('2026-03-29T00:30:00Z', TZ, 6)).toBe('2026-03-28')
    // 06:00 local the same morning is already CEST, and starts the 29th.
    expect(businessDate('2026-03-29T04:00:00Z', TZ, 6)).toBe('2026-03-29')
  })

  it('holds on the night the clocks go back', () => {
    // 02:30 local on 25 October — the hour that happens twice. Either way it is
    // before 06:00, so it is still the 24th's night.
    expect(businessDate('2026-10-25T01:30:00Z', TZ, 6)).toBe('2026-10-24')
    expect(businessDate('2026-10-25T05:00:00Z', TZ, 6)).toBe('2026-10-25')
  })

  it('is not fooled by the machine being on UTC', () => {
    // The VPS runs with TZ=UTC. 23:30 UTC on the 8th is 01:30 on the 9th in
    // Sarajevo — and still the 8th's shift.
    expect(businessDate('2026-07-08T23:30:00Z', TZ, 6)).toBe('2026-07-08')
  })
})

describe('cutoffIso — where a period begins', () => {
  it('is 06:00 local, whichever side of a DST change the date is on', () => {
    expect(cutoffIso('2026-03-28', TZ, 6)).toBe('2026-03-28T05:00:00.000Z') // CET
    expect(cutoffIso('2026-03-29', TZ, 6)).toBe('2026-03-29T04:00:00.000Z') // CEST
    expect(cutoffIso('2026-10-24', TZ, 6)).toBe('2026-10-24T04:00:00.000Z') // CEST
    expect(cutoffIso('2026-10-25', TZ, 6)).toBe('2026-10-25T05:00:00.000Z') // CET
  })

  it('round-trips with businessDate at the boundary', () => {
    const cut = cutoffIso('2026-07-15', TZ, 6)
    expect(businessDate(cut, TZ, 6)).toBe('2026-07-15')
    // One millisecond earlier still belongs to the night before.
    const before = new Date(Date.parse(cut) - 1).toISOString()
    expect(businessDate(before, TZ, 6)).toBe('2026-07-14')
  })

  it('steps to the next day across a month end', () => {
    expect(nextBusinessDate('2026-01-31')).toBe('2026-02-01')
    expect(nextBusinessDate('2026-12-31')).toBe('2027-01-01')
  })
})

describe('the written forms', () => {
  it('shows a 24 h clock and the Bosnian date', () => {
    expect(localTime('2026-09-08T22:41:00Z', TZ)).toBe('00:41')
    expect(localDate('2026-09-08T22:41:00Z', TZ)).toBe('09.09.2026.')
    expect(localTime('2026-01-15T05:00:00Z', TZ)).toBe('06:00')
    // Midnight is 00:00, never 24:00 — which is what `hourCycle: 'h23'` buys.
    expect(localTime('2026-01-14T23:00:00Z', TZ)).toBe('00:00')
  })
})

describe('clampEventAt — a client timestamp is a claim, not a fact', () => {
  const now = '2026-09-09T20:00:00.000Z'

  it('keeps an honest queued round exactly where it says it was', () => {
    expect(clampEventAt('2026-09-09T18:30:00.000Z', now, 12)).toBe('2026-09-09T18:30:00.000Z')
  })

  it('refuses the future — a round cannot have happened after now', () => {
    expect(clampEventAt('2026-09-10T09:00:00.000Z', now, 12)).toBe(now)
  })

  it('clamps a phone whose clock is set to the wrong year', () => {
    // Up to the lag floor, not down to zero: the round did happen, we just
    // cannot believe when. The caller stamps the row `late_sync = 1`.
    expect(clampEventAt('2019-04-01T12:00:00.000Z', now, 12)).toBe('2026-09-09T08:00:00.000Z')
  })

  it('corrects for the device clock before it clamps', () => {
    // The heartbeat measured this phone as 300 s ahead of the server, so what it
    // calls 18:35:00 actually happened at 18:30:00.
    expect(clampEventAt('2026-09-09T18:35:00.000Z', now, 12, 300))
      .toBe('2026-09-09T18:30:00.000Z')
  })

  it('falls back to now for a missing or unreadable claim', () => {
    expect(clampEventAt(undefined, now, 12)).toBe(now)
    expect(clampEventAt('sinoć', now, 12)).toBe(now)
  })

  it('measures the lag in whole seconds and never negatively', () => {
    expect(syncLagS('2026-09-09T18:30:00.000Z', now)).toBe(5400)
    expect(syncLagS(now, now)).toBe(0)
    expect(syncLagS('2026-09-09T21:00:00.000Z', now)).toBe(0)
  })
})
