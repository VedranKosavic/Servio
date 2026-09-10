/** `POST /api/roster/assignments` — the avatar picker's two taps. */
import { assignmentBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { addAssignment } from '../../../services/roster'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, assignmentBody)
  return guard(() =>
    addAssignment(useDb(), event.context.venueId, event.context.actor, body))
})
