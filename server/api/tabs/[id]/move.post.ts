/** `POST /api/tabs/:id/move` — the guests changed table. */
import { moveTabBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { moveTab } from '../../../services/tabs'

export default defineEventHandler(async (event) => {
  const tabId = requiredParam(event, 'id')
  const body = await readValidatedJson(event, moveTabBody)
  return guard(() => moveTab(useDb(), event.context.venueId, event.context.actor, tabId, body))
})
