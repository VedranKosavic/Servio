/**
 * `POST /api/owner/analitika/dodatni-troskovi` — *Dodatni troškovi*: one named
 * cost for one month. Answers the whole month again.
 */
import { addMonthExtraCostBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson } from '../../../../utils/http'
import { requireRole } from '../../../../utils/auth'
import { addMonthExtraCost } from '../../../../services/analytics'

export default defineEventHandler(async (event) => {
  requireRole(event.context.actor, 'admin')
  const body = await readValidatedJson(event, addMonthExtraCostBody)
  return guard(() => addMonthExtraCost(useDb(), event.context.venueId, event.context.actor, body))
})
