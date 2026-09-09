/** `POST /api/shifts/:id/pickup` — the owner takes the pazar out of the drawer. */
import { pickupBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { pickup } from '../../../services/cash'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, pickupBody)
  return guard(() => pickup(useDb(), event.context.venueId, event.context.actor, shiftId, body))
})
