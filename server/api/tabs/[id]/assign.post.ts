/** `POST /api/tabs/:id/assign` — *Predaj sto kolegi*. Online only. */
import { assignTabBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { assignTab } from '../../../services/tabs'

export default defineEventHandler(async (event) => {
  const tabId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, assignTabBody)
  return guard(() => assignTab(useDb(), event.context.venueId, event.context.actor, tabId, body))
})
