/** `POST /api/roster/swaps/:id/decline`. */
import { decideSwapBody } from '#shared/schemas'
import { useDb } from '../../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../../utils/http'
import { decideSwap } from '../../../../services/roster'

export default defineEventHandler(async (event) => {
  const id = requiredParam(event, 'id')
  const body = await readValidatedJson(event, decideSwapBody)
  return guard(() =>
    decideSwap(useDb(), event.context.venueId, event.context.actor, id, 'decline', body))
})
