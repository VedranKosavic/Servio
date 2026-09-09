/** `POST /api/shifts/:id/float` — cash into the drawer, or out to a waiter. */
import { moveFloatBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { moveFloat } from '../../../services/cash'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, moveFloatBody)
  return guard(() =>
    moveFloat(useDb(), event.context.venueId, event.context.actor, shiftId, body))
})
