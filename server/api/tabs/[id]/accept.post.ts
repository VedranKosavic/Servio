/** `POST /api/tabs/:id/accept` — the colleague takes the table. */
import { acceptTabBody } from '#shared/schemas'
import { useDb } from '../../../utils/db'
import { guard, readValidatedJson, requiredParam } from '../../../utils/http'
import { acceptTab } from '../../../services/tabs'

export default defineEventHandler(async (event) => {
  const tabId = requiredParam(event, 'id')
  await readValidatedJson(event, acceptTabBody)
  return guard(() => acceptTab(useDb(), event.context.venueId, event.context.actor, tabId))
})
