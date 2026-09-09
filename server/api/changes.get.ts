/**
 * `GET /api/changes?since=<int≥0>` — the one poll (`docs/BACKEND.md` §4.1).
 *
 * There is no second timer anywhere in the app: the waiter's floor plan, the
 * bartender's tickets, the shift chip and the menu version all arrive inside
 * this answer. On a quiet minute it is an ETag match and a 304 with no body.
 */
import { useDb } from '../utils/db'
import { guard } from '../utils/http'
import { withEtag } from '../utils/etag'
import { changeTag, getChanges } from '../services/changes'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  // `server/middleware/tenant.ts` resolved both of these from the cookies before
  // this handler ran, and 403'd anything `ROUTE_ROLES` does not declare.
  const { venueId, actor } = event.context

  // A missing or unparseable cursor means "I have nothing" — the `full`
  // answer — rather than a 400. A phone that lost its cursor must be able to
  // recover by asking again, not by showing the waiter an error.
  const raw = getQuery(event).since
  const since = Math.max(0, Math.trunc(Number(raw ?? 0)) || 0)

  return withEtag(event, changeTag(db, venueId, actor), () =>
    getChanges(db, venueId, actor, since))
}))
