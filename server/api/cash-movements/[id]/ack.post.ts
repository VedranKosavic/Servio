/** `POST /api/cash-movements/:id/ack` — *Primio sam*, by the receiver himself. */
import { ackCashMovementBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { acknowledgeFloat } from '../../../services/cash'

export default defineEventHandler(async (event) => {
  const movementId = requiredParam(event, 'id')
  await readValidatedJson(event, ackCashMovementBody)
  return guard(() =>
    acknowledgeFloat(useDb(), event.context.venueId, event.context.actor, movementId))
})
