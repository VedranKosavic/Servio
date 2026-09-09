/** `POST /api/stock/deliveries` — *prijem robe*, always posted (§6.8). */
import { createDeliveryBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { createDelivery } from '../../../services/stock'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, createDeliveryBody)
  return guard(() =>
    createDelivery(useDb(), event.context.venueId, event.context.actor, body))
})
