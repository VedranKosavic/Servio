/**
 * `GET /api/prep` — *Priprema*, the bartender's ticket queue.
 *
 * The venue comes off `event.context`, which `server/middleware/tenant.ts` fills
 * from the session. Korak 1 read it out of the `venues` table with
 * `currentVenueId()`; that helper now survives only for the seed CLI and the
 * tests, because a request handler that picks the venue itself is a handler that
 * would serve the wrong café the day there are two.
 *
 * ETagged (§4.2) like the other heavy reads: an unchanged queue costs one
 * indexed `MAX(seq)` and a 304 with no body — see `prepTag`.
 */
import { useDb } from '../../utils/db'
import { guard } from '../../utils/http'
import { withEtag } from '../../utils/etag'
import { getPrep, prepTag } from '../../services/prep'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const { venueId, actor } = event.context
  return withEtag(event, prepTag(db, venueId, actor), () => getPrep(db, venueId))
}))
