/** `POST /api/roster/swaps` — *Traži zamjenu*, on your own row only. */
import { swapBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson } from '../../../utils/http'
import { requestSwap } from '../../../services/roster'

export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, swapBody)
  return guard(() =>
    requestSwap(useDb(), event.context.venueId, event.context.actor, body))
})
