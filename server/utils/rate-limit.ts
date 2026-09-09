/**
 * The leash on the three routes a stranger can hammer.
 *
 * `createBurstLimiter` is snajper's, copied verbatim
 * (`~/Projects/snajper/server/utils/rate-limit.ts`) rather than paraphrased,
 * because two details of its real signature are easy to get wrong and silent
 * when you do (`docs/BACKEND.md` §5.4):
 *
 * 1. **`take` returns how many slots were granted, not a boolean.** The refusal
 *    is `take(key, 1) === 0`. `if (limiter.take(key, 1))` reads like "if
 *    allowed" and is right; `if (!limiter.take(key, 1)) refuse()` is the shape
 *    to write, and anything that treats the return as a verdict object is wrong.
 * 2. **`now` is in whole seconds**, not milliseconds. Passing `Date.now()` makes
 *    every window look aeons old, so a fresh window is opened on every call and
 *    the limiter never refuses anything — a disabled limiter that still looks
 *    like a limiter in code review.
 *
 * **Limiters are never disabled — they are widened.** An earlier design skipped
 * them when `import.meta.dev`, which made the last line of defence behind three
 * critical auth findings the one thing that never ran on the developer's machine
 * *or in CI*, since vitest is a dev environment too. The code path below is
 * identical everywhere; only the number changes.
 */
import { RATE_LIMITS } from '#shared/constants'

/** How many keys before stale entries are swept. */
const PRUNE_AT = 1000

const seconds = () => Math.floor(Date.now() / 1000)

export interface BurstLimiter {
  /** Claim up to `count` slots. Returns how many were actually granted. */
  take(key: string | number, count: number, now?: number): number
  /** How many slots this key has left in its current window. */
  remaining(key: string | number, now?: number): number
  /** Forget everything. Tests, and nothing else. */
  reset(): void
  /** How many keys are being remembered. */
  size(): number
}

/**
 * A limiter allowing `limit` accepted things per window per key.
 *
 * A **fixed** window, not a sliding one: one counter and one timestamp per key,
 * reset when the window is over. A burst straddling a boundary can therefore get
 * up to twice the limit inside one wall-clock minute, which for a leash whose job
 * is to stop a runaway loop is a distinction without a difference — and the
 * sliding version costs a list of timestamps per key to fix it.
 *
 * In memory, per process, reset by a restart. This app is one Nitro process on
 * one small VPS; a second worker would need a shared store.
 *
 * `maxKeys` is a **hard** ceiling and not a sweep threshold, which matters from
 * the moment this is keyed on anything a stranger chooses (an IP). Sweeping
 * alone only removes windows that are over; a caller arriving from a fresh
 * address every request leaves a thousand live ones behind, and then the sweep
 * is a full scan of a Map that never shrinks — an unbounded key space is not a
 * leak, it is the denial of service this file exists to prevent. So when
 * sweeping is not enough, the oldest windows are evicted outright: they are the
 * closest to expiring anyway, so the budget forgiven is the smallest on the map.
 */
export function createBurstLimiter(
  limit: number,
  windowSeconds: number,
  maxKeys: number = PRUNE_AT,
): BurstLimiter {
  const seen = new Map<string | number, { started: number, used: number }>()

  /** The key's live window, or a fresh one when there is none or it is over. */
  function window(key: string | number, now: number): { started: number, used: number } {
    const entry = seen.get(key)
    if (!entry) return { started: now, used: 0 }
    const elapsed = now - entry.started
    // A clock that jumped backwards (ntp correcting a VPS) starts a new window
    // rather than locking somebody out until it catches up.
    if (elapsed < 0 || elapsed >= windowSeconds) return { started: now, used: 0 }
    return entry
  }

  function prune(now: number): void {
    for (const [key, entry] of seen) {
      if (now - entry.started >= windowSeconds) seen.delete(key)
    }
    if (seen.size < maxKeys) return

    // Still full, so every window on it is live: see the note on `maxKeys`.
    // A quarter goes at once rather than one per request, so the sort this costs
    // is paid once per few hundred new callers instead of every time.
    const oldestFirst = [...seen.entries()].sort((a, b) => a[1].started - b[1].started)
    for (const [key] of oldestFirst.slice(0, Math.ceil(maxKeys / 4))) seen.delete(key)
  }

  return {
    take(key, count, now = seconds()) {
      if (!Number.isFinite(count) || count <= 0) return 0

      const entry = window(key, now)
      const granted = Math.max(0, Math.min(Math.floor(count), limit - entry.used))
      // Written back even when nothing was granted: the window has to keep
      // ticking from where it started, or a key at its limit would reset itself
      // by knocking.
      if (seen.size >= maxKeys) prune(now)
      seen.set(key, { started: entry.started, used: entry.used + granted })
      return granted
    },
    remaining(key, now = seconds()) {
      const entry = window(key, now)
      return Math.max(0, limit - entry.used)
    },
    reset() {
      seen.clear()
    },
    size() {
      return seen.size
    },
  }
}

/**
 * Two dev browsers, one real rule.
 *
 * `import.meta.dev` is Nitro's flag and is `undefined` under vitest, which runs
 * these modules outside Nitro — so `NODE_ENV` is the fallback. Both paths widen
 * the same limiter; neither removes it.
 */
function isDev(): boolean {
  return import.meta.dev ?? process.env.NODE_ENV !== 'production'
}

export const DEV_MULTIPLIER = isDev() ? 20 : 1

/** The auth doors: login, PIN, enrol. Keyed by the `sank_d` token hash, else the IP. */
export const authLimiter = createBurstLimiter(
  RATE_LIMITS.auth.limit * DEV_MULTIPLIER, RATE_LIMITS.auth.windowS,
)

/** Every route whose body may carry a PIN. Keyed by `deviceId + ':' + approverUserId`. */
export const pinLimiter = createBurstLimiter(
  RATE_LIMITS.pin.limit * DEV_MULTIPLIER, RATE_LIMITS.pin.windowS,
)

/** Locking rounds. Keyed by `deviceId ?? sessionId`. */
export const ordersLimiter = createBurstLimiter(
  RATE_LIMITS.orders.limit * DEV_MULTIPLIER, RATE_LIMITS.orders.windowS,
)

/** Forget every window. Tests, and nothing else. */
export function resetLimiters(): void {
  authLimiter.reset()
  pinLimiter.reset()
  ordersLimiter.reset()
}
