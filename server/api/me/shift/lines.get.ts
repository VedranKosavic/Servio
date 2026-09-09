/**
 * `GET /api/me/shift/lines?kat=&cursor=` — his own lines, paged.
 *
 * `totals` is null before he has settled: the footer of this screen *is* his
 * number, and the declaration is meant to come first. The rows themselves are
 * not hidden — per-line prices are on them, so anybody who can add knows his
 * total, which is exactly why blindness is a nudge and not a control (§6.6).
 *
 * The `user=` filter of the owner's version of this read is ignored here: on
 * `/me` there is only ever one person.
 */
import { useDb } from '../../../utils/db'
import { guard } from '../../../utils/http'
import { shiftLines } from '../../../services/summaries'
import { hasLiveSettlement } from '../../../services/settlements'
import { shiftBriefFor } from '../../../services/shifts'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  return guard(() => {
    const db = useDb()
    const venueId = event.context.venueId
    const userId = event.context.actor.userId

    const brief = shiftBriefFor(db, venueId, userId)
    if (!brief) return { rows: [], totals: null }

    const page = shiftLines(db, venueId, brief.id, {
      userId,
      kat: typeof query.kat === 'string' ? query.kat : 'sve',
      ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
    })
    const settled = hasLiveSettlement(db, venueId, brief.id, userId)
    return { ...page, totals: settled ? page.totals : null }
  })
})
