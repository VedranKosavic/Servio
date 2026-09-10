/**
 * `DELETE /api/roster/assignments/:id`.
 *
 * A hard delete only while the week is a draft; after publish the row becomes
 * `removed`, because the phones have already seen it.
 */
import { useDb } from '../../../utils/db'
import { guard, requiredParam } from '../../../utils/http'
import { removeAssignment } from '../../../services/roster'

export default defineEventHandler(event => guard(() => {
  removeAssignment(
    useDb(), event.context.venueId, event.context.actor, requiredParam(event, 'id'),
  )
  return { ok: true as const }
}))
