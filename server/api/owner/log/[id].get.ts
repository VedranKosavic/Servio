/**
 * `GET /api/owner/log/:id` — one Dnevnik entry, with both ends of a
 * request/decision pair attached (`docs/BACKEND.md` §6.9).
 *
 * This is also where a Telegram message lands: every mirror ends with
 * `PUBLIC_URL + '/a/dnevnik/' + log_id`, and that screen reads this route.
 */
import { useDb } from '../../../utils/db'
import { guard, requiredParam } from '../../../utils/http'
import { requestActor, requestVenueId, requireRole } from '../../../utils/request-actor'
import { getLogEntry } from '../../../services/log'

export default defineEventHandler(event => guard(() => {
  const db = useDb()
  const venueId = requestVenueId(event, db)
  requireRole(requestActor(event, db, venueId), 'admin')
  return getLogEntry(db, venueId, requiredParam(event, 'id'))
}))
