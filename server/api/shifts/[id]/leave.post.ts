/** `POST /api/shifts/:id/leave` — "I have gone home". A logout is not a leave. */
import { leaveShiftBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { leaveShift } from '../../../services/shifts'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  await readValidatedJson(event, leaveShiftBody)
  return guard(() => leaveShift(useDb(), event.context.venueId, event.context.actor, shiftId))
})
