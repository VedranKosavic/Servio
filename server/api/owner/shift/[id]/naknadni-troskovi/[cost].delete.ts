/** `DELETE /api/owner/shift/:id/naknadni-troskovi/:cost` — answers the closing again. */
import { useDb } from '../../../../../utils/db'
import { guard, requiredParam } from '../../../../../utils/http'
import { requireRole } from '../../../../../utils/auth'
import { deleteShiftExtraCost } from '../../../../../services/closings'

export default defineEventHandler((event) => {
  requireRole(event.context.actor, 'admin')
  const shiftId = requiredParam(event, 'id')
  const costId = requiredParam(event, 'cost')
  return guard(() => deleteShiftExtraCost(useDb(), event.context.venueId, event.context.actor, shiftId, costId))
})
