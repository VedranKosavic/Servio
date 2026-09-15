/**
 * `GET /api/me/shift/lines?kat=&cursor=` — his own lines, paged.
 *
 * Which night: the open shift if he is on one, otherwise the newest **closed**
 * shift he worked (`lastClosedShiftFor`) — the night *Moja smjena* shows as
 * *Zadnja smjena* once the šanker has closed it.
 *
 * `totals` on the open shift is null until he has settled (the old blind
 * declaration, still honoured for a settlement that exists). On a closed shift
 * the totals are his: the night is over and there is nothing left to declare.
 * The rows themselves are never hidden — per-line prices are on them, so anybody
 * who can add knows his total, which is why blindness was a nudge (§6.6).
 *
 * The `user=` filter of the owner's version of this read is ignored here: on
 * `/me` there is only ever one person.
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { lastClosedShiftFor, shiftLines } from '../../../services/summaries'
import { hasLiveSettlement } from '../../../services/settlements'
import { shiftBriefFor } from '../../../services/shifts'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  return guard(() => {
    const db = useDb()
    const venueId = event.context.venueId
    const userId = event.context.actor.userId
    const opts = {
      userId,
      kat: typeof query.kat === 'string' ? query.kat : 'sve',
      ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
    }

    const brief = shiftBriefFor(db, venueId, userId)
    if (brief) {
      const page = shiftLines(db, venueId, brief.id, opts)
      const settled = hasLiveSettlement(db, venueId, brief.id, userId)
      return { ...page, totals: settled ? page.totals : null }
    }

    const closed = lastClosedShiftFor(db, venueId, userId)
    if (!closed) return { rows: [], totals: null }
    return shiftLines(db, venueId, closed.id, opts)
  })
})
