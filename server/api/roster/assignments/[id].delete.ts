/**
 * `DELETE /api/roster/assignments/:id`.
 *
 * A hard delete only while the week is a draft; after publish the row becomes
 * `removed`, because the phones have already seen it.
 *
 * `?work_date=` is sent only for an **inherited** cell: the id is then the source
 * week's row, and the service writes that week's rows as a draft first. A DELETE
 * carries no body, so the date rides in the query string (which `routeKey`
 * strips, so the route's key does not change).
 */
import { useDb } from '../../../utils/db'
import { guard, requiredParam } from '../../../utils/http'
import { removeAssignment } from '../../../services/roster'

export default defineEventHandler(event => guard(() => {
  const raw = getQuery(event).work_date
  const workDate = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined
  removeAssignment(
    useDb(), event.context.venueId, event.context.actor, requiredParam(event, 'id'),
    undefined, workDate,
  )
  return { ok: true as const }
}))
