/** `POST /api/cash-movements/:id/decide` — the two types born pending (§6.5). */
import { decideCashMovementBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { decideCashMovement } from '../../../services/cash'

export default defineEventHandler(async (event) => {
  const movementId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, decideCashMovementBody)
  return guard(() =>
    decideCashMovement(useDb(), event.context.venueId, event.context.actor, movementId, body))
})
