/**
 * `GET /api/owner/log/:id` — one Dnevnik entry, with both ends of a
 * request/decision pair attached (`docs/BACKEND.md` §6.9).
 *
 * This is also where the *Puls* attention list lands: every item carries the
 * `log_id` of the entry it came from, and `/admin/dnevnik/:id` reads this route.
 */
import { useDb } from '../../../utils/db'
import { guard, requiredParam } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { getLogEntry } from '../../../services/log'

export default defineEventHandler(event => guard(() => {
  requireRole(event.context.actor, 'admin')
  return getLogEntry(useDb(), event.context.venueId, requiredParam(event, 'id'))
}))
