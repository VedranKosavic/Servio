/** `POST /api/adjustments/:id/decide` — the bartender's or the owner's answer. */
import { decideAdjustmentBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { decideAdjustment } from '../../../services/adjustments'

export default defineEventHandler(async (event) => {
  const adjustmentId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, decideAdjustmentBody)
  return guard(() =>
    decideAdjustment(useDb(), event.context.venueId, event.context.actor, adjustmentId, body))
})
