/** `POST /api/stock/waste` — *otpis*. Queueable, so it carries a `client_id`. */
import { logWasteBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { logWaste } from '../../../services/stock'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, logWasteBody)
  return guard(() => logWaste(useDb(), event.context.venueId, event.context.actor, body))
})
