/** `POST /api/stock/corrections` — the admin's fix, and returns to a supplier. */
import { correctStockBody } from '#shared/schemas'
import { useDb } from '../../utils/db'
import { guard, readValidatedJson } from '../../utils/http'
import { correctStock } from '../../services/stock'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, correctStockBody)
  return guard(() => correctStock(useDb(), event.context.venueId, event.context.actor, body))
})
