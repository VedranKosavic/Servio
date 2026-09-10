/** `PATCH /api/roster/assignments/:id` — status and note only, admin only. */
import { assignmentPatch } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { patchAssignment } from '../../../services/roster'

export default defineEventHandler(async (event) => {
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, assignmentPatch)
  return guard(() =>
    patchAssignment(useDb(), event.context.venueId, event.context.actor, id, body))
})
