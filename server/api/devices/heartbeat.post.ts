/**
 * `POST /api/devices/heartbeat` (`docs/BACKEND.md` §4.3).
 *
 * Its own 60 s timer, deliberately outside the `/api/changes` poll and
 * deliberately un-ETagged: this is a write, and it must not invalidate the read
 * everyone else is caching.
 *
 * §12 gives this **route** to WP5 (the heartbeat is a sync mechanism — it feeds
 * `pending_count` and `clock_skew_s`) and the **service** to WP1; the import
 * goes through `contracts.ts` like every other cross-package call.
 */
import { heartbeatBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { requestDeviceId, requestVenueId } from '../../utils/request-actor'
import { heartbeat } from '../../services/contracts'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, heartbeatBody)
  return guard(() => {
    const db = useDb()
    const venueId = requestVenueId(event, db)
    return heartbeat(db, venueId, requestDeviceId(event, db, venueId), body)
  })
})
