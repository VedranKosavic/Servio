/** `POST /api/tabs/:id/unpaid/decide` — the owner's *Otpis* or *Naplatiti*. */
import { decideUnpaidBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { decideUnpaid } from '../../../../services/tabs'

export default defineEventHandler(async (event) => {
  const tabId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, decideUnpaidBody)
  return guard(() =>
    decideUnpaid(useDb(), event.context.venueId, event.context.actor, tabId, body))
})
