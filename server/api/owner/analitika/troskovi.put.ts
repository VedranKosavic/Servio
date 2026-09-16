/**
 * `PUT /api/owner/analitika/troskovi` — *Struja*, *Voda* or *Kirija* for one
 * month. Answers the whole month again, so the page redraws from one reply.
 */
import { putMonthCostBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { requireRole } from '../../../utils/auth'
import { setMonthCost } from '../../../services/analytics'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const body = await readValidatedJson(event, putMonthCostBody)
  return guard(() => setMonthCost(useDb(), event.context.venueId, event.context.actor, body))
})
