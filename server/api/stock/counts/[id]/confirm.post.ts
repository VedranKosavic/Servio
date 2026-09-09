/** `POST /api/stock/counts/:id/confirm` — the admin signs the variance (§6.8). */
import { confirmCountBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { confirmCount } from '../../../../services/counts'

export default defineEventHandler(async (event) => {
  const countId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, confirmCountBody)
  return guard(() =>
    confirmCount(useDb(), event.context.venueId, event.context.actor, countId, body))
})
