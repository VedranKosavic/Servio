/** `POST /api/stock/waste/:id/approve` — acknowledgement, never gating (§6.8). */
import { approveWasteBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { approveWaste } from '../../../../services/stock'

export default defineEventHandler(async (event) => {
  const wasteId = requiredParam(event, 'id')
  await readValidatedJson(event, approveWasteBody)
  return guard(() =>
    approveWaste(useDb(), event.context.venueId, event.context.actor, wasteId))
})
