/**
 * ETag: how an unchanged poll costs one indexed `MAX(seq)` (§4.2).
 *
 * **What an ETag is, in two lines.** The server stamps a response with a short
 * opaque string — its *version* — in the `ETag` header. Next time, the browser
 * sends that string back in `If-None-Match`; if it still matches, the server
 * answers `304 Not Modified` with **no body at all** and the browser reuses what
 * it already has. A waiter's phone polls `/api/changes` every 15 s all night;
 * on a quiet table that is a 304 and a few hundred bytes instead of the whole
 * floor plan.
 *
 * **The tag must depend on everything the body depends on.** That is the whole
 * correctness argument, and it is why the default tag carries the **role and the
 * user** and not just the sequence (`changeTag` in `services/changes.ts`): the
 * bar tablet is one browser profile that Emir, then Haris, then Amar all sign
 * into, and `shift.my_settled` is literally the actor's own number. A tag of
 * `MAX(seq)` alone would serve Emir's numbers to Amar from his own browser cache
 * with the server never being asked.
 *
 * **`no-cache`, not `no-store`.** `no-store` forbids the browser from keeping
 * the response at all — which leaves it with no validator to put in
 * `If-None-Match`, and the entire 304 path above becomes dead code. `no-cache`
 * means "keep it, but never serve it without revalidating first", which is
 * exactly what an ETag needs and is equally private. `Vary: Cookie` says the
 * stored copy belongs to the cookie that fetched it. Shared caches are shut out
 * separately by `proxy_no_cache` in nginx (WP8) and the service worker is
 * network-only for `/api/`.
 */
// Imported explicitly rather than leaning on Nitro's auto-imports: `etag.test.ts`
// runs this module in plain vitest, where no auto-import exists.
import {
  getRequestHeader, setResponseHeader, setResponseStatus, type H3Event,
} from 'h3'

/**
 * Run `produce()` and stamp the answer — unless the caller already has it.
 *
 * Returns `undefined` when it set 304, and **`produce()` is not called** in that
 * case: no snapshot query, no join, nothing. The route just returns the
 * `undefined` and h3 sends an empty 304.
 */
export function withEtag<T>(event: H3Event, tag: string, produce: () => T): T | undefined {
  // An ETag is a *quoted string*: a `"` inside it ends the quoting early and
  // silently breaks every `If-None-Match` comparison afterwards — a 200 on
  // every poll, forever, with nothing in the log to say why. Callers build tags
  // out of ids and timestamps, so this only ever fires on a mistake; it costs
  // one regex and removes a whole class of them.
  const etag = `W/"${tag.replace(/["\\\r\n]/g, '_')}"`

  // These two belong on every /api/ response and `server/middleware/tenant.ts`
  // (WP1) will set them venue-wide; setting them here too is idempotent and
  // keeps the 304 path working before that middleware exists.
  setResponseHeader(event, 'Cache-Control', 'private, no-cache')
  setResponseHeader(event, 'Vary', 'Cookie')
  setResponseHeader(event, 'ETag', etag)

  if (matches(getRequestHeader(event, 'if-none-match'), etag)) {
    setResponseStatus(event, 304)
    return undefined
  }

  return produce()
}

/**
 * `If-None-Match` is a comma-separated list, each entry optionally `W/`-prefixed.
 * We compare **weakly** (RFC 9110 §8.8.3.2): the tag is a version number, not a
 * byte-for-byte guarantee, so `W/"12-admin"` and `"12-admin"` are the same tag.
 */
function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false
  if (header.trim() === '*') return true
  const want = weak(etag)
  return header.split(',').some(candidate => weak(candidate.trim()) === want)
}

function weak(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}
