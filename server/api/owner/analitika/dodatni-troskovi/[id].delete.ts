/** `DELETE /api/owner/analitika/dodatni-troskovi/:id` — answers the month it was in. */
import { useDb } from '../../../../utils/db'
import { guard, requiredParam } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { deleteMonthExtraCost } from '../../../../services/analytics'

export default defineEventHandler((event) => {
  requireRole(event.context.actor, 'admin')
  const id = requiredParam(event, 'id')
  return guard(() => deleteMonthExtraCost(useDb(), event.context.venueId, event.context.actor, id))
})
