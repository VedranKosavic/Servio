/**
 * Where a button on a *Zahtijeva pažnju* row posts to — one function, both sides.
 *
 * This lived in `server/services/owner.ts` as `attentionTarget()`, which was
 * fine while only the server had to fill an id into a path. Phase 2's
 * `UiAttentionRow` has to do exactly the same thing in the browser: it takes an
 * `AttentionItem`, asks this function for the route behind *Odobri* or *Odbij*,
 * and posts to it. Two copies of a path-filling rule is one copy too many, so it
 * moved here and `server/services/owner.ts` re-exports it — every existing
 * server caller and `tests/unit/owner-live.test.ts` still import it from there.
 *
 * The lookup table itself (`ATTENTION_ROUTES`) stays in `shared/types/owner.ts`
 * beside the types it is keyed on. `owner-live.test.ts` walks every
 * `(ref_type, action)` pair in it and asserts the route is declared in
 * `ROUTE_ROLES`, which is what keeps a button from having nowhere to go.
 */
import type { AttentionAction, AttentionItem } from './types/owner'
import { ATTENTION_ROUTES } from './types/owner'

/**
 * `"POST /api/adjustments/3f9a…/decide"`, or `null` when the pair has no route.
 *
 * `shiftId` is only read for a `waiter_settlement`, whose path carries the shift
 * as well as the settlement — *Puls* always knows which shift it is showing.
 *
 * By the §1 invariant a row this app renders always has a route for every action
 * it lists; the test is what keeps that true, and the `null` is the honest
 * answer for a pair that does not exist rather than a half-filled path.
 */
export function attentionTarget(
  item: AttentionItem, action: AttentionAction, shiftId?: string,
): string | null {
  const route = ATTENTION_ROUTES[item.ref_type]?.[action]
  if (!route) return null

  const [method, path] = route.split(' ') as [string, string]

  // `shifts.pendingFor` has no settlement row to point at — the waiter has not
  // handed anything in — so it names the pair it does have, `shiftId:userId`.
  const [refShift, isPair] = item.ref_id.includes(':')
    ? [item.ref_id.split(':')[0]!, true] as const
    : [shiftId ?? '', false] as const

  let filled = path
  if (item.ref_type === 'waiter_settlement') {
    filled = filled.replace(':id', refShift)
    filled = isPair ? filled : filled.replace(':id', item.ref_id)
  } else {
    filled = filled.replace(':id', item.ref_id)
  }
  return `${method} ${filled}`
}
