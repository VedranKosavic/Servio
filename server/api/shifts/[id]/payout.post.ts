/** `POST /api/shifts/:id/payout` — money out of the drawer, waiting for a yes. */
import { requestPayoutBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { requestPayout } from '../../../services/cash'

export default defineEventHandler(async (event) => {
  const shiftId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, requestPayoutBody)
  return guard(() =>
    requestPayout(useDb(), event.context.venueId, event.context.actor, shiftId, body))
})
