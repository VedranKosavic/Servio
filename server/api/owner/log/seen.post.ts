/**
 * `POST /api/owner/log/seen` — the Dnevnik badge.
 *
 * Stamps `users.log_seen_at`, so the dot on *Više · Dnevnik* clears for the
 * person who read it and stays for anyone who has not. No `bump`: the badge is
 * one person's own read state, not something the floor needs to know about.
 */
import { logSeenBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { requestActor, requestVenueId, requireRole } from '../../../utils/request-actor'
import { markLogSeen } from '../../../services/log'

export default defineEventHandler(async (event) => {
  await readValidatedJson(event, logSeenBody)
  return guard(() => {
    const db = useDb()
    const venueId = requestVenueId(event, db)
    const actor = requestActor(event, db, venueId)
    requireRole(actor, 'admin')
    return markLogSeen(db, venueId, actor.userId)
  })
})
