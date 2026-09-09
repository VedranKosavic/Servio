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
import { requireRole } from '../../../utils/auth'
import { markLogSeen } from '../../../services/log'

export default defineEventHandler(async (event) => {
  await readValidatedJson(event, logSeenBody)
  return guard(() => {
    const { venueId, actor } = event.context
    requireRole(actor, 'admin')
    return markLogSeen(useDb(), venueId, actor.userId)
  })
})
