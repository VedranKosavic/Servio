/** `POST /api/shifts/:id/force-close` — admin only, no count, no cash, a reason. */
import { forceCloseBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { forceClose } from '../../../services/shifts'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, forceCloseBody)
  return guard(() =>
    forceClose(useDb(), event.context.venueId, event.context.actor, shiftId, body))
})
