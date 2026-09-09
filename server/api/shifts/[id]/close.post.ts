/** `POST /api/shifts/:id/close` — the drawer is counted and the night is a record. */
import { closeShiftBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { closeShift } from '../../../services/shifts'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, closeShiftBody)
  return guard(() =>
    closeShift(useDb(), event.context.venueId, event.context.actor, shiftId, body))
})
