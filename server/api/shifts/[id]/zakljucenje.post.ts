/** `POST /api/shifts/:id/zakljucenje` — *Zaključi smjenu*, the šanker's close. */
import { closeByBarBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { closeByBar } from '../../../services/closings'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, closeByBarBody)
  return guard(() =>
    closeByBar(useDb(), event.context.venueId, event.context.actor, shiftId, body))
})
