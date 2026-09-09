/**
 * The limiter, and the two ways a junior silently disables one.
 *
 * `createBurstLimiter` is snajper's, copied verbatim, and its signature is the
 * whole point of this file (`docs/BACKEND.md` §5.4):
 *
 * 1. **`take` returns how many slots were granted**, not a verdict object. The
 *    refusal is `take(key, 1) === 0`.
 * 2. **`now` is in whole seconds.** Passing `Date.now()` makes every window look
 *    aeons old, so a fresh one opens on every call and nothing is ever refused —
 *    a limiter that still looks like a limiter in code review.
 *
 * And the rule that follows from both: **limiters are widened in dev, never
 * skipped**, so the code path exercised here is the code path that runs on the
 * VPS.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEV_MULTIPLIER, authLimiter, createBurstLimiter, ordersLimiter, pinLimiter, resetLimiters,
} from '../../server/utils/rate-limit'
import { RATE_LIMITS } from '#shared/constants'

beforeEach(() => {
  resetLimiters()
  return () => vi.useRealTimers()
})

describe('createBurstLimiter', () => {
  it('grants up to the limit and then returns 0', () => {
    const limiter = createBurstLimiter(3, 60)

    expect(limiter.take('a', 1, 1000)).toBe(1)
    expect(limiter.take('a', 1, 1000)).toBe(1)
    expect(limiter.take('a', 1, 1000)).toBe(1)
    // The refusal. Not `false`, not `{ ok: false }` — zero granted.
    expect(limiter.take('a', 1, 1000)).toBe(0)
    expect(limiter.remaining('a', 1000)).toBe(0)
  })

  it('grants partially when a batch does not fit', () => {
    const limiter = createBurstLimiter(10, 60)
    expect(limiter.take('a', 4, 1000)).toBe(4)
    expect(limiter.take('a', 9, 1000)).toBe(6)
    expect(limiter.take('a', 1, 1000)).toBe(0)
  })

  it('opens a fresh window exactly one window later', () => {
    const limiter = createBurstLimiter(2, 60)
    limiter.take('a', 2, 1000)

    expect(limiter.take('a', 1, 1059)).toBe(0)
    // A window that has exactly elapsed is over.
    expect(limiter.take('a', 1, 1060)).toBe(1)
  })

  it('keeps the window ticking from where it started, so knocking cannot reset it', () => {
    const limiter = createBurstLimiter(1, 60)
    limiter.take('a', 1, 1000)

    // Refused knocks all the way through the window…
    for (let t = 1001; t < 1060; t += 10) expect(limiter.take('a', 1, t)).toBe(0)
    // …and the window still ends where it always would have.
    expect(limiter.take('a', 1, 1060)).toBe(1)
  })

  it('treats a clock that jumped backwards as a fresh window, not a lockout', () => {
    const limiter = createBurstLimiter(1, 60)
    limiter.take('a', 1, 5000)
    // ntp corrected the VPS. Nobody should be locked out until it catches up.
    expect(limiter.take('a', 1, 4000)).toBe(1)
  })

  it('keys are independent', () => {
    const limiter = createBurstLimiter(1, 60)
    expect(limiter.take('a', 1, 1000)).toBe(1)
    expect(limiter.take('a', 1, 1000)).toBe(0)
    expect(limiter.take('b', 1, 1000)).toBe(1)
  })

  it('refuses a nonsensical count instead of granting it', () => {
    const limiter = createBurstLimiter(5, 60)
    expect(limiter.take('a', 0, 1000)).toBe(0)
    expect(limiter.take('a', -3, 1000)).toBe(0)
    expect(limiter.take('a', Number.NaN, 1000)).toBe(0)
    expect(limiter.remaining('a', 1000)).toBe(5)
  })

  it('evicts the oldest windows at maxKeys rather than growing without bound', () => {
    // `maxKeys` is a hard ceiling and not a sweep threshold, because from the
    // moment this is keyed on an IP the key space is chosen by the attacker: an
    // unbounded map is not a leak, it is the denial of service this file exists
    // to prevent.
    const limiter = createBurstLimiter(1, 600, 8)
    for (let i = 0; i < 40; i++) limiter.take(`key-${i}`, 1, 1000 + i)

    expect(limiter.size()).toBeLessThanOrEqual(8)
    // The newest keys survive with their windows intact; the oldest — closest to
    // expiring anyway, so the smallest budget on the map — were forgotten, which
    // reads as a full allowance again.
    expect(limiter.remaining('key-39', 1050)).toBe(0)
    expect(limiter.remaining('key-0', 1050)).toBe(1)
  })

  it('defaults `now` to whole seconds, which is what the real callers rely on', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T21:00:00.000Z'))

    const limiter = createBurstLimiter(1, 60)
    expect(limiter.take('a', 1)).toBe(1)
    expect(limiter.take('a', 1)).toBe(0)

    // Half a window later: still refused. If `now` were milliseconds this would
    // read as ~1.7 million windows ago and the limiter would grant it.
    vi.setSystemTime(new Date('2026-09-09T21:00:30.000Z'))
    expect(limiter.take('a', 1)).toBe(0)

    vi.setSystemTime(new Date('2026-09-09T21:01:00.000Z'))
    expect(limiter.take('a', 1)).toBe(1)
  })

  it('would never refuse anything if a caller passed milliseconds', () => {
    // The mistake, demonstrated once so nobody has to rediscover it: with a
    // millisecond `now`, every window looks aeons old.
    const limiter = createBurstLimiter(1, 60)
    expect(limiter.take('a', 1, Date.now())).toBe(1)
    expect(limiter.take('a', 1, Date.now() + 1000)).toBe(1)
  })
})

describe('the app\'s three limiters', () => {
  it('are widened in dev, and the code path is identical', () => {
    expect(DEV_MULTIPLIER).toBe(20)
    expect(authLimiter.remaining('nobody')).toBe(RATE_LIMITS.auth.limit * DEV_MULTIPLIER)
    expect(pinLimiter.remaining('nobody')).toBe(RATE_LIMITS.pin.limit * DEV_MULTIPLIER)
    expect(ordersLimiter.remaining('nobody')).toBe(RATE_LIMITS.orders.limit * DEV_MULTIPLIER)
  })

  it('still refuse — widened is not disabled', () => {
    const limit = RATE_LIMITS.auth.limit * DEV_MULTIPLIER
    expect(authLimiter.take('one-address', limit)).toBe(limit)
    expect(authLimiter.take('one-address', 1)).toBe(0)
  })

  it('reset between tests, so one file cannot exhaust another\'s budget', () => {
    authLimiter.take('shared-key', 5)
    resetLimiters()
    expect(authLimiter.size()).toBe(0)
  })
})
