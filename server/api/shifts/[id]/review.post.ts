/** `POST /api/shifts/:id/review` — the morning after, against the card terminal. */
import { reviewShiftBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { reviewShift } from '../../../services/shifts'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, reviewShiftBody)
  return guard(() =>
    reviewShift(useDb(), event.context.venueId, event.context.actor, shiftId, body))
})
