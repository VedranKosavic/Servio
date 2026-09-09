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
 *
 * Which phone is asking is not a question this file answers any more:
 * `server/middleware/tenant.ts` has already matched the `sank_d` cookie against
 * the session's device and refused a mismatch, so `actor.deviceId` is the
 * enrolled device or there is none. An admin signed in on a laptop has no
 * device and therefore nothing to beat — that is the 401 below.
 */
import { heartbeatBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { unauthorized } from '../../utils/errors'
import { guard, readValidatedJson } from '../../utils/http'
import { heartbeat } from '../../services/contracts'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, heartbeatBody)
  return guard(() => {
    const { venueId, actor } = event.context
    if (!actor.deviceId) throw unauthorized('NO_DEVICE', 'no enrolled device on this request')
    return heartbeat(useDb(), venueId, actor.deviceId, body)
  })
})
