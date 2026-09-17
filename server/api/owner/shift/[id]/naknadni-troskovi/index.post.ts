/**
 * `POST /api/owner/shift/:id/naknadni-troskovi` — a cost paid out of a closed
 * shift afterwards. Admins only; answers the shift's closing again.
 */
import { addShiftExtraCostBody } from '#shared/schemas'
import { useDb } from '../../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../../utils/http'
import { requireRole } from '../../../../../utils/auth'
import { addShiftExtraCost } from '../../../../../services/closings'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const shiftId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, addShiftExtraCostBody)
  return guard(() => addShiftExtraCost(useDb(), event.context.venueId, event.context.actor, shiftId, body))
})
