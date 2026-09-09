/** `POST /api/stock/deliveries/:id/reverse` — the one reversal (§6.8). */
import { reverseDeliveryBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { reverseDelivery } from '../../../../services/stock'

export default defineEventHandler(async (event) => {
  const deliveryId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, reverseDeliveryBody)
  return guard(() =>
    reverseDelivery(useDb(), event.context.venueId, event.context.actor, deliveryId, body))
})
